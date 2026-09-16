"""[dashboard] model — 후보 매물 테이블 정의. "어떻게 저장되는가".

흐름   router ▶ service ▶ ★model (DB)
짝     schema.py 는 "어떻게 주고받는가"
소유   A

후보 매물 테이블 (A 담당).

프로필 테이블(app/user/model.py)과 같은 Base를 공유한다.
Alembic이 관리하는 테이블은 전부 app/core/database.py의 Base를 상속해야 한다.
"""
from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, DateTime, Index, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB

from app.core.database import Base

# --- enum 대신 쓰는 허용값 목록 (검증은 Pydantic 스키마에서) ---------------

# 후보 매물의 검토 상태. 기본값은 서버가 정한다(사용자 입력이 아니다).
STATUS_CONSIDERING = "considering"  # 검토중 (기본값)
STATUS_INTERESTED = "interested"    # 관심
STATUS_EXCLUDED = "excluded"        # 제외
STATUSES = (STATUS_CONSIDERING, STATUS_INTERESTED, STATUS_EXCLUDED)

# 향. DB에는 영문으로 저장하고 한글 표시는 프론트에서 한다.
DIRECTIONS = ("north", "northeast", "east", "southeast",
              "south", "southwest", "west", "northwest")

# 인테리어 상태.
# ⚠️ 팀 확정 필요: 명세의 예시가 partial 하나뿐이라 나머지는 임의로 채웠다.
INTERIOR_STATES = ("none", "partial", "full")

# 한 사용자가 담을 수 있는 후보 매물 수 상한 (기획 규칙)
MAX_DASHBOARD_ITEMS = 6


class DashboardItem(Base):
    """사용자가 대시보드에 올려둔 후보 매물 (최대 6개).

    필수값은 size_id 하나뿐이다. 나머지 매물 정보(호가·층·동·호·향·인테리어)는
    "일단 등록해두고 나중에 채우기"가 가능해야 하므로 전부 nullable이다.

    ⚠️ (user_id, size_id) 유니크 제약을 일부러 걸지 않았다.
       같은 단지·같은 평형이라도 동·호가 다르면 서로 다른 후보이기 때문이다.
       대신 "최대 6개" 규칙을 서비스 계층에서 검사한다.

    ⚠️ size_id는 B의 size_master.id를 가리킨다. 이 값의 안정성에 조건이 있다:
       - build_size_master.py 는 (complex_id, representative_area) 기준 upsert라
         여러 번 다시 돌려도 id가 유지된다.
       - 하지만 ingest/reset_data.py 는 TRUNCATE ... RESTART IDENTITY CASCADE 라서
         id가 1번부터 다시 매겨진다. 실행하면 기존 후보가 전부 엉뚱한 단지를
         가리키게 되고, FK CASCADE로 후보 행 자체가 삭제된다.
       실제 사용자가 생긴 뒤에는 reset_data.py를 절대 실행하면 안 된다.
    """

    __tablename__ = "dashboard_items"
    __table_args__ = (
        # "내 후보 목록" 조회가 주 사용 패턴이라 user_id에 인덱스를 건다.
        Index("ix_dashboard_items_user_id", "user_id"),
        # 내 후보를 저장한 순서대로 읽는다(순번이 같으면 id순).
        Index("ix_dashboard_items_user_sort", "user_id", "sort_order", "id"),
        CheckConstraint("sort_order >= 0", name="ck_dashboard_items_sort_order"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # profiles.id (= auth.users.id). FK 제약은 마이그레이션에서 건다.
    user_id = Column(Uuid(as_uuid=True), nullable=False)

    # size_master.id. 등록 시 유일한 필수값.
    # FK 제약은 B의 실거래 테이블이 이 DB로 이관된 뒤에 추가한다.
    size_id = Column(BigInteger, nullable=False)

    # 검토 상태. ENUM이 아니라 VARCHAR로 저장한다.
    status = Column(String(20), nullable=False, server_default=STATUS_CONSIDERING)

    # --- 여기부터 선택 매물정보. 전부 나중에 채우거나 수정할 수 있다. ---

    # 호가. 단위는 **원** (13.2억 -> 1320000000).
    #
    # 팀 규칙(2026-09-09 확정): DB는 만원, API 응답은 원.
    # 이 컬럼만 예외적으로 DB에도 원으로 저장한다. 사용자가 직접 입력하는 값이라
    # 국토부 원본(만원)과 맞출 이유가 없고, 만원으로 나눠 저장하면
    # 10,000원 단위가 아닌 입력에서 값이 깎이기 때문이다.
    #
    # 반면 B의 raw_trades_sale.deal_amount는 만원으로 저장되고,
    # API로 나갈 때 app/property/service.py의 to_won()으로 변환된다.
    # B-04(호가 괴리율)는 양쪽을 원 단위로 맞춰 비교한다.
    list_price = Column(BigInteger)

    floor = Column(Integer)
    dong = Column(String(20))            # 동 (예: "101")
    ho = Column(String(20))              # 호 (예: "1203")
    direction = Column(String(10))       # 향. 영문 저장 (예: "south")
    interior_state = Column(String(20))  # 인테리어 상태 (예: "partial")

    memo = Column(String(500))

    # 대시보드 카드 체크박스(비교 차트에 포함할지 여부). status(검토중/관심/제외)와는
    # 별개 개념 - 체크 여부는 그냥 "지금 화면에서 비교 대상으로 켜뒀는지"다.
    # 기본값 True: 새로 등록한 매물은 곧바로 차트 비교에 포함되는 기존 프론트
    # 동작과 맞춘다.
    checked = Column(Boolean, nullable=False, server_default="true")

    # 사용자가 드래그로 정한 표시 순서(0부터). 서버만 쓴다 - 등록할 때 맨 뒤 번호를 매기고,
    # PATCH /dashboard/items/order 로만 바꾼다. 삭제로 생긴 빈 번호는 의미가 없어 그대로 둔다.
    # 체크 여부와는 별개다(체크를 끈 후보도 순서에 포함된다).
    sort_order = Column(Integer, nullable=False, server_default="0")

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class DashboardShare(Base):
    """관심 매물 목록을 링크 하나로 전달하기 위한 공개 스냅샷.

    로그인 없이 token만으로 조회 가능해야 하므로(공유 URL의 목적이 그거다),
    순차 증가하는 id 대신 추측 불가능한 랜덤 토큰(secrets.token_urlsafe)을
    별도 컬럼으로 둔다 - id를 그대로 노출하면 1, 2, 3... 순회로 남의 공유를
    엿볼 수 있다.

    항목은 JSONB 스냅샷. 원본
    dashboard_items가 나중에 바뀌거나 지워져도 이미 만든 공유 링크의
    내용은 그대로 유지된다(공유 시점 스냅샷이라는 의미이기도 함).
    """

    __tablename__ = "dashboard_shares"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    token = Column(String(32), nullable=False, unique=True, index=True)
    owner_user_id = Column(Uuid(as_uuid=True), nullable=False)
    items = Column(JSONB, nullable=False)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
