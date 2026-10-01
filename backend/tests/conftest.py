import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import config
from app.db import get_session, init_db, make_engine
from app.main import app


@pytest.fixture(autouse=True)
def _isolated_config(monkeypatch):
    # Tests never depend on the developer's real .env.
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "PARSER_MODE", "mock")


@pytest.fixture()
def client():
    engine = make_engine("sqlite://")
    init_db(engine)

    def override():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override
    # No `with`: skip the lifespan so the real on-disk database is never touched.
    yield TestClient(app)
    app.dependency_overrides.clear()
