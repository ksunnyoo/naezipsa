"""[dashboard] schema — 후보·대시보드 API의 요청·응답 형태.

흐름   router 가 입력 검증과 출력 변환에 사용
참조   user/schema.py 의 ProfileResponse (A-09 응답이 프로필을 포함)
소유   A

후보 매물·대시보드 API의 요청·응답 형태 (A 담당).

DB 모델(app/dashboard/model.py)이 "저장 형태"라면, 이 파일은 "주고받는 형태"다.
대시보드 집계 응답(A-09)이 프로필을 포함하므로 user 스키마를 가져다 쓴다.
"""
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.dashboard.model import MAX_DASHBOARD_ITEMS
from app.user.schema import ProfileResponse

ItemStatus = Literal["considering", "interested", "excluded"]
Direction = Literal[
    "north", "northeast", "east", "southeast",
    "south", "southwest", "west", "northwest",
]
InteriorState = Literal["none", "partial", "full"]


# --- A-03, A-06: 선택 매물정보 ---------------------------------------------

class ItemDetailsRequest(BaseModel):
    """선택 매물정보. 전부 생략 가능하고, null을 보내면 지워진다.

    "일단 단지만 담아두고 호가는 나중에" 가 가능해야 한다.
    """

    # 호가. 단위는 **원** (예: 13.2억 -> 1320000000).
    #
    # 팀 규칙(2026-09-09 확정): DB는 만원, API 응답은 원.
    # 다만 list_price는 사용자가 직접 입력하는 값이라 DB에도 원으로 저장한다.
    # 국토부에서 온 값이 아니므로 만원으로 맞출 이유가 없고,
    # 만원으로 나눠 저장하면 10,000원 단위가 아닌 입력에서 값이 깎인다.
    # B-04(호가 괴리율)는 이 값을 그대로 받아 원 단위끼리 비교한다.
    #
    # 상한 1000억원. 만원 단위 습관으로 132000을 보내면 13.2만원이 되어
    # 괴리율이 엉뚱해지므로, 아래 하한으로 그런 실수를 잡는다.
    # (실제 아파트 호가는 최소 수천만원이다)
    list_price: int | None = Field(
        default=None, ge=1_000_000, le=100_000_000_000,
        description="호가. 단위는 원 (13.2억 -> 1320000000)",
    )
    floor: int | None = Field(default=None, ge=-5, le=200)
    dong: str | None = Field(default=None, max_length=20)
    ho: str | None = Field(default=None, max_length=20)
    direction: Direction | None = None
    interior_state: InteriorState | None = None
    memo: str | None = Field(default=None, max_length=500)

    # 대시보드 카드 체크박스(비교 차트 포함 여부). 다른 필드와 달리 "지우기"
    # 개념이 없는 단순 불리언이라 기본값을 None이 아니라 True로 둔다 - 그래야
    # A-03(등록)에서 이 필드를 생략해도 model_dump()가 True를 채워 넣는다
    # (다른 필드들처럼 None이 그대로 들어가면 NOT NULL 컬럼이라 에러가 난다).
    # A-06(수정)에서는 라우터가 exclude_unset=True로 diff를 뜨므로, 요청 바디에
    # "checked" 키 자체가 없으면(체크박스 토글이 아닌 다른 수정이면) 그대로
    # 건드리지 않는다.
    checked: bool = True


class DashboardItemCreateRequest(ItemDetailsRequest):
    """A-03: 후보 등록 요청. 필수값은 size_id 하나뿐이다.

    user_id와 status는 서버가 정한다. 요청으로 받지 않는다.
    """

    size_id: int = Field(gt=0, description="size_master.id (평형 식별자)")


class ItemStatusRequest(BaseModel):
    """A-07: 상태 변경 전용 요청.

    선택정보 수정(A-06)과 엔드포인트를 나눈 이유: 상태 변경은 카드에서 바로 누르는
    잦은 동작이고, 선택정보 수정은 폼을 열어서 하는 별개 흐름이기 때문이다.
    """

    status: ItemStatus


# --- 정렬 순서 저장 (Phase 3 보완) ------------------------------------------

# 문자열("11")·불리언(true)·0 이하를 후보 id로 받지 않는다.
OrderedItemId = Annotated[StrictInt, Field(gt=0)]


class ItemOrderRequest(BaseModel):
    """내 전체 후보의 표시 순서 저장 요청 (PATCH /dashboard/items/order).

    item_ids           저장할 순서. 내 후보 전체가 한 번씩 들어 있어야 한다.
    expected_item_ids  드래그를 시작하기 전에 서버에서 받은 순서. 지금 서버 순서와 다르면
                       다른 탭·기기에서 목록이 바뀐 것이라 저장하지 않는다(409).

    사용자 id·그룹 id·checked 같은 다른 값은 받지 않는다.
    """

    item_ids: list[OrderedItemId] = Field(max_length=MAX_DASHBOARD_ITEMS)
    expected_item_ids: list[OrderedItemId] = Field(max_length=MAX_DASHBOARD_ITEMS)

    @field_validator("item_ids", "expected_item_ids")
    @classmethod
    def reject_duplicate_ids(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("같은 후보가 중복으로 들어 있습니다.")
        return value


class ItemOrderResponse(BaseModel):
    """저장된 순서. 후보 상세는 다시 보내지 않는다."""

    item_ids: list[int]


# --- 응답 -----------------------------------------------------------------

class DashboardItemResponse(BaseModel):
    """후보 매물 한 건. 선택정보가 없으면 null로 나간다.

    단지명·평수·시세까지 함께 필요한 곳(A-04 목록, A-09 대시보드)은
    이 모델을 확장한 DashboardItemWithMetrics를 쓴다.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    size_id: int
    status: ItemStatus
    list_price: int | None = None
    floor: int | None = None
    dong: str | None = None
    ho: str | None = None
    direction: Direction | None = None
    interior_state: InteriorState | None = None
    memo: str | None = None
    checked: bool
    # 표시 순서(0부터). 서버가 관리하며 등록·수정 요청으로는 바꿀 수 없다.
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ItemMetrics(BaseModel):
    """B가 미리 계산해 둔 평형별 시세 지표 (item_metrics_cache).

    계산 기준은 backend/info.md 2부에 정리돼 있고, B-03(평형 기본지표)과
    같은 출처를 쓰므로 대시보드와 상세 화면의 숫자가 어긋나지 않는다.

    금액 단위는 전부 **원**이다 (30억 -> 3000000000).
    DB(item_metrics_cache)에는 만원으로 저장돼 있고,
    app/property/service.py의 to_won()으로 변환해서 내보낸다.
    아직 지표가 계산되지 않은 평형은 이 객체 자체가 null로 나간다.
    """

    recent_median_price: int | None = None   # 최근 대표가 (최근 10건 중앙값)
    min_price: int | None = None
    max_price: int | None = None
    price_per_pyeong: int | None = None      # 평단가
    trade_count_3y: int | None = None        # 최근 3년 거래 건수
    last_trade_date: str | None = None       # "YYYY-MM"
    jeonse_ratio: float | None = None        # 전세가율 (%)


class RegulationStatus(BaseModel):
    """B-12: 투기과열지구/조정대상지역 지정 여부(B의 regulation_zones 조회 결과).

    ⚠️ 토지거래허가구역은 여기 없다 - 서로 다른 법 조항에 근거한 별개
    지정이라 이 두 값이 true라고 자동으로 true인 게 아니다(이번 정부 발표
    에서 우연히 같은 지역들이 겹쳤을 뿐). 실제 데이터가 따로 들어오기
    전까지는 만들어서 보여주지 않는다.
    두 값 다 규제 지역표에 없으면 False(에러 아님 - B의 get_regulation_status
    와 동일한 규칙).
    """

    is_speculation_overheated: bool = False
    is_adjustment_target: bool = False


class DashboardItemWithMetrics(DashboardItemResponse):
    """후보 매물 + 단지 정보 + 시세 지표 + 규제 지정 여부.

    A-04(후보 목록)와 A-09(대시보드)가 쓴다.
    앞부분은 사용자가 입력한 값이고, 뒤는 B의 데이터를 조인한 것이다.
    """

    # 단지·평형 정보 (B의 complex_master / size_master)
    complex_name: str | None = None          # 단지명 (예: "래미안대치팰리스")
    legal_dong_name: str | None = None       # 법정동 (예: "대치동")
    build_year: int | None = None
    representative_area: float | None = None  # 전용면적 ㎡
    pyeong: int | None = None

    # 시세 지표. 계산 전이면 null.
    metrics: ItemMetrics | None = None

    # 규제 지정 여부 (B의 regulation_zones). 카드 하단 뱃지에 쓴다.
    regulation: RegulationStatus = Field(default_factory=RegulationStatus)


class DashboardItemListResponse(BaseModel):
    """A-04: 후보 목록.

    배열을 그대로 주지 않고 count/max_count를 함께 감싼다.
    프론트가 "3 / 6" 같은 표시를 하려고 상한값을 하드코딩하지 않아도 되게 하려는 것이다.
    순서는 사용자가 저장한 순서(sort_order)이고, 순번이 같으면 등록순이다.
    """

    items: list[DashboardItemWithMetrics]
    count: int
    max_count: int


class ItemDeletedResponse(BaseModel):
    """A-08: 삭제 결과."""

    deleted_id: int


class DashboardResponse(BaseModel):
    """A-09: 첫 화면용 집계 응답.

    프로필과 후보를 한 번의 호출로 내려준다.
    대시보드에서 프로필 표시 여부가 바뀌어도 이 응답을 그대로 재사용할 수 있도록
    profile을 항상 포함한다.
    """

    profile: ProfileResponse
    items: list[DashboardItemWithMetrics]
    count: int
    max_count: int


# --- 공유 ------------------------------------------------------------------
#
# "공유"는 그 시점의 관심 매물(dashboard_items) 전체를 떠둔 스냅샷을 로그인
# 없이도 볼 수 있게 토큰 하나로 공개하는 것이다. 항목을 SnapshotItem 모양(JSONB)으로
# 저장한다 - DashboardItem처럼 실제 테이블 행이 아니라서 id/status/생성시각 같은
# 필드가 없다. 그룹 API의 요청·응답은 app/group/schema.py에 있다.


class SnapshotItem(BaseModel):
    """후보 하나의 스냅샷. DashboardItem의 "선택 매물정보"와 필드가 같다."""

    size_id: int
    list_price: int | None = None
    floor: int | None = None
    dong: str | None = None
    ho: str | None = None
    direction: Direction | None = None
    interior_state: InteriorState | None = None
    checked: bool = True


class SnapshotItemWithInfo(SnapshotItem):
    """스냅샷 항목 + 단지명·평형·시세 지표 + 규제 지정 여부. 공유
    미리보기가 쓴다."""

    complex_name: str | None = None
    legal_dong_name: str | None = None
    build_year: int | None = None
    representative_area: float | None = None
    pyeong: int | None = None
    metrics: ItemMetrics | None = None
    regulation: RegulationStatus = Field(default_factory=RegulationStatus)


class DashboardShareCreateResponse(BaseModel):
    """공유 링크 생성 응답. URL 조립은 프론트가 한다(백엔드는 배포 도메인을 모른다)."""

    token: str


class DashboardShareResponse(BaseModel):
    """공유 링크 미리보기 응답. 로그인 불필요."""

    items: list[SnapshotItemWithInfo]
    count: int
