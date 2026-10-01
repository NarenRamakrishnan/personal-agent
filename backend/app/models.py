"""Data contract shared with the mobile app (Module 01).

API fields are camelCase on the wire to match the TypeScript types on mobile.
Python code uses snake_case.
"""

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import JSON, Column, DateTime, TypeDecorator
from sqlmodel import Field, SQLModel

TriggerType = Literal["time", "location", "time_and_location"]
LocationType = Literal["coordinate", "place", "category", "saved_place"]
# Mobile sends category as a free string, so the wire type stays `str`.
# The internal taxonomy (grocery_store, pharmacy, gym ...) lives in Module 07.


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


class Location(ApiModel):
    type: LocationType
    name: str | None = None
    category: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    radius_meters: float | None = None


class ReminderBase(ApiModel):
    title: str = Field(min_length=1)
    description: str | None = None
    deadline: datetime | None = None
    trigger_type: TriggerType
    location: Location | None = None
    # Which listening session produced this reminder, so the end-of-session
    # review list is just GET /reminders?sessionId=... (Module 05).
    session_id: str | None = None
    # The words the reminder was parsed from, shown in the review list.
    source_text: str | None = None

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


class Reminder(ReminderBase):
    id: str
    created_at: datetime
    completed: bool = False
    last_notified_at: datetime | None = None
    snoozed_until: datetime | None = None


class ReminderUpdate(ApiModel):
    title: str | None = None
    description: str | None = None
    deadline: datetime | None = None
    trigger_type: TriggerType | None = None
    location: Location | None = None
    completed: bool | None = None
    last_notified_at: datetime | None = None
    snoozed_until: datetime | None = None


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
    to: str | None = None
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


class ParseRequest(ApiModel):
    text: str = Field(min_length=1)
    session_id: str | None = None
    # The phone's current time and timezone, so "tonight" and "Friday" resolve
    # against the person's day and not the server's.
    now: datetime | None = None
    timezone: str | None = None


class ParseResponse(ApiModel):
    session_id: str
    reminders: list[Reminder]
