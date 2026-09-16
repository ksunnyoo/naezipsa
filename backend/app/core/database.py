"""[공용] core · database — DB 연결과 세션, Alembic용 Base.

흐름   get_db()가 요청마다 세션을 만들어 라우터에 주입
소유   공용
주의   Base는 Alembic이 관리하는 테이블(회원·후보매물) 전용.
       B의 실거래 모델은 자기 Base를 쓴다 (아래 주석 참고)

SQLAlchemy ORM 세션 관리.

Supabase는 "호스팅된 PostgreSQL"일 뿐이고, 실제 데이터 적재·조회는
전부 이 파일의 SQLAlchemy 세션을 통해 이뤄진다 (REST API 클라이언트 미사용).
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import DATABASE_URL, DB_MAX_OVERFLOW, DB_POOL_SIZE, DB_POOL_TIMEOUT


# Alembic이 관리하는 테이블(회원·후보매물)이 공유하는 선언적 Base.
#
# ⚠️ B의 실거래 모델(app/property/model.py)은 여기가 아니라 자기만의 Base를 쓴다.
#    alembic/env.py의 include_object 필터가 "이 Base의 metadata에 있는 테이블만
#    관리 대상"으로 판단하기 때문이다. 실거래 테이블을 여기에 등록하면
#    필터가 무력화되어 autogenerate가 DROP TABLE을 만들어낸다.
#
# 새 테이블을 Alembic으로 관리하려면 이 Base를 상속하고,
# 해당 모델 모듈을 alembic/env.py에서 import 해야 한다(그래야 metadata에 등록됨).
Base = declarative_base()

_engine = None
_SessionLocal = None


def get_engine():
    global _engine
    if _engine is None:
        if not DATABASE_URL:
            raise RuntimeError(
                ".env에 DATABASE_URL을 먼저 채워넣으세요. "
                "Supabase 대시보드 -> Project Settings -> Database -> Connection string(URI)에서 확인."
            )
        # 공용 Supabase를 팀원 여러 명의 로컬 서버·스크립트가 함께 쓴다.
        # SQLAlchemy 기본 풀(최대 15개)이면 세션 풀러(5432)의 연결 한도 15를 서버
        # 프로세스 하나가 혼자 채울 수 있어, 2026-09-14에 팀 전체 DB 기능이 500으로
        # 멈췄다. 앱은 트랜잭션 풀러(6543)로 붙고(.env.example 참고), 프로세스당
        # 연결 수를 묶는다(기본 최대 5개, config.py의 DB_POOL_* 환경변수로 조정).
        # pool_timeout을 넘기면 오래 매달리지 않고 실패한다. pool_recycle은 풀러가
        # 끊은 유휴 연결을 재사용하지 않게 한다.
        _engine = create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
            pool_size=DB_POOL_SIZE,
            max_overflow=DB_MAX_OVERFLOW,
            pool_timeout=DB_POOL_TIMEOUT,
            pool_recycle=300,
        )
    return _engine


def get_session_factory():
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return _SessionLocal


def get_session() -> Session:
    """스크립트(배치)에서 직접 쓸 때: with get_session() as s: ... 형태로 사용."""
    return get_session_factory()()


def get_db():
    """FastAPI 라우터에서 Depends(get_db)로 주입받아 쓰는 제너레이터."""
    db = get_session_factory()()
    try:
        yield db
    finally:
        db.close()
