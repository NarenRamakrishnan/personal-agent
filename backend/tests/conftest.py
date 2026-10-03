import os

# Must run before anything imports app.config: .env may point at a real database
# (Supabase), and load_dotenv never overrides a variable that is already set.
os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import config, usage
from app import db as app_db
from app.db import get_session, init_db, make_engine
from app.main import app


@pytest.fixture(autouse=True)
def _isolated_config(monkeypatch, request):
    # Tests never depend on the developer's real .env.
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "PARSER_MODE", "mock")
    usage.reset_throttle()
    if not request.node.get_closest_marker("live"):
        # Spend-guard counters go to a throwaway database, never the real one.
        # Live tests spend real credits, so they DO count against the real counters.
        monkeypatch.setattr(app_db, "engine", make_engine("sqlite://"))


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
