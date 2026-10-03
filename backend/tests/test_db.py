import pytest
from sqlalchemy.pool import NullPool, StaticPool

from app.db import engine_options

POOLER = "aws-0-us-east-1.pooler.supabase.com"


@pytest.mark.parametrize("given", [
    f"postgresql://postgres.ref:pw@{POOLER}:5432/postgres",
    f"postgres://postgres.ref:pw@{POOLER}:5432/postgres",
])
def test_supabase_urls_get_the_psycopg_driver(given):
    url, kwargs = engine_options(given)
    assert url.startswith("postgresql+psycopg://") and url.endswith(f"@{POOLER}:5432/postgres")
    assert kwargs == {"pool_pre_ping": True}  # session pooler: prepared statements are fine


def test_transaction_pooler_turns_off_prepared_statements_and_local_pooling():
    url, kwargs = engine_options(f"postgresql://postgres.ref:pw@{POOLER}:6543/postgres")
    assert kwargs["connect_args"] == {"prepare_threshold": None}
    assert kwargs["poolclass"] is NullPool


def test_an_explicit_driver_is_left_alone():
    url, _ = engine_options("postgresql+psycopg://u:p@h:5432/d")
    assert url == "postgresql+psycopg://u:p@h:5432/d"


def test_sqlite_is_unchanged():
    assert engine_options("sqlite://")[1]["poolclass"] is StaticPool
    url, kwargs = engine_options("sqlite:///x.db")
    assert url == "sqlite:///x.db" and "poolclass" not in kwargs
