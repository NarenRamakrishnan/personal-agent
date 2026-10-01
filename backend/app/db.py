from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import config


def make_engine(url: str):
    if url.startswith("sqlite"):
        kwargs = {"connect_args": {"check_same_thread": False}}
        if url == "sqlite://":
            # In-memory database for tests; one shared connection.
            kwargs["poolclass"] = StaticPool
        return create_engine(url, **kwargs)
    return create_engine(url, pool_pre_ping=True)


engine = make_engine(config.DATABASE_URL)


def init_db(eng=None) -> None:
    SQLModel.metadata.create_all(eng or engine)


def get_session():
    with Session(engine) as session:
        yield session
