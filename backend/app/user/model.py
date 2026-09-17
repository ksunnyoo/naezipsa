"""[user] model — 프로필 테이블 정의. DB에 "어떻게 저장되는가".

흐름   router ▶ ★model (DB)
짝     같은 폴더의 schema.py 는 "어떻게 주고받는가"
소유   A

회원 프로필 테이블 (A 담당).

--- 설계 메모 -------------------------------------------------------------

1) 로그인/비밀번호는 우리가 저장하지 않는다.
   Supabase Auth가 auth 스키마의 auth.users 테이블에 관리한다.
   Profile은 거기에 없는 "우리 서비스만의 정보"를 담는 보조 테이블이고,
   id를 auth.users.id와 같은 값으로 맞춘다.
   구글 같은 소셜 로그인을 붙여도 auth.users에 행이 생기는 건 똑같아서
   이 구조는 그대로 쓸 수 있다.

2) 외래키(ForeignKey)를 파이썬 코드에 선언하지 않은 이유.
   auth.users는 Supabase가 관리하는 다른 스키마의 테이블이라
   이 파일의 Base.metadata에서 참조를 해석할 수 없다
   (SQLAlchemy가 NoReferencedTableError를 낸다).
   그래서 컬럼만 선언하고, 실제 FK 제약은 마이그레이션에서 직접 건다.

3) enum 성격의 컬럼은 PostgreSQL ENUM 타입 대신 String으로 저장한다.
   ENUM은 값 추가 시 ALTER TYPE이 트랜잭션 밖에서만 동작해서 마이그레이션이
   깨지고, Alembic autogenerate도 변경을 감지하지 못한다.
   값 검증은 애플리케이션(Pydantic) 쪽에서 한다.
"""
from sqlalchemy import ARRAY, JSON, Column, DateTime, String, Uuid, func

from app.core.database import Base

# --- enum 대신 쓰는 허용값 목록 (검증은 Pydantic 스키마에서) ---------------

# 나이대. 사용자가 입력하지 않아도 되는 선택값이다.
AGE_GROUPS = ("20s", "30s", "40s", "50s", "60s+")

# 서비스 이용 목적. 복수 선택 가능.
# ⚠️ 팀 확정 필요: 명세의 예시가 [move, buy]뿐이라 나머지는 임의로 채웠다.
SERVICE_PURPOSES = ("move", "buy", "jeonse", "invest")


class Profile(Base):
    """서비스 자체 회원 정보. auth.users와 1:1 대응.

    id는 새로 만들지 않고 Supabase Auth가 발급한 UUID를 그대로 쓴다.
    JWT의 sub 클레임에 들어있는 값이 바로 이 id다.

    닉네임·나이대·이용목적은 전부 선택값이다. 온보딩을 건너뛴 사용자도
    서비스를 그대로 쓸 수 있어야 하므로 NOT NULL을 걸지 않는다.
    """

    __tablename__ = "profiles"

    # auth.users.id 와 동일한 값. FK 제약은 마이그레이션에서 건다(설계 메모 2).
    id = Column(Uuid(as_uuid=True), primary_key=True)

    # 로그인 이메일 사본. auth.users에도 있지만 조인 없이 목록을 뽑기 위해 복제한다.
    email = Column(String(255), nullable=False)

    nickname = Column(String(30))

    # 나이 자체가 아니라 구간으로 저장한다. 생일이 지나도 값을 갱신할 필요가 없고,
    # 개인정보를 필요 이상으로 들고 있지 않기 위해서다.
    age_group = Column(String(10))

    # 이용 목적은 복수 선택이라 PostgreSQL 배열로 저장한다.
    # 별도 테이블로 빼지 않은 이유: 목적만으로 조회하거나 집계할 일이 없고,
    # 프로필과 항상 같이 읽고 같이 쓰기 때문이다.
    service_purposes = Column(ARRAY(String(30)))

    # 내 기본 임장 점수 기준(카테고리 5개 비중). NULL이면 따로 정하지 않은 것이라
    # 화면이 이용 목적(전세/매매)의 기본값을 쓴다. 그룹이 자기 기준을 정해두면
    # 그 그룹에서는 이 값 대신 그룹 기준으로 점수를 낸다(2026-09-16 결정).
    # 배열이 아니라 JSON인 이유: 키-값 5쌍을 통째로 읽고 쓰기만 한다.
    scoring_weights = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
