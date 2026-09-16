"""Phase 5: 그룹 공유 링크(읽기 전용, group_share_links).

링크를 받은 사람은 로그인 없이 그 그룹의 "지금" 후보를 본다. 링크는 그룹 주인만 만들고 끊는다.
공개 필드는 2026-09-16 사용자 결정대로 동·호수까지이고, 메모·상태·체크·순서·계정 정보는 나가지 않는다.

임시 SQLite 파일 DB에서 router → service → model을 그대로 통과시킨다(tests/test_groups.py와 같은 방식).
"""
import hashlib
import importlib.util
import uuid
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import JSON, Integer, MetaData, create_engine, event, func, inspect, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.dashboard.model import DashboardItem
from app.dashboard.service import ItemMetricsCache
from app.group.model import MAX_ACTIVE_SHARE_LINKS_PER_GROUP, Group, GroupItem, GroupShareLink
from app.inspection.model import PropertyInspection
from app.main import app
from app.property.model import ComplexMaster, RegulationZone, SizeMaster
from app.user.model import Profile

GROUPS = "/api/v1/groups"
ITEMS = "/api/v1/dashboard/items"
SHARED = "/api/v1/shared/groups"
OWNER = uuid.uuid4()
OTHER = uuid.uuid4()
MIGRATION = "alembic/versions/20260916_1030_3c9e1a7b52d4_create_group_share_links.py"

# 공유 링크로 보이는 후보 필드. 이 밖의 필드(id·memo·status·checked·sort_order·시각·계정)는 나가면 안 된다.
PUBLIC_ITEM_FIELDS = {
    "size_id", "list_price", "floor", "dong", "ho", "direction", "interior_state",
    "complex_name", "legal_dong_name", "build_year", "representative_area", "pyeong",
    "metrics", "regulation",
}


@pytest.fixture
def env(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'shares.db'}", connect_args={"check_same_thread": False}
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
            DashboardItem(id=1, user_id=OWNER, size_id=200, sort_order=1, dong="101", ho="1203",
                          floor=12, list_price=1_320_000_000, memo="비밀 메모", checked=False),
            DashboardItem(id=2, user_id=OWNER, size_id=200, sort_order=0, dong="102"),
            DashboardItem(id=3, user_id=OWNER, size_id=200, sort_order=2, dong="103"),
            DashboardItem(id=9, user_id=OTHER, size_id=200, sort_order=0, dong="909"),
        ])
        db.commit()

    current = SimpleNamespace(id=OWNER)

    def session_dependency():
        with Session(engine) as db:
            yield db

    @contextmanager
    def anonymous():
        """로그인하지 않은 방문자. 실제 인증 dependency를 그대로 쓴다."""
        app.dependency_overrides.pop(get_current_profile, None)
        try:
            yield
        finally:
            app.dependency_overrides[get_current_profile] = lambda: current

    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = session_dependency
    app.dependency_overrides[get_current_profile] = lambda: current
    with TestClient(app, raise_server_exceptions=False) as client:
        yield SimpleNamespace(client=client, current=current, engine=engine, anonymous=anonymous)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    engine.dispose()


def _create_group(env, item_ids, name="학군 후보"):
    res = env.client.post(GROUPS, json={"name": name, "item_ids": item_ids})
    assert res.status_code == 201, res.text
    return res.json()


def _share(env, group_id):
    res = env.client.post(f"{GROUPS}/{group_id}/share-links")
    assert res.status_code == 201, res.text
    return res.json()


def _open(env, token):
    return env.client.get(f"{SHARED}/{token}")


def _links(env):
    with Session(env.engine) as db:
        return db.execute(
            select(GroupShareLink.group_id, GroupShareLink.token_hash, GroupShareLink.revoked_at)
            .order_by(GroupShareLink.id)
        ).all()


def _db_state(env):
    """링크 열람 전후로 바뀌면 안 되는 저장 내용."""
    with Session(env.engine) as db:
        return (
            db.execute(select(func.count()).select_from(Profile)).scalar_one(),
            db.execute(
                select(DashboardItem.id, DashboardItem.memo, DashboardItem.checked, DashboardItem.updated_at)
                .order_by(DashboardItem.id)
            ).all(),
            db.execute(
                select(GroupItem.group_id, GroupItem.dashboard_item_id).order_by(GroupItem.dashboard_item_id)
            ).all(),
            db.execute(select(GroupShareLink.id, GroupShareLink.revoked_at)).all(),
        )


def test_anyone_with_link_sees_group_without_login(env):
    group = _create_group(env, [1, 2])
    link = _share(env, group["id"])
    assert set(link) == {"id", "token", "created_at"}

    with env.anonymous():
        res = _open(env, link["token"])

    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == "no-store"
    body = res.json()
    assert (body["name"], body["count"]) == ("학군 후보", 2)
    # 그룹 주인이 정한 순서로 보이고, 체크를 끈 후보도 그룹에 들어 있으면 보인다.
    assert [(item["dong"], item["ho"]) for item in body["items"]] == [("102", None), ("101", "1203")]
    for item in body["items"]:
        assert set(item) == PUBLIC_ITEM_FIELDS
    detail = body["items"][1]
    assert (detail["complex_name"], detail["list_price"], detail["floor"]) == ("테스트 아파트", 1_320_000_000, 12)
    assert "비밀 메모" not in res.text
    assert str(OWNER) not in res.text


def test_token_is_stored_only_as_hash(env):
    group = _create_group(env, [1])
    token = _share(env, group["id"])["token"]

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    assert _links(env) == [(group["id"], token_hash, None)]
    assert len(token) >= 32
    # DB에 남은 hash 값으로는 열리지 않는다.
    assert _open(env, token_hash).status_code == 404


def test_link_shows_current_group_contents_not_a_snapshot(env):
    group = _create_group(env, [1])
    group_url = f"{GROUPS}/{group['id']}"
    token = _share(env, group["id"])["token"]

    assert env.client.post(f"{group_url}/items", json={"item_ids": [3]}).status_code == 200
    assert env.client.patch(group_url, json={"name": "최종 후보"}).status_code == 200
    assert env.client.patch(f"{ITEMS}/1/details", json={"list_price": 1_400_000_000}).status_code == 200

    body = _open(env, token).json()
    assert body["name"] == "최종 후보"
    assert [item["dong"] for item in body["items"]] == ["101", "103"]
    assert body["items"][0]["list_price"] == 1_400_000_000

    # 그룹에서 빼거나 후보를 지우면 다음 열람에서 사라진다.
    assert env.client.delete(f"{group_url}/items/1").status_code == 200
    assert env.client.delete(f"{ITEMS}/3").status_code == 200
    body = _open(env, token).json()
    assert (body["items"], body["count"]) == ([], 0)


def test_stop_sharing_cuts_every_link_of_that_group_only(env):
    group = _create_group(env, [1])
    other_group = _create_group(env, [2], name="다른 그룹")
    first = _share(env, group["id"])["token"]
    second = _share(env, group["id"])["token"]
    kept = _share(env, other_group["id"])["token"]
    stop_url = f"{GROUPS}/{group['id']}/share-links"

    res = env.client.delete(stop_url)

    assert res.status_code == 200, res.text
    assert res.json() == {"revoked_count": 2}
    for token in (first, second):
        gone = _open(env, token)
        assert gone.status_code == 404
        assert gone.json()["error"]["code"] == "NOT_FOUND"
    assert _open(env, kept).status_code == 200
    # 다시 보내도 결과가 같고, 끊긴 링크가 되살아나지 않는다.
    assert env.client.delete(stop_url).json() == {"revoked_count": 0}
    # 다시 공유하면 새 링크만 열린다.
    again = _share(env, group["id"])["token"]
    assert _open(env, again).status_code == 200
    assert _open(env, first).status_code == 404
    assert env.client.get(f"{GROUPS}/{group['id']}").json()["item_ids"] == [1]


def test_group_list_and_detail_show_active_link_count(env):
    group = _create_group(env, [1])
    assert group["share_link_count"] == 0

    _share(env, group["id"])
    _share(env, group["id"])

    listed = env.client.get(GROUPS).json()["groups"]
    # 링크 수를 세도 후보 수가 부풀지 않는다.
    assert [(g["item_count"], g["share_link_count"]) for g in listed] == [(1, 2)]
    assert env.client.get(f"{GROUPS}/{group['id']}").json()["share_link_count"] == 2

    env.client.delete(f"{GROUPS}/{group['id']}/share-links")
    assert env.client.get(GROUPS).json()["groups"][0]["share_link_count"] == 0


def test_only_group_owner_can_create_or_stop_links(env):
    group = _create_group(env, [1])
    token = _share(env, group["id"])["token"]
    links_url = f"{GROUPS}/{group['id']}/share-links"

    env.current.id = OTHER
    assert env.client.post(links_url).status_code == 404
    assert env.client.delete(links_url).status_code == 404

    env.current.id = OWNER
    with env.anonymous():
        assert env.client.post(links_url).status_code == 401
        assert env.client.delete(links_url).status_code == 401

    assert _open(env, token).status_code == 200
    assert len(_links(env)) == 1


def test_deleting_group_removes_its_links_but_keeps_candidates(env):
    group = _create_group(env, [1, 2])
    token = _share(env, group["id"])["token"]

    assert env.client.delete(f"{GROUPS}/{group['id']}").status_code == 200

    assert _open(env, token).status_code == 404
    assert _links(env) == []
    assert [item["id"] for item in env.client.get(ITEMS).json()["items"]] == [2, 1, 3]


@pytest.mark.parametrize("token", ["not-a-real-token", "x" * 129, "%20"])
def test_unknown_or_malformed_token_is_not_found(env, token):
    _share(env, _create_group(env, [1])["id"])

    res = _open(env, token)

    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_active_link_limit_per_group(env):
    group = _create_group(env, [1])
    for _ in range(MAX_ACTIVE_SHARE_LINKS_PER_GROUP):
        _share(env, group["id"])

    res = env.client.post(f"{GROUPS}/{group['id']}/share-links")

    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"
    # 공유를 중지하면 다시 만들 수 있다.
    env.client.delete(f"{GROUPS}/{group['id']}/share-links")
    _share(env, group["id"])


def test_opening_link_writes_nothing(env):
    token = _share(env, _create_group(env, [1, 2])["id"])["token"]
    before = _db_state(env)

    with env.anonymous():
        assert _open(env, token).status_code == 200
    assert _open(env, token).status_code == 200

    # 프로필·후보·그룹 관계·링크 어느 것도 새로 생기거나 바뀌지 않는다.
    assert _db_state(env) == before


def test_migration_matches_model_and_downgrade_removes_only_links(tmp_path):
    spec = importlib.util.spec_from_file_location("group_share_links_migration", MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "d755235ab9bc"
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")

    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE groups (id INTEGER PRIMARY KEY)")
        context = MigrationContext.configure(conn)
        with Operations.context(context):
            migration.upgrade()

        inspector = inspect(conn)
        columns = {column["name"]: column["nullable"] for column in inspector.get_columns("group_share_links")}
        assert columns == {column.name: column.nullable for column in GroupShareLink.__table__.columns}
        assert [(uq["name"], uq["column_names"]) for uq in inspector.get_unique_constraints("group_share_links")] == [
            ("uq_group_share_links_token_hash", ["token_hash"]),
        ]
        assert [(ix["name"], ix["column_names"]) for ix in inspector.get_indexes("group_share_links")] == [
            ("ix_group_share_links_group_id", ["group_id"]),
        ]
        [fk] = inspector.get_foreign_keys("group_share_links")
        assert (fk["name"], fk["referred_table"], fk["options"].get("ondelete")) == (
            "fk_group_share_links_group", "groups", "CASCADE",
        )

        with Operations.context(context):
            migration.downgrade()
        assert inspect(conn).get_table_names() == ["groups"]
    engine.dispose()
