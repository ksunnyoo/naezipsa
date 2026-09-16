"""실제 계정/개발 DB를 변경하지 않는 파일 DB 통합 테스트."""
import importlib.util
import uuid
from types import SimpleNamespace

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import JSON, MetaData, create_engine, event, select, func, insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.dashboard.model import DashboardItem
from app.inspection.model import PropertyInspection
from app.inspection.schema import InspectionCreate
from app.main import app
from app.property.model import ComplexMaster, SizeMaster
from app.user.model import Profile

URL = '/api/v1/properties'
OWNER = uuid.uuid4()
CHECKS = set(InspectionCreate.model_fields) - {'overall_rating', 'memo'}


@pytest.fixture
def inspection_env(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "inspection.db"}', connect_args={'check_same_thread': False})
    @event.listens_for(engine, 'connect')
    def enable_fk(conn, _):
        conn.execute('PRAGMA foreign_keys=ON')
    for table in (DashboardItem.__table__, ComplexMaster.__table__, SizeMaster.__table__):
        table.create(engine)
    # 후보 삭제는 profiles 행을 잠근다. 이용 목적 컬럼(PostgreSQL 배열)만 JSON으로 바꿔 만든다.
    profiles_table = Profile.__table__.to_metadata(MetaData())
    profiles_table.c.service_purposes.type = JSON()
    profiles_table.create(engine)
    # ORM create_all 대신 실제 신규 마이그레이션으로 테이블을 생성한다.
    spec = importlib.util.spec_from_file_location('inspection_migration', 'alembic/versions/20260913_1500_c71f9a2d830e_create_property_inspections.py')
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
    with Session(engine) as db:
        db.add(ComplexMaster(id=100, apt_nm='테스트 아파트'))
        db.flush()
        db.add(SizeMaster(id=200, complex_id=100, representative_area=84.95, pyeong=34))
        db.add_all([
            DashboardItem(id=1, user_id=OWNER, size_id=200, dong='0101', ho='1203', floor=12, list_price=1320000000),
            DashboardItem(id=2, user_id=OWNER, size_id=200, dong='102'),
            DashboardItem(id=3, user_id=uuid.uuid4(), size_id=200),
        ])
        db.commit()
    def session_dependency():
        with Session(engine) as db:
            yield db
    previous = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = session_dependency
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(id=OWNER)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, engine
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
    engine.dispose()


def test_get_selected_candidate(inspection_env):
    client, _ = inspection_env
    one = client.get(f'{URL}/1').json()
    two = client.get(f'{URL}/2').json()
    assert one['complex_name'] == '테스트 아파트'
    assert one['dong'] == '0101' and two['dong'] == '102'
    assert one['representative_area'] == 84.95
    assert one['list_price'] == 1320000000
    assert two['list_price'] is None


def test_persistence_null_zero_and_new_visits(inspection_env):
    client, engine = inspection_env
    payload = {'overall_rating': 4, 'harmful_facility': 0, 'memo': '한글 메모🏠' * 250}
    first = client.post(f'{URL}/1/inspection', json=payload)
    second = client.post(f'{URL}/1/inspection', json={'overall_rating': 1})
    assert first.status_code == second.status_code == 201
    assert first.json()['id'] != second.json()['id']
    assert first.json()['property_id'] == 1 and first.json()['created_at']
    engine.dispose()  # 연결을 닫은 뒤 새 세션에서도 COMMIT 결과를 읽는다.
    with Session(engine) as db:
        rows = db.scalars(select(PropertyInspection).order_by(PropertyInspection.id)).all()
        assert len(rows) == 2
        assert rows[0].memo == payload['memo']
        assert rows[0].harmful_facility == 0 and rows[1].harmful_facility is None
        assert all(getattr(rows[0], f) is None for f in CHECKS - {'harmful_facility'})
        assert rows[1].memo == ''


def test_all_18_fields(inspection_env):
    client, engine = inspection_env
    payload = {f: (1 if f == 'harmful_facility' else 3) for f in CHECKS}
    assert len(payload) == 18
    assert client.post(f'{URL}/2/inspection', json={**payload, 'overall_rating': 2}).status_code == 201
    with Session(engine) as db:
        row = db.scalar(select(PropertyInspection))
        assert row.property_id == 2 and row.overall_rating == 2
        assert all(getattr(row, key) == value for key, value in payload.items())


@pytest.mark.parametrize('payload', [
    {}, {'overall_rating': None}, *[{'overall_rating': v} for v in [0, 6, True, '4', 4.0]],
    {'overall_rating': 3, 'memo': '가' * 2001}, {'overall_rating': 3, 'memo': None},
    {'overall_rating': 3, 'property_id': 2}, {'overall_rating': 3, 'user_id': str(OWNER)},
] + [ {'overall_rating': 3, field: value}
      for field in CHECKS for value in ([2, -1, True, '0', 0.0] if field == 'harmful_facility' else [0, 4, True, '3', 3.0]) ])
def test_invalid_body(inspection_env, payload):
    client, engine = inspection_env
    response = client.post(f'{URL}/1/inspection', json=payload)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'VALIDATION_ERROR'
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(PropertyInspection)) == 0


@pytest.mark.parametrize('item_id,code', [('3', 404), ('999', 404), ('0', 422), ('-1', 422), ('abc', 422), (str(2**63), 422)])
def test_access_and_ids(inspection_env, item_id, code):
    client, _ = inspection_env
    assert client.get(f'{URL}/{item_id}').status_code == code
    assert client.post(f'{URL}/{item_id}/inspection', json={'overall_rating': 3}).status_code == code


def test_login_required(inspection_env):
    client, _ = inspection_env
    del app.dependency_overrides[get_current_profile]
    assert client.get(f'{URL}/1').status_code == 401
    assert client.post(f'{URL}/1/inspection', json={'overall_rating': 3}).status_code == 401


def test_commit_failure_rolls_back(inspection_env, monkeypatch):
    client, engine = inspection_env
    with monkeypatch.context() as patch:
        patch.setattr(Session, 'commit', lambda self: (_ for _ in ()).throw(SQLAlchemyError('test failure')))
        response = client.post(f'{URL}/1/inspection', json={'overall_rating': 3})
    assert response.status_code == 500
    assert response.json()['error']['code'] == 'INTERNAL_ERROR'
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(PropertyInspection)) == 0
    assert client.post(f'{URL}/1/inspection', json={'overall_rating': 3}).status_code == 201


def test_preserve_history_on_candidate_delete(inspection_env):
    client, engine = inspection_env
    client.post(f'{URL}/1/inspection', json={'overall_rating': 3})
    assert client.delete('/api/v1/dashboard/items/1').status_code == 409
    assert client.delete('/api/v1/dashboard/items/2').status_code == 200
    assert client.delete('/api/v1/dashboard/items/3').status_code == 404
    with Session(engine) as db:
        with pytest.raises(IntegrityError):
            db.delete(db.get(DashboardItem, 1))
            db.commit()
        db.rollback()
        assert db.scalar(select(func.count()).select_from(PropertyInspection)) == 1


@pytest.mark.parametrize('data', [{'transport': 0}, {'harmful_facility': 2}, {'overall_rating': 6}, {'memo': '가' * 2001}, {'property_id': 999}])
def test_database_constraints(inspection_env, data):
    _, engine = inspection_env
    with Session(engine) as db:
        with pytest.raises(IntegrityError):
            db.execute(insert(PropertyInspection).values(**{'property_id': 1, 'overall_rating': 4, **data}))
            db.commit()
        db.rollback()
