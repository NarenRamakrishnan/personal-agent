"""Data contract shared with the mobile app (Module 01).

API fields are camelCase on the wire to match the TypeScript types on mobile.
Python code uses snake_case.
"""

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import Field as PField
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import JSON, Column, DateTime, TypeDecorator
from sqlmodel import Field, SQLModel

TriggerType = Literal["time", "location", "time_and_location"]
LocationType = Literal["coordinate", "place", "category", "saved_place"]
# Mobile sends category as a free string, so the wire type stays `str`.
# The internal taxonomy (grocery_store, pharmacy, gym ...) lives in Module 07.


def require_tz(v: datetime | None) -> datetime | None:
    if v is not None and v.tzinfo is None:
        raise ValueError("datetime must include a timezone offset")
    return v


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Stores datetimes as UTC and always hands back timezone-aware values.

    SQLite drops tzinfo, so without this a deadline would come back naive.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime passed to the database")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    @field_validator("*", mode="after")
    @classmethod
    def _strip_nul(cls, v):
        # Postgres text columns reject NUL; SQLite would store it. Drop it at the door.
        return v.replace("\x00", "") if isinstance(v, str) else v


class Location(ApiModel):
    type: LocationType
    name: str | None = Field(default=None, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    latitude: float | None = None
    longitude: float | None = None
    radius_meters: float | None = None


class ReminderBase(ApiModel):
    title: str = Field(min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    deadline: datetime | None = None
    trigger_type: TriggerType
    location: Location | None = None
    # Which listening session produced this reminder, so the end-of-session
    # review list is just GET /reminders?sessionId=... (Module 05).
    session_id: str | None = None
    # The words the reminder was parsed from, shown in the review list.
    source_text: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def check_trigger(self):
        if "location" in self.trigger_type and self.location is None:
            raise ValueError(f"triggerType '{self.trigger_type}' needs a location")
        if self.deadline is not None and self.deadline.tzinfo is None:
            raise ValueError("deadline must include a timezone offset")
        return self


class ReminderCreate(ReminderBase):
    # The phone generates id/createdAt itself and POSTs the whole reminder, so
    # accept them when present and fill them in when absent (e.g. from /parse).
    id: str | None = None
    created_at: datetime | None = None
    completed: bool = False
    last_notified_at: datetime | None = None
    snoozed_until: datetime | None = None

    _tz = field_validator("created_at", "last_notified_at", "snoozed_until")(
        lambda cls, v: require_tz(v)
    )


class Reminder(ReminderBase):
    id: str
    created_at: datetime
    completed: bool = False
    last_notified_at: datetime | None = None
    snoozed_until: datetime | None = None

    # The phone can send an unsynced reminder inline (POST /evaluate-reminder), so
    # these need the same offset check as ReminderCreate or time maths crashes later.
    _tz = field_validator("created_at", "last_notified_at", "snoozed_until")(lambda cls, v: require_tz(v))


class ReminderUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=5000)
    deadline: datetime | None = None
    trigger_type: TriggerType | None = None
    location: Location | None = None
    completed: bool | None = None
    last_notified_at: datetime | None = None
    snoozed_until: datetime | None = None

    _tz = field_validator("deadline", "last_notified_at", "snoozed_until")(
        lambda cls, v: require_tz(v)
    )


class ReminderRow(SQLModel, table=True):
    __tablename__ = "reminders"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    title: str
    description: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(UTCDateTime, nullable=False))
    deadline: datetime | None = Field(default=None, sa_column=Column(UTCDateTime))
    trigger_type: str
    location: dict | None = Field(default=None, sa_column=Column(JSON))
    session_id: str | None = Field(default=None, index=True)
    source_text: str | None = None
    completed: bool = False
    last_notified_at: datetime | None = Field(default=None, sa_column=Column(UTCDateTime))
    snoozed_until: datetime | None = Field(default=None, sa_column=Column(UTCDateTime))

    def to_api(self) -> Reminder:
        return Reminder.model_validate(self.model_dump())


# Actions (Module 05/09). Email always needs a manual approval before anything
# goes out; reminders save straight away and only get reviewed after.
ActionStatus = Literal["needs_approval", "approved", "cancelled"]


class EmailDraft(ApiModel):
    # `to` is an address and is only ever filled if the person actually said one.
    # `to_name` is who they named ("Alex", "my professor"); the phone resolves it
    # to an address through the contacts the person has granted.
    to: str | None = None
    to_name: str | None = None
    subject: str
    body: str


class Action(ApiModel):
    id: str
    type: Literal["email"]
    status: ActionStatus = "needs_approval"
    session_id: str | None = None
    source_text: str | None = None
    email: EmailDraft
    created_at: datetime
    approved_at: datetime | None = None


MAX_TEXT_CHARS = 5000


class ParseRequest(ApiModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True
    )

    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    session_id: str | None = None
    # The phone's current time and timezone, so "tonight" and "Friday" resolve
    # against the person's day and not the server's.
    now: datetime | None = None
    timezone: str | None = Field(default=None, max_length=64)
    # When this speech was actually captured. A phone that lost signal sends its
    # buffered chunks later; this lets them still count for the session they came from.
    captured_at: datetime | None = None

    @field_validator("now", "captured_at")
    @classmethod
    def needs_offset(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("timestamps must include a timezone offset")
        return v


class ParseResponse(ApiModel):
    session_id: str
    reminders: list[Reminder]
    # Chunks the model could not parse yet. They are kept and retried, not lost.
    pending_chunks: int = 0


class ParsedReminder(ApiModel):
    """What POST /parse returns: one unsaved reminder, in the shape the phone's
    ParsedReminder type (mobile/src/types/reminder.ts) expects. The phone shows
    its confirm screen and then POSTs /reminders itself."""

    intent: Literal["create_reminder"] = "create_reminder"
    title: str
    deadline: datetime | None = None
    trigger_type: TriggerType
    location: Location | None = None


class ParsedReminderResponse(ParsedReminder):
    # Extra commitments found in the same text, so typed input never silently
    # drops the second one. Absent when there is only one.
    additional: list[ParsedReminder] | None = None


class LlmUsageRow(SQLModel, table=True):
    """One row per UTC day: how much model usage the backend has spent."""

    __tablename__ = "llm_usage"

    day: str = Field(primary_key=True)  # YYYY-MM-DD, UTC
    calls: int = 0
    tokens: int = 0


class SessionRow(SQLModel, table=True):
    """One continuous listening session (Module 04)."""

    __tablename__ = "sessions"

    id: str = Field(primary_key=True)
    status: str = "listening"  # listening | ended
    started_at: datetime = Field(default_factory=utcnow, sa_column=Column(UTCDateTime, nullable=False))
    last_activity_at: datetime = Field(default_factory=utcnow, sa_column=Column(UTCDateTime, nullable=False))
    ended_at: datetime | None = Field(default=None, sa_column=Column(UTCDateTime))
    end_reason: str | None = None  # user | silence_timeout | max_duration


EndReason = Literal["user", "silence_timeout", "max_duration"]


class SessionInfo(ApiModel):
    id: str
    status: Literal["listening", "ended"]
    started_at: datetime
    last_activity_at: datetime
    ended_at: datetime | None = None
    end_reason: EndReason | None = None


class SessionDetail(SessionInfo):
    # The end-of-session review list: saved reminders plus email drafts that
    # still need a manual approval.
    reminders: list[Reminder]
    actions: list[Action] = Field(default_factory=list)
    pending_chunks: int = 0


class SavedPlaceRow(SQLModel, table=True):
    """A place the person names ("home", "work", "school") with where it is."""

    __tablename__ = "saved_places"

    name: str = Field(primary_key=True)  # lower-case, alias-folded
    latitude: float
    longitude: float
    radius_meters: float = 150.0


class SavedPlace(ApiModel):
    name: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius_meters: float = Field(default=150.0, gt=0, le=5000)


class NearbyPlace(ApiModel):
    name: str | None = None
    types: list[str] = Field(default_factory=list, max_length=50)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    # If the phone already knows how far it is, send it. If neither this nor
    # coordinates are sent, the place is assumed to be nearby (the phone's
    # nearby search is already radius-bound).
    distance_meters: float | None = Field(default=None, ge=0)


class EvalContext(ApiModel):
    now: datetime | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    nearby_places: list[NearbyPlace] = Field(default_factory=list, max_length=100)
    # IANA name, so "deadline is today" means the person's today.
    timezone: str | None = Field(default=None, max_length=64)

    _tz = field_validator("now")(lambda cls, v: require_tz(v))


class EvaluateRequest(ApiModel):
    reminder_id: str | None = None
    reminder: Reminder | None = None  # for reminders the phone has not synced yet
    context: EvalContext = Field(default_factory=EvalContext)

    @model_validator(mode="after")
    def need_one(self):
        if (self.reminder_id is None) == (self.reminder is None):
            raise ValueError("send exactly one of reminderId or reminder")
        return self


class LocationSignal(ApiModel):
    applicable: bool
    matched: bool = False
    reason: str
    distance_meters: float | None = None


class ScoreReason(ApiModel):
    label: str
    points: int


class EvaluateResponse(ApiModel):
    reminder_id: str
    time_status: str
    should_time_notify: bool
    location: LocationSignal
    score: int
    notify: bool
    decided_by: Literal["time", "context"] | None = None
    reasons: list[ScoreReason]
    # Set when a notification is due but held for quiet hours: when to deliver it.
    quiet_until: datetime | None = None


class ActionRow(SQLModel, table=True):
    __tablename__ = "actions"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    type: str = "email"
    status: str = "needs_approval"
    session_id: str | None = Field(default=None, index=True)
    source_text: str | None = None
    to: str | None = None
    to_name: str | None = None
    subject: str
    body: str
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(UTCDateTime, nullable=False))
    approved_at: datetime | None = Field(default=None, sa_column=Column(UTCDateTime))

    def to_api(self) -> "Action":
        return Action(
            id=self.id, type="email", status=self.status, session_id=self.session_id,
            source_text=self.source_text, created_at=self.created_at, approved_at=self.approved_at,
            email=EmailDraft(to=self.to, to_name=self.to_name, subject=self.subject, body=self.body),
        )


class EmailRequest(ApiModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True
    )

    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    session_id: str | None = None
    now: datetime | None = None
    timezone: str | None = Field(default=None, max_length=64)

    _tz = field_validator("now")(lambda cls, v: require_tz(v))


class EmailUpdate(ApiModel):
    to: str | None = Field(default=None, max_length=320)
    to_name: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, min_length=1, max_length=300)
    body: str | None = Field(default=None, min_length=1, max_length=10000)


def row_from_create(body: "ReminderCreate", keep_text: bool | None = None) -> "ReminderRow":
    """keep_text: whether the words may be stored (settings.load(db).keep_transcripts).
    Left out, it falls back to the server switch alone."""
    from app import config  # local import: config has no model deps, this keeps import order simple

    data = body.model_dump(exclude={"id", "created_at"})
    data["location"] = body.location.model_dump(exclude_none=True) if body.location else None
    if not (config.STORE_TRANSCRIPTS if keep_text is None else keep_text):
        data["source_text"] = None
    row = ReminderRow(**data)
    if body.id:
        row.id = body.id
    if body.created_at:
        row.created_at = body.created_at
    return row


class PendingChunkRow(SQLModel, table=True):
    """A chunk of speech the model could not parse yet. Kept so it is not lost."""

    __tablename__ = "pending_chunks"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    session_id: str = Field(index=True)
    text: str
    captured_at: datetime = Field(default_factory=utcnow, sa_column=Column(UTCDateTime, nullable=False))
    timezone: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=Column(UTCDateTime, nullable=False))
    # Set while one caller is parsing this chunk, so two callers can't both process it.
    claimed_at: datetime | None = Field(default=None, sa_column=Column(UTCDateTime))


class PrivacyCounts(ApiModel):
    sessions: int
    reminders: int
    reminders_with_transcript: int
    actions: int
    pending_chunks: int
    saved_places: int


class PrivacyInfo(ApiModel):
    audio_stored: bool
    store_transcripts: bool
    transcript_retention_days: int
    counts: PrivacyCounts


# ---- User settings ---------------------------------------------------------
# One row today (id "default"); keyed so it becomes one row per user once accounts exist.

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
NotifyLevel = Literal["fewer", "normal", "more"]
TimezoneMode = Literal["auto", "manual"]

# Abbreviations people type that aren't timezone names, and what they usually mean.
TZ_SUGGESTIONS = {
    "EST": "America/New_York", "EDT": "America/New_York", "ET": "America/New_York",
    "CST": "America/Chicago", "CDT": "America/Chicago", "CT": "America/Chicago",
    "MST": "America/Denver", "MDT": "America/Denver", "MT": "America/Denver",
    "PST": "America/Los_Angeles", "PDT": "America/Los_Angeles", "PT": "America/Los_Angeles",
    "IST": "Asia/Kolkata", "BST": "Europe/London", "GMT": "Europe/London",
}


def check_timezone(value: str | None) -> str | None:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    if value is None:
        return None
    name = value.strip()
    try:
        ZoneInfo(name)
        if "/" not in name and name.upper() not in ("UTC",):
            raise ValueError
        return name
    except (ZoneInfoNotFoundError, ValueError):
        hint = TZ_SUGGESTIONS.get(name.upper())
        tip = f" Did you mean {hint}?" if hint else " Use a name like America/New_York or Asia/Kolkata."
        raise ValueError(f"'{value}' isn't a timezone name.{tip}") from None


class SettingsRow(SQLModel, table=True):
    __tablename__ = "settings"

    id: str = Field(default="default", primary_key=True)
    timezone_mode: str = "auto"
    timezone: str | None = None
    quiet_start: str | None = None
    quiet_end: str | None = None
    morning: str = "09:00"
    afternoon: str = "15:00"
    evening: str = "18:00"
    tonight: str = "20:00"
    notify_level: str = "normal"
    near_radius_meters: float = 150.0
    keep_transcripts: bool = True
    delete_transcripts_after_days: int | None = None


class QuietHours(ApiModel):
    start: str = PField(pattern=HHMM, description="24-hour HH:MM, e.g. 23:00")
    end: str = PField(pattern=HHMM, description="24-hour HH:MM, e.g. 07:00")

    @model_validator(mode="after")
    def not_empty(self):
        if self.start == self.end:
            raise ValueError("quiet hours need different start and end times")
        return self


class TimesOfDay(ApiModel):
    morning: str = PField(default="09:00", pattern=HHMM)
    afternoon: str = PField(default="15:00", pattern=HHMM)
    evening: str = PField(default="18:00", pattern=HHMM)
    tonight: str = PField(default="20:00", pattern=HHMM)


class TimesOfDayUpdate(ApiModel):
    # A misspelt setting must be an error, not silently ignored.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    morning: str | None = PField(default=None, pattern=HHMM)
    afternoon: str | None = PField(default=None, pattern=HHMM)
    evening: str | None = PField(default=None, pattern=HHMM)
    tonight: str | None = PField(default=None, pattern=HHMM)


class Settings(ApiModel):
    timezone_mode: TimezoneMode
    timezone: str | None = None
    quiet_hours: QuietHours | None = None
    times_of_day: TimesOfDay
    notify_level: NotifyLevel
    near_radius_meters: float
    keep_transcripts: bool
    delete_transcripts_after_days: int | None = None
    # Limits the server sets, so the app can explain why a switch is greyed out.
    server_keeps_transcripts: bool
    server_retention_days: int


class SettingsUpdate(ApiModel):
    # A misspelt setting must be an error, not silently ignored.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    timezone_mode: TimezoneMode | None = None
    timezone: str | None = Field(default=None, max_length=64)
    quiet_hours: QuietHours | None = None  # send null to turn quiet hours off
    times_of_day: TimesOfDayUpdate | None = None
    notify_level: NotifyLevel | None = None
    near_radius_meters: float | None = Field(default=None, ge=50, le=1000)
    keep_transcripts: bool | None = None
    delete_transcripts_after_days: int | None = Field(default=None, ge=1, le=365)  # null = no extra limit

    _tz = field_validator("timezone")(lambda cls, v: check_timezone(v))
