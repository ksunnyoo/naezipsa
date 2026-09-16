"""Phase 3 보완: 후보 표시 순서 저장(dashboard_items.sort_order).

docs/ordering-and-sharing-design.md 3장의 계약을 임시 SQLite에서 router → service → model로
확인한다. 실제 DB의 행 잠금(profiles FOR UPDATE)은 SQLite에서 재현되지 않으므로, 두 탭의
경쟁은 expected_item_ids 불일치(409)로 검증한다.
"""
import importlib.util
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import JSON, Integer, MetaData, create_engine, event, func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.dashboard.model import MAX_DASHBOARD_ITEMS, DashboardItem
from app.dashboard.service import ItemMetricsCache, snapshot_current_items
from app.group.model import Group, GroupItem, GroupShareLink
from app.inspection.model import PropertyInspection
from app.main import app
from app.property.model import ComplexMaster, RegulationZone, SizeMaster
from app.user.model import Profile

ITEMS = "/api/v1/dashboard/items"
ORDER = f"{ITEMS}/order"
GROUPS = "/api/v1/groups"
OWNER = uuid.uuid4()
OTHER = uuid.uuid4()
NEWCOMER = uuid.uuid4()
THEIRS = 9  # OTHER의 후보
MIGRATION = "alembic/versions/20260915_1601_d755235ab9bc_add_dashboard_items_sort_order.py"


@pytest.fixture
def env(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'order.db'}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    for table in (ComplexMaster.__table__, SizeMaster.__table__,
                  ItemMetricsCache.__table__, RegulationZone.__table__):
        table.create(engine)
    items_table = DashboardItem.__table__.to_metadata(MetaData())
    items_table.c.id.type = Integer()
    items_table.create(engine)
    profiles_table = Profile.__table__.to_metadata(MetaData())
    profiles_table.c.service_purposes.type = JSON()
    profiles_table.create(engine)
    PropertyInspection.__table__.create(engine)
    Group.__table__.create(engine)
    GroupItem.__table__.create(engine)
    GroupShareLink.__table__.create(engine)

    with Session(engine) as db:
        db.add(ComplexMaster(id=100, apt_nm="테스트 아파트"))
        db.flush()
        db.add(SizeMaster(id=200, complex_id=100, representative_area=84.95, pyeong=34))
        db.add_all([
            DashboardItem(id=1, user_id=OWNER, size_id=200, sort_order=0, dong="101", memo="첫 후보"),
            DashboardItem(id=2, user_id=OWNER, size_id=200, sort_order=1, dong="102", checked=False),
            DashboardItem(id=3, user_id=OWNER, size_id=200, sort_order=2, dong="103"),
            DashboardItem(id=THEIRS, user_id=OTHER, size_id=200, sort_order=0, dong="909"),
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
        yield SimpleNamespace(client=client, current=current, engine=engine)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    engine.dispose()


def _listed_ids(env):
    res = env.client.get(ITEMS)
    assert res.status_code == 200, res.text
    return [item["id"] for item in res.json()["items"]]


def _save(env, item_ids, expected_item_ids):
    return env.client.patch(ORDER, json={"item_ids": item_ids, "expected_item_ids": expected_item_ids})


def _orders(env):
    with Session(env.engine) as db:
        return dict(db.execute(select(DashboardItem.id, DashboardItem.sort_order)).all())


def _contents(env):
    """순서 외의 후보 원본. 순서를 저장해도 바뀌면 안 된다."""
    with Session(env.engine) as db:
        return db.execute(
            select(DashboardItem.id, DashboardItem.user_id, DashboardItem.checked,
                   DashboardItem.dong, DashboardItem.memo, DashboardItem.created_at)
            .order_by(DashboardItem.id)
        ).all()


def test_saved_order_is_returned_on_next_load(env):
    assert _listed_ids(env) == [1, 2, 3]

    res = _save(env, [3, 1, 2], [1, 2, 3])

    assert res.status_code == 200, res.text
    assert res.json() == {"item_ids": [3, 1, 2]}
    listed = env.client.get(ITEMS).json()["items"]
    assert [item["id"] for item in listed] == [3, 1, 2]
    assert [item["sort_order"] for item in listed] == [0, 1, 2]


def test_reordering_keeps_ids_checked_details_groups_and_inspections(env):
    group = env.client.post(GROUPS, json={"name": "학군", "item_ids": [1, 3]}).json()
    with Session(env.engine) as db:
        db.add(PropertyInspection(property_id=2, overall_rating=4, memo=""))
        db.commit()
    before = _contents(env)

    assert _save(env, [2, 3, 1], [1, 2, 3]).status_code == 200

    assert _contents(env) == before
    # 그룹 상세도 내 전체 순서에서 그룹 후보만 남긴 순서다.
    assert env.client.get(f"{GROUPS}/{group['id']}").json()["item_ids"] == [3, 1]
    with Session(env.engine) as db:
        assert db.execute(select(func.count()).select_from(GroupItem)).scalar_one() == 2
        assert db.execute(select(func.count()).select_from(PropertyInspection)).scalar_one() == 1


def test_new_candidate_goes_last_and_deleting_keeps_relative_order(env):
    assert _save(env, [3, 1, 2], [1, 2, 3]).status_code == 200

    created = env.client.post(ITEMS, json={"size_id": 200})
    assert created.status_code == 201, created.text
    new_id = created.json()["id"]
    assert created.json()["sort_order"] == 3
    assert _listed_ids(env) == [3, 1, 2, new_id]

    assert env.client.delete(f"{ITEMS}/1").status_code == 200
    assert _listed_ids(env) == [3, 2, new_id]

    # 삭제로 빈 순번이 생겨도 다음 저장은 0부터 다시 매긴다.
    assert _save(env, [new_id, 3, 2], [3, 2, new_id]).status_code == 200
    assert [item["sort_order"] for item in env.client.get(ITEMS).json()["items"]] == [0, 1, 2]


def test_first_candidate_starts_at_zero_and_empty_order_is_allowed_only_when_empty(env):
    env.current.id = NEWCOMER
    assert _save(env, [], []).status_code == 200

    created = env.client.post(ITEMS, json={"size_id": 200})

    assert created.json()["sort_order"] == 0
    # 후보가 있는데 빈 순서를 보내면 누락으로 보고 저장하지 않는다.
    assert _save(env, [], []).status_code == 409


@pytest.mark.parametrize("item_ids", [[1, 2, THEIRS], [1, 2, 3, 999], [THEIRS]])
def test_other_users_or_unknown_ids_are_404_without_saving(env, item_ids):
    before = _orders(env)

    res = _save(env, item_ids, [1, 2, 3])

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"
    assert _orders(env) == before


@pytest.mark.parametrize(("item_ids", "expected_item_ids"), [
    ([2, 1], [1, 2, 3]),     # 내 후보 3이 빠짐
    ([3, 2, 1], [2, 1, 3]),  # 드래그 전 기준 순서가 서버 순서와 다름
    ([3, 2, 1], [1, 2]),     # 기준 순서에 후보가 빠짐
])
def test_missing_candidates_or_stale_expected_order_are_409_without_saving(env, item_ids, expected_item_ids):
    before = _orders(env)

    res = _save(env, item_ids, expected_item_ids)

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"
    assert _orders(env) == before


def test_second_tab_saving_from_the_same_starting_order_is_rejected(env):
    assert _save(env, [2, 1, 3], [1, 2, 3]).status_code == 200

    assert _save(env, [3, 2, 1], [1, 2, 3]).status_code == 409

    assert _listed_ids(env) == [2, 1, 3]


@pytest.mark.parametrize("body", [
    {"item_ids": [1, 1, 2], "expected_item_ids": [1, 2, 3]},
    {"item_ids": ["3", "2", "1"], "expected_item_ids": [1, 2, 3]},
    {"item_ids": [True, 2, 3], "expected_item_ids": [1, 2, 3]},
    {"item_ids": [0, 1, 2], "expected_item_ids": [1, 2, 3]},
    {"item_ids": list(range(1, MAX_DASHBOARD_ITEMS + 2)), "expected_item_ids": [1, 2, 3]},
    {"item_ids": [3, 2, 1]},
    {"item_ids": [3, 2, 1], "expected_item_ids": [1, 1, 2]},
])
def test_invalid_order_payload_is_422_without_saving(env, body):
    before = _orders(env)

    assert env.client.patch(ORDER, json=body).status_code == 422

    assert _orders(env) == before


def test_orders_are_separate_per_user(env):
    env.current.id = OTHER
    assert _save(env, [THEIRS], [THEIRS]).status_code == 200
    assert _listed_ids(env) == [THEIRS]

    env.current.id = OWNER
    assert _listed_ids(env) == [1, 2, 3]


def test_share_snapshot_follows_saved_order(env):
    assert _save(env, [3, 1, 2], [1, 2, 3]).status_code == 200

    with Session(env.engine) as db:
        dongs = [item["dong"] for item in snapshot_current_items(db, OWNER)]

    assert dongs == ["103", "101", "102"]


def test_migration_backfill_numbers_existing_candidates_per_user_by_registration(tmp_path):
    spec = importlib.util.spec_from_file_location("sort_order_migration", MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")

    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE dashboard_items (id INTEGER PRIMARY KEY, user_id TEXT, created_at TEXT, sort_order INTEGER)"
        )
        conn.exec_driver_sql(
            "INSERT INTO dashboard_items (id, user_id, created_at) VALUES "
            "(10, 'a', '2026-09-02'), (11, 'a', '2026-09-01'), (12, 'b', '2026-09-03'), "
            "(13, 'a', '2026-09-01'), (14, 'b', '2026-09-01')"
        )
        conn.exec_driver_sql(migration.BACKFILL_SQL)
        rows = dict(conn.exec_driver_sql("SELECT id, sort_order FROM dashboard_items").all())
    engine.dispose()

    # 사용자별로 등록 시각순, 시각이 같으면 id순으로 0부터 매긴다.
    assert rows == {11: 0, 13: 1, 10: 2, 14: 0, 12: 1}
