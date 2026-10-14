import threading
import weakref
from urllib.parse import urlsplit

from sqlalchemy import inspect, text
from sqlalchemy.pool import NullPool, StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import config

TRANSACTION_POOLER_PORT = 6543  # Supabase's pooler in transaction mode (for serverless hosts)


def engine_options(url: str) -> tuple[str, dict]:
    """Turn a DATABASE_URL into what SQLAlchemy needs.

    Supabase hands out `postgresql://...` URLs; SQLAlchemy needs the driver named
    (`postgresql+psycopg://`). Supabase's transaction pooler can't use prepared
    statements, and pooling on top of a pooler only holds connections open, so
    that mode turns both off.
    """
    if url.startswith("sqlite"):
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
        if url == "sqlite://":
            kwargs["poolclass"] = StaticPool  # in-memory database for tests; one shared connection
        return url, kwargs

    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            url = "postgresql+psycopg://" + url[len(prefix):]
            break
    kwargs = {"pool_pre_ping": True}
    if urlsplit(url).port == TRANSACTION_POOLER_PORT:
        kwargs["connect_args"] = {"prepare_threshold": None}  # psycopg 3: never prepare
        kwargs["poolclass"] = NullPool
    return url, kwargs


def make_engine(url: str):
    url, kwargs = engine_options(url)
    return create_engine(url, **kwargs)


engine = make_engine(config.DATABASE_URL)


# There are no migrations yet: create_all makes missing tables but never adds a
# column to a table that already exists. A column added after the first deploy
# goes here, so a database created earlier (Supabase) gets it on the next start.
ADDED_COLUMNS = [
    ("pending_chunks", "attempts", "INTEGER NOT NULL DEFAULT 0"),
    ("llm_usage", "minute", "VARCHAR"),
    ("llm_usage", "minute_calls", "INTEGER NOT NULL DEFAULT 0"),
    ("reminders", "changed_in_session", "VARCHAR"),
]


def _add_missing_columns(eng) -> None:
    insp = inspect(eng)
    tables = set(insp.get_table_names())
    with eng.begin() as conn:
        for table, column, ddl in ADDED_COLUMNS:
            if table in tables and column not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl}'))


def rls_statements(already_on: set[str] = frozenset()) -> list[str]:
    return [f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY'
            for name in sorted(SQLModel.metadata.tables) if name not in already_on]


def _tables_with_rls(conn) -> set[str]:
    return set(conn.execute(text(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE n.nspname = current_schema() AND c.relrowsecurity"
    )).scalars())


# Engines init_db has already run on. Weak, so a freed engine's id can't be mistaken
# for a new one.
_initialized: "weakref.WeakSet" = weakref.WeakSet()
_init_lock = threading.Lock()


def init_db(eng=None) -> None:
    # Tables only exist in the metadata once their classes are imported. Import them
    # here so init_db works no matter what the caller happened to import first.
    import app.models  # noqa: F401

    eng = eng or engine
    with _init_lock:
        _init(eng)
        _initialized.add(eng)


def ensure_initialized(eng=None) -> None:
    """init_db, unless it already ran on this engine. Safe to call from inside a request:
    the server runs init_db at startup, so this never takes a lock there."""
    eng = eng or engine
    if eng not in _initialized:
        init_db(eng)


def _init(eng) -> None:
    SQLModel.metadata.create_all(eng)
    _add_missing_columns(eng)
    if eng.dialect.name == "postgresql":
        # Supabase serves every table in the public schema over its REST API to anyone
        # holding the project's public anon key; row level security with no policies
        # closes that. Our project already turns RLS on for new tables (its `ensure_rls`
        # event trigger), so this is a backstop for a Postgres without that trigger.
        # This backend connects as the tables' owner, which RLS doesn't restrict.
        # Only tables still without it: ALTER TABLE locks the table, even as a no-op, and
        # would wait behind every open transaction on it (a request mid-way, say).
        with eng.begin() as conn:
            for statement in rls_statements(_tables_with_rls(conn)):
                conn.execute(text(statement))


def get_session():
    with Session(engine) as session:
        yield session
