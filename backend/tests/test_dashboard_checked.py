"""Phase 3: 대시보드 체크 상태(checked) 저장·복원.

실제 계정/개발 DB를 건드리지 않도록 임시 SQLite 파일 DB에서 기존 router → service →
model 경로를 그대로 통과시킨다(tests/test_inspection.py와 같은 방식).
"""
import importlib.util
import uuid
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import JSON, Integer, MetaData, create_engine
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.dashboard.model import DashboardItem
from app.dashboard.service import ItemMetricsCache
from app.main import app
from app.property.model import ComplexMaster, RegulationZone, SizeMaster
from app.user.model import Profile

ITEMS = "/api/v1/dashboard/items"
OWNER = uuid.uuid4()
OTHER = uuid.uuid4()
MIGRATION = "alembic/versions/20260911_0813_258caef7f856_add_dashboard_items_checked.py"

DETAILS = {
    "dong": "101",
    "ho": "1203",
    "floor": 12,
    "list_price": 1_320_000_000,
    "direction": "south",
    "interior_state": "full",
    "memo": "남향 확인",
}


@pytest.fixture
def env(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'dashboard.db'}", connect_args={"check_same_thread": False}
    )
    # 후보 목록 조회가 단지·평형·지표·규제지역(B-12)을 함께 조인하므로 모두 만든다.
    for table in (ComplexMaster.__table__, SizeMaster.__table__,
                  ItemMetricsCache.__table__, RegulationZone.__table__):
        table.create(engine)
    # SQLite는 INTEGER PRIMARY KEY만 id를 자동으로 매긴다. 운영 PostgreSQL의 BIGSERIAL과
    # 같게 새 후보 등록을 검증하려고, 테스트용 테이블 DDL에서만 id를 INTEGER로 만든다.
    items_table = DashboardItem.__table__.to_metadata(MetaData())
    items_table.c.id.type = Integer()
    items_table.create(engine)
    # 후보 등록은 profiles 행을 잠근다. 이용 목적 컬럼(PostgreSQL 배열)만 JSON으로 바꿔 만든다.
    profiles_table = Profile.__table__.to_metadata(MetaData())
    profiles_table.c.service_purposes.type = JSON()
    profiles_table.create(engine)
    with Session(engine) as db:
        db.add(ComplexMaster(id=100, apt_nm="테스트 아파트"))
        db.flush()
        db.add(SizeMaster(id=200, complex_id=100, representative_area=84.95, pyeong=34))
        db.add_all([
            DashboardItem(id=1, user_id=OWNER, size_id=200, checked=True, **DETAILS),
            DashboardItem(id=2, user_id=OTHER, size_id=200, checked=True, dong="202"),
        ])
        db.commit()

    current = SimpleNamespace(id=OWNER)

    def session_dependency():
        with Session(engine) as db:
            yield db

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = session_dependency
    app.dependency_overrides[get_current_profile] = lambda: current
    with TestClient(app, raise_server_exceptions=False) as client:
        yield SimpleNamespace(client=client, current=current)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    engine.dispose()


def _listed(env):
    """새 요청으로 목록을 다시 받는다 = 새로고침·재로그인 후 서버에서 복원하는 경로."""
    res = env.client.get(ITEMS)
    assert res.status_code == 200, res.text
    return {item["id"]: item for item in res.json()["items"]}


def test_unchecked_state_is_restored_on_next_load(env):
    """끄기 → (재로그인) → 다시 불러와도 꺼져 있다."""
    assert _listed(env)[1]["checked"] is True

    res = env.client.patch(f"{ITEMS}/1/details", json={"checked": False})

    assert res.status_code == 200, res.text
    assert res.json()["checked"] is False
    assert _listed(env)[1]["checked"] is False


def test_checked_only_patch_keeps_other_detail_fields(env):
    """checked만 보내면 호가·동·호·향·수리·메모는 그대로다."""
    res = env.client.patch(f"{ITEMS}/1/details", json={"checked": False})

    body = res.json()
    assert {key: body[key] for key in DETAILS} == DETAILS
    assert {key: _listed(env)[1][key] for key in DETAILS} == DETAILS


def test_detail_patch_without_checked_keeps_checked(env):
    """편집창 저장처럼 checked 없이 다른 필드만 바꾸면 체크 상태는 그대로다."""
    env.client.patch(f"{ITEMS}/1/details", json={"checked": False})

    res = env.client.patch(f"{ITEMS}/1/details", json={"memo": "수정한 메모"})

    assert res.status_code == 200, res.text
    assert res.json()["checked"] is False
    assert res.json()["memo"] == "수정한 메모"


def test_users_checked_states_are_separated(env):
    """남의 후보 체크 상태는 바꿀 수 없고(404), 각자 자기 목록만 본다."""
    env.current.id = OTHER
    assert env.client.patch(f"{ITEMS}/1/details", json={"checked": False}).status_code == 404
    assert set(_listed(env)) == {2}

    env.current.id = OWNER
    assert set(_listed(env)) == {1}
    assert _listed(env)[1]["checked"] is True


def test_new_candidate_is_checked_by_default(env):
    res = env.client.post(ITEMS, json={"size_id": 200})

    assert res.status_code == 201, res.text
    assert res.json()["checked"] is True


@pytest.mark.parametrize("value", [None, "maybe"])
def test_checked_must_be_boolean(env, value):
    res = env.client.patch(f"{ITEMS}/1/details", json={"checked": value})

    assert res.status_code == 422
    assert _listed(env)[1]["checked"] is True


def test_checked_migration_fills_existing_rows_with_true(tmp_path):
    """마이그레이션은 컬럼이 없던 시절의 기존 행을 체크된 상태로 채운다."""
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE dashboard_items (id INTEGER PRIMARY KEY, memo VARCHAR(500))")
        conn.exec_driver_sql("INSERT INTO dashboard_items (id, memo) VALUES (1, '기존 행')")

    spec = importlib.util.spec_from_file_location("checked_migration", MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()

    with engine.connect() as conn:
        assert bool(conn.exec_driver_sql("SELECT checked FROM dashboard_items WHERE id = 1").scalar()) is True
    engine.dispose()
