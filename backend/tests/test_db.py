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


def test_the_test_suite_never_points_at_a_real_database():
    from app import config, db
    assert config.DATABASE_URL == "sqlite://"
    assert db.engine.url.drivername == "sqlite"


# ---- a real database is never open ----------------------------------------

def test_a_real_database_without_an_api_key_still_needs_credentials(client, monkeypatch):
    # No startup refusal any more: device tokens are the way in, and nothing is open.
    from app import config
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@h:5432/d")
    monkeypatch.setattr(config, "API_KEY", "")
    assert client.get("/reminders").status_code == 401
    token = client.post("/devices").json()["token"]
    assert client.get("/reminders", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_startup_allows_a_real_database_with_an_api_key(monkeypatch):
    from app import config, main
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@h:5432/d")
    monkeypatch.setattr(config, "API_KEY", "k")
    monkeypatch.setattr(config, "NEBIUS_API_KEY", "nk")
    monkeypatch.setattr(config, "PARSER_MODE", "auto")
    main.check_deploy_safety()


def test_startup_refuses_a_real_database_that_would_silently_use_the_mock_parser(monkeypatch):
    from app import config, main
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@h:5432/d")
    monkeypatch.setattr(config, "API_KEY", "k")
    monkeypatch.setattr(config, "NEBIUS_API_KEY", "")
    monkeypatch.setattr(config, "PARSER_MODE", "auto")
    with pytest.raises(RuntimeError, match="NEBIUS_API_KEY"):
        main.check_deploy_safety()


def test_startup_allows_mock_on_a_real_database_when_asked_for_by_name(monkeypatch):
    from app import config, main
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@h:5432/d")
    monkeypatch.setattr(config, "API_KEY", "k")
    monkeypatch.setattr(config, "NEBIUS_API_KEY", "")
    monkeypatch.setattr(config, "PARSER_MODE", "mock")
    main.check_deploy_safety()


def test_startup_allows_local_sqlite_with_no_nebius_key(monkeypatch):
    from app import config, main
    monkeypatch.setattr(config, "DATABASE_URL", "sqlite:///x.db")
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "NEBIUS_API_KEY", "")
    monkeypatch.setattr(config, "PARSER_MODE", "auto")
    main.check_deploy_safety()


def test_startup_allows_local_sqlite_without_an_api_key(monkeypatch):
    from app import config, main
    monkeypatch.setattr(config, "DATABASE_URL", "sqlite:///x.db")
    monkeypatch.setattr(config, "API_KEY", "")
    main.check_deploy_safety()


# ---- every table gets row level security on Postgres -----------------------

def test_rls_covers_every_table_including_ones_added_later():
    import app.models  # noqa: F401
    from sqlmodel import SQLModel
    from app.db import rls_statements
    statements = rls_statements()
    assert len(statements) == len(SQLModel.metadata.tables)
    for table in ("settings", "reminders", "pending_chunks"):
        assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY' in statements


def test_init_db_on_sqlite_skips_rls():
    from app.db import init_db, make_engine
    init_db(make_engine("sqlite://"))  # SQLite has no RLS; this must not try to enable it


# ---- a column added after a table exists is added on startup ---------------

def test_init_db_adds_attempts_to_an_existing_pending_chunks_table():
    from sqlalchemy import inspect, text
    from app.db import init_db, make_engine
    eng = make_engine("sqlite://")
    with eng.begin() as conn:  # the table as it was before `attempts` existed
        conn.execute(text(
            "CREATE TABLE pending_chunks (id VARCHAR PRIMARY KEY, session_id VARCHAR NOT NULL, text VARCHAR NOT NULL,"
            " captured_at TIMESTAMP NOT NULL, timezone VARCHAR, created_at TIMESTAMP NOT NULL, claimed_at TIMESTAMP)"))
        conn.execute(text("INSERT INTO pending_chunks VALUES ('c1', 's', 'hi', '2026-10-01', NULL, '2026-10-01', NULL)"))
    init_db(eng)
    assert "attempts" in {c["name"] for c in inspect(eng).get_columns("pending_chunks")}
    with eng.connect() as conn:
        assert conn.execute(text("SELECT attempts FROM pending_chunks")).scalar() == 0
    init_db(eng)  # running it again is harmless


def test_the_spend_guard_does_not_rerun_database_setup_after_startup(monkeypatch):
    # On Postgres, setup locks tables; rerun from inside a request (the first model
    # call after a start), it waited forever on that request's own open read.
    from app import db, usage
    from app.db import init_db, make_engine
    eng = make_engine("sqlite://")
    init_db(eng)  # what the server's startup does
    runs = []
    monkeypatch.setattr(db, "_init", lambda e: runs.append(e))
    usage.reserve_call(eng)
    usage.snapshot(eng)
    assert runs == []
    fresh = make_engine("sqlite://")
    db.ensure_initialized(fresh)
    db.ensure_initialized(fresh)
    assert runs == [fresh]  # an engine nobody set up still gets set up, once


def test_rls_is_only_turned_on_for_tables_that_lack_it():
    from app.db import rls_statements
    every = rls_statements()
    assert rls_statements({"reminders"}) == [s for s in every if '"reminders"' not in s]
    assert len(every) - len(rls_statements({"reminders"})) == 1


def test_init_db_gives_an_existing_database_owners_and_rekeys_saved_places():
    from sqlalchemy import inspect, text
    from sqlmodel import Session
    from app.db import init_db, make_engine
    from app.models import SavedPlaceRow
    eng = make_engine("sqlite://")
    with eng.begin() as conn:  # saved_places and reminders as they were before owners
        conn.execute(text("CREATE TABLE saved_places (name VARCHAR PRIMARY KEY, latitude FLOAT NOT NULL,"
                          " longitude FLOAT NOT NULL, radius_meters FLOAT NOT NULL)"))
        conn.execute(text("INSERT INTO saved_places VALUES ('home', 1.0, 2.0, 150.0)"))
        conn.execute(text("CREATE TABLE reminders (id VARCHAR PRIMARY KEY, title VARCHAR NOT NULL,"
                          " created_at TIMESTAMP NOT NULL, trigger_type VARCHAR NOT NULL)"))
        conn.execute(text("INSERT INTO reminders VALUES ('r1', 'Old', '2026-10-01', 'time')"))
    init_db(eng)
    insp = inspect(eng)
    assert insp.get_pk_constraint("saved_places")["constrained_columns"] == ["owner", "name"]
    assert "ix_reminders_owner" in {i["name"] for i in insp.get_indexes("reminders")}
    with Session(eng) as db:
        assert db.get(SavedPlaceRow, ("default", "home")).latitude == 1.0  # kept, as the shared owner's
        db.add(SavedPlaceRow(owner="device-2", name="home", latitude=5, longitude=5))
        db.commit()  # a second "home" for another device is allowed now
        assert db.exec(text("SELECT owner FROM reminders")).one()[0] == "default"
    init_db(eng)  # running it again is harmless
