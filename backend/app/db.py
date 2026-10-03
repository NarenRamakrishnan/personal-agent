from urllib.parse import urlsplit

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


def init_db(eng=None) -> None:
    # Tables only exist in the metadata once their classes are imported. Import them
    # here so init_db works no matter what the caller happened to import first.
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(eng or engine)


def get_session():
    with Session(engine) as session:
        yield session
