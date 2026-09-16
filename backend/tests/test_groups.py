"""Phase 4: 후보 그룹(groups / group_items).

그룹은 기존 후보를 가리키기만 한다. 어떤 그룹 조작도 후보(dashboard_items)를 지우거나
다시 만들지 않는다는 것을 후보 id와 내용으로 확인한다.

실제 계정/개발 DB를 건드리지 않도록 임시 SQLite 파일 DB에서 router → service → model을
그대로 통과시킨다(tests/test_dashboard_checked.py와 같은 방식). 운영 PostgreSQL처럼
ON DELETE CASCADE가 동작하도록 SQLite 외래키 검사를 켠다.
"""
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import JSON, Integer, MetaData, create_engine, event, func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.dashboard.model import DashboardItem
from app.dashboard.service import ItemMetricsCache
from app.group.model import MAX_GROUPS_PER_USER, Group, GroupItem, GroupShareLink
from app.inspection.model import PropertyInspection
from app.main import app
from app.property.model import ComplexMaster, RegulationZone, SizeMaster
from app.user.model import Profile

GROUPS = "/api/v1/groups"
ITEMS = "/api/v1/dashboard/items"
OWNER = uuid.uuid4()
OTHER = uuid.uuid4()
THEIRS = 9  # OTHER의 후보


@pytest.fixture
def env(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'groups.db'}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    for table in (ComplexMaster.__table__, SizeMaster.__table__,
                  ItemMetricsCache.__table__, RegulationZone.__table__):
        table.create(engine)
    # SQLite는 INTEGER PRIMARY KEY만 id를 자동으로 매긴다(test_dashboard_checked.py 참고).
    items_table = DashboardItem.__table__.to_metadata(MetaData())
    items_table.c.id.type = Integer()
    items_table.create(engine)
    # 후보 삭제는 profiles 행을 잠그고, 임장 기록 존재 여부를 먼저 확인하므로 함께 만든다.
    # 이용 목적 컬럼(PostgreSQL 배열)만 SQLite가 만들 수 있는 JSON으로 바꾼다.
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
            DashboardItem(id=1, user_id=OWNER, size_id=200, dong="101", memo="첫 후보"),
            DashboardItem(id=2, user_id=OWNER, size_id=200, dong="102"),
            DashboardItem(id=3, user_id=OWNER, size_id=200, dong="103"),
            DashboardItem(id=THEIRS, user_id=OTHER, size_id=200, dong="909"),
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


def _candidates(env):
    """후보 원본 스냅샷. 지우고 다시 만들면 id나 등록 시각이 달라진다."""
    with Session(env.engine) as db:
        return db.execute(
            select(DashboardItem.id, DashboardItem.user_id, DashboardItem.dong,
                   DashboardItem.memo, DashboardItem.created_at)
            .order_by(DashboardItem.id)
        ).all()


def _relation_count(env):
    with Session(env.engine) as db:
        return db.execute(select(func.count()).select_from(GroupItem)).scalar_one()


def _create(env, name="이사 후보", item_ids=None):
    body = {"name": name} if item_ids is None else {"name": name, "item_ids": item_ids}
    res = env.client.post(GROUPS, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _detail(env, group_id):
    res = env.client.get(f"{GROUPS}/{group_id}")
    assert res.status_code == 200, res.text
    return res.json()


def test_create_empty_group(env):
    group = _create(env)

    assert group["item_ids"] == []
    assert group["item_count"] == 0
    listed = env.client.get(GROUPS).json()
    assert [(g["id"], g["item_count"]) for g in listed["groups"]] == [(group["id"], 0)]
    assert listed["max_count"] == MAX_GROUPS_PER_USER


def test_create_group_with_selected_candidates(env):
    before = _candidates(env)

    group = _create(env, item_ids=[2, 1])

    assert sorted(group["item_ids"]) == [1, 2]
    assert group["item_count"] == 2
    # 그룹 상세는 기존 후보 응답과 같은 모양으로 단지 정보까지 붙여 준다.
    assert {item["id"]: item["complex_name"] for item in group["items"]} == {1: "테스트 아파트", 2: "테스트 아파트"}
    assert _candidates(env) == before


def test_new_group_from_existing_group_keeps_source(env):
    before = _candidates(env)
    source = _create(env, "원래 그룹", item_ids=[1, 2])

    copy = _create(env, "복사한 그룹", item_ids=_detail(env, source["id"])["item_ids"])
    assert copy["id"] != source["id"]
    assert copy["item_ids"] == source["item_ids"]

    # 새 그룹을 바꿔도 원래 그룹은 그대로다.
    assert env.client.delete(f"{GROUPS}/{copy['id']}/items/1").status_code == 200
    assert _detail(env, source["id"])["item_ids"] == source["item_ids"]
    assert _detail(env, copy["id"])["item_ids"] == [2]
    assert _candidates(env) == before


def test_same_candidate_can_be_in_multiple_groups(env):
    first = _create(env, "첫 그룹", item_ids=[1])
    second = _create(env, "둘째 그룹", item_ids=[1, 3])
    third = _create(env, "셋째 그룹")

    res = env.client.post(f"{GROUPS}/{third['id']}/items", json={"item_ids": [1]})

    assert res.status_code == 200, res.text
    assert _detail(env, first["id"])["item_ids"] == [1]
    assert sorted(_detail(env, second["id"])["item_ids"]) == [1, 3]
    assert _detail(env, third["id"])["item_ids"] == [1]


def test_duplicate_candidate_in_one_group_is_blocked(env):
    group = _create(env, item_ids=[1])

    # 이미 있는 후보가 섞이면 새 후보(2)도 넣지 않는다.
    res = env.client.post(f"{GROUPS}/{group['id']}/items", json={"item_ids": [1, 2]})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"
    assert _detail(env, group["id"])["item_ids"] == [1]

    # 한 요청 안에서 같은 후보를 두 번 보내도 막는다.
    assert env.client.post(f"{GROUPS}/{group['id']}/items", json={"item_ids": [2, 2]}).status_code == 422
    assert env.client.post(GROUPS, json={"name": "중복", "item_ids": [3, 3]}).status_code == 422
    assert _relation_count(env) == 1


def test_removing_candidate_from_group_keeps_candidate(env):
    before = _candidates(env)
    group = _create(env, item_ids=[1, 2])

    res = env.client.delete(f"{GROUPS}/{group['id']}/items/1")

    assert res.status_code == 200, res.text
    assert res.json()["item_ids"] == [2]
    assert _candidates(env) == before
    assert {item["id"] for item in env.client.get(ITEMS).json()["items"]} == {1, 2, 3}
    # 이미 빠진 후보를 다시 빼면 404.
    assert env.client.delete(f"{GROUPS}/{group['id']}/items/1").status_code == 404


def test_deleting_group_keeps_candidates(env):
    before = _candidates(env)
    group = _create(env, item_ids=[1, 2, 3])

    res = env.client.delete(f"{GROUPS}/{group['id']}")

    assert res.status_code == 200, res.text
    assert res.json() == {"deleted_id": group["id"]}
    assert env.client.get(f"{GROUPS}/{group['id']}").status_code == 404
    assert _relation_count(env) == 0
    assert _candidates(env) == before


def test_deleting_candidate_removes_only_its_group_relation(env):
    group = _create(env, item_ids=[1, 2])

    assert env.client.delete(f"{ITEMS}/1").status_code == 200

    detail = _detail(env, group["id"])
    assert detail["item_ids"] == [2]
    assert [item["id"] for item in detail["items"]] == [2]


def test_other_users_groups_and_candidates_are_not_accessible(env):
    group = _create(env, "내 그룹", item_ids=[1])
    group_url = f"{GROUPS}/{group['id']}"

    env.current.id = OTHER
    assert env.client.get(GROUPS).json()["groups"] == []
    assert env.client.get(group_url).status_code == 404
    assert env.client.patch(group_url, json={"name": "가로채기"}).status_code == 404
    assert env.client.post(f"{group_url}/items", json={"item_ids": [THEIRS]}).status_code == 404
    assert env.client.delete(f"{group_url}/items/1").status_code == 404
    assert env.client.delete(group_url).status_code == 404
    # 남의 후보로 내 그룹을 만들 수도 없다.
    assert env.client.post(GROUPS, json={"name": "남의 후보", "item_ids": [1]}).status_code == 404
    assert env.client.get(GROUPS).json()["groups"] == []

    env.current.id = OWNER
    # 내 그룹에 남의 후보를 넣을 수 없다.
    assert env.client.post(f"{group_url}/items", json={"item_ids": [THEIRS]}).status_code == 404
    detail = _detail(env, group["id"])
    assert (detail["name"], detail["item_ids"]) == ("내 그룹", [1])


def test_group_count_limit(env):
    for n in range(MAX_GROUPS_PER_USER):
        _create(env, f"그룹 {n}")

    res = env.client.post(GROUPS, json={"name": "하나 더"})

    assert res.status_code == 409
    assert len(env.client.get(GROUPS).json()["groups"]) == MAX_GROUPS_PER_USER


def test_rename_group_trims_name_and_rejects_blank(env):
    group = _create(env, item_ids=[1])

    res = env.client.patch(f"{GROUPS}/{group['id']}", json={"name": "  새 이름  "})
    assert res.status_code == 200, res.text
    assert (res.json()["name"], res.json()["item_ids"]) == ("새 이름", [1])

    assert env.client.patch(f"{GROUPS}/{group['id']}", json={"name": "   "}).status_code == 422
    assert env.client.post(GROUPS, json={"name": "x" * 31}).status_code == 422
    assert _detail(env, group["id"])["name"] == "새 이름"


def test_snapshot_group_routes_that_replaced_candidates_are_removed(env):
    """예전 그룹 불러오기(후보 전체 삭제 후 재생성) 경로가 더 이상 없다."""
    before = _candidates(env)

    assert env.client.get("/api/v1/dashboard/groups").status_code == 404
    assert env.client.post("/api/v1/dashboard/groups", json={"name": "옛 그룹"}).status_code == 404
    assert env.client.post("/api/v1/dashboard/groups/1/load").status_code == 404
    assert _candidates(env) == before
