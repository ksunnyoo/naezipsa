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
    # ORM create_all 대신 실제 마이그레이션으로 테이블을 만든다. 테이블 생성
    # (c71f9a2d830e) 다음에 후보당 1건·CASCADE로 바꾸는 a4f2c8e91b07까지 이어서
    # 실행하므로, 두 마이그레이션이 실제로 이어 붙는지도 함께 검증된다.
    migrations = []
    for index, path in enumerate((
        'alembic/versions/20260913_1500_c71f9a2d830e_create_property_inspections.py',
        'alembic/versions/20260916_1530_a4f2c8e91b07_inspection_one_per_candidate.py',
    )):
        spec = importlib.util.spec_from_file_location(f'inspection_migration_{index}', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        migrations.append(module)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            for module in migrations:
                module.upgrade()
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
            for module in reversed(migrations):
                module.downgrade()
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


def test_persistence_null_zero_and_overwrite(inspection_env):
    """미확인(null)과 "없음"(0)을 구분해 저장하고, 다시 저장하면 고쳐 쓴다."""
    client, engine = inspection_env
    payload = {'overall_rating': 4, 'harmful_facility': 0, 'memo': '한글 메모🏠' * 250}
    first = client.post(f'{URL}/1/inspection', json=payload)
    assert first.status_code == 201  # 처음 저장이면 새로 만든다
    assert first.json()['property_id'] == 1 and first.json()['created_at']
    with Session(engine) as db:
        row = db.scalar(select(PropertyInspection))
        assert row.memo == payload['memo']
        assert row.harmful_facility == 0  # 0(없음)은 미확인(null)과 다르게 남는다
        assert all(getattr(row, f) is None for f in CHECKS - {'harmful_facility'})

    second = client.post(f'{URL}/1/inspection', json={'overall_rating': 1})
    assert second.status_code == 200  # 두 번째부터는 같은 기록을 고쳐 쓴다
    assert first.json()['id'] == second.json()['id']
    engine.dispose()  # 연결을 닫은 뒤 새 세션에서도 COMMIT 결과를 읽는다.
    with Session(engine) as db:
        rows = db.scalars(select(PropertyInspection)).all()
        assert len(rows) == 1  # 저장할 때마다 쌓이지 않는다
        assert rows[0].overall_rating == 1
        assert rows[0].memo == ''  # 보내지 않은 값은 기본값으로 돌아간다
        assert rows[0].harmful_facility is None


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
    assert client.get(f'{URL}/1/inspection').status_code == 401
    assert client.get(f'{URL}/inspections').status_code == 401
    assert client.post(f'{URL}/1/inspection', json={'overall_rating': 3}).status_code == 401


def test_list_my_inspections(inspection_env):
    """후보 카드 점수용 일괄 조회. 내 후보 기록만 나온다.

    경로가 `/{property_id}`보다 먼저 선언되지 않으면 "inspections"가 정수 id로
    해석돼 422가 난다. 200과 목록 모양으로 그 선언 순서까지 함께 확인한다.
    """
    client, engine = inspection_env
    assert client.get(f'{URL}/inspections').json() == {'items': [], 'count': 0}

    client.post(f'{URL}/1/inspection', json={'overall_rating': 5, 'transport': 3})
    client.post(f'{URL}/2/inspection', json={'overall_rating': 2})
    # 남의 후보(3번)에도 기록을 직접 넣어 둔다 - 목록에 섞이면 안 된다.
    with Session(engine) as db:
        db.execute(insert(PropertyInspection).values(property_id=3, overall_rating=4))
        db.commit()

    body = client.get(f'{URL}/inspections').json()
    assert body['count'] == 2
    assert [row['property_id'] for row in body['items']] == [1, 2]
    assert body['items'][0]['transport'] == 3
    assert body['items'][1]['transport'] is None  # 고르지 않은 항목은 미확인 그대로


def test_get_saved_inspection(inspection_env):
    """저장한 값을 그대로 다시 불러온다. 기록이 없으면 404로 "빈 체크리스트"를 뜻한다."""
    client, _ = inspection_env
    assert client.get(f'{URL}/1/inspection').status_code == 404  # 저장 전
    client.post(f'{URL}/1/inspection', json={
        'overall_rating': 5, 'transport': 3, 'harmful_facility': 0, 'memo': '채광 좋음',
    })
    body = client.get(f'{URL}/1/inspection').json()
    assert body['overall_rating'] == 5 and body['transport'] == 3
    assert body['harmful_facility'] == 0 and body['memo'] == '채광 좋음'
    assert body['school'] is None  # 고르지 않은 항목은 미확인 그대로
    assert body['property_id'] == 1 and body['created_at'] and body['updated_at']
    assert client.get(f'{URL}/2/inspection').status_code == 404  # 기록 없는 내 후보
    assert client.get(f'{URL}/3/inspection').status_code == 404  # 남의 후보


def test_one_record_per_candidate_in_db(inspection_env):
    """후보당 1건은 DB 제약으로도 막는다(같은 후보로 두 번 INSERT 불가)."""
    _, engine = inspection_env
    with Session(engine) as db:
        db.execute(insert(PropertyInspection).values(property_id=1, overall_rating=3))
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(insert(PropertyInspection).values(property_id=1, overall_rating=4))
            db.commit()
        db.rollback()


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


def test_candidate_delete_removes_inspection(inspection_env):
    """기록이 있어도 후보를 지울 수 있고, 기록도 함께 지워진다(2026-09-16 결정)."""
    client, engine = inspection_env
    client.post(f'{URL}/1/inspection', json={'overall_rating': 3})
    assert client.delete('/api/v1/dashboard/items/1').status_code == 200
    assert client.delete('/api/v1/dashboard/items/2').status_code == 200
    assert client.delete('/api/v1/dashboard/items/3').status_code == 404  # 남의 후보
    with Session(engine) as db:
        assert db.get(DashboardItem, 1) is None
        assert db.scalar(select(func.count()).select_from(PropertyInspection)) == 0


@pytest.mark.parametrize('data', [{'transport': 0}, {'harmful_facility': 2}, {'overall_rating': 6}, {'memo': '가' * 2001}, {'property_id': 999}])
def test_database_constraints(inspection_env, data):
    _, engine = inspection_env
    with Session(engine) as db:
        with pytest.raises(IntegrityError):
            db.execute(insert(PropertyInspection).values(**{'property_id': 1, 'overall_rating': 4, **data}))
            db.commit()
        db.rollback()
