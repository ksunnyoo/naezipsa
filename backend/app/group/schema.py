"""[A] group · schema — 그룹 API 요청·응답 모양 (Phase 4, 공유 링크 Phase 5)."""
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.dashboard.model import MAX_DASHBOARD_ITEMS
from app.dashboard.schema import (
    DashboardItemWithMetrics,
    Direction,
    InteriorState,
    ItemMetrics,
    RegulationStatus,
)
from app.group.model import MAX_GROUP_NAME_LENGTH


def _clean_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise ValueError("그룹 이름을 입력해 주세요.")
    return name


def _unique_ids(value: list[int]) -> list[int]:
    if len(set(value)) != len(value):
        raise ValueError("같은 후보가 중복으로 들어 있습니다.")
    return value


class GroupCreateRequest(BaseModel):
    """그룹 만들기. item_ids를 생략하면 빈 그룹이다.

    - 전체 후보에서 고른 후보로 만들기  -> 고른 후보의 id
    - 기존 그룹의 후보로 새 그룹 만들기 -> 그 그룹 상세의 item_ids (원래 그룹은 그대로 남는다)
    """

    name: str = Field(min_length=1, max_length=MAX_GROUP_NAME_LENGTH)
    item_ids: list[int] = Field(default_factory=list, max_length=MAX_DASHBOARD_ITEMS)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("item_ids")
    @classmethod
    def reject_duplicate_ids(cls, value: list[int]) -> list[int]:
        return _unique_ids(value)


class GroupRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_GROUP_NAME_LENGTH)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return _clean_name(value)


class GroupItemsAddRequest(BaseModel):
    """기존 그룹에 후보 추가. 이미 그 그룹에 있는 후보가 섞여 있으면 하나도 넣지 않고 409."""

    item_ids: list[int] = Field(min_length=1, max_length=MAX_DASHBOARD_ITEMS)

    @field_validator("item_ids")
    @classmethod
    def reject_duplicate_ids(cls, value: list[int]) -> list[int]:
        return _unique_ids(value)


class GroupSummary(BaseModel):
    id: int
    name: str
    item_count: int
    created_at: datetime
    updated_at: datetime
    # 지금 살아 있는(공유를 중지하지 않은) 공유 링크 수. 0이면 공유하고 있지 않다.
    share_link_count: int = 0


class GroupListResponse(BaseModel):
    groups: list[GroupSummary]
    count: int
    max_count: int


class GroupDetailResponse(GroupSummary):
    """그룹 상세. item_ids는 그룹에 넣은 순서, items는 같은 순서의 후보 정보(기존 후보 응답과 같은 모양)."""

    item_ids: list[int]
    items: list[DashboardItemWithMetrics]


class GroupDeletedResponse(BaseModel):
    deleted_id: int


# --- 공유 링크 (Phase 5) ----------------------------------------------------


class GroupShareLinkCreatedResponse(BaseModel):
    """공유 링크 만들기 응답. token 원문은 이때 한 번만 준다(서버에는 hash만 남는다).

    URL 조립은 프론트가 한다(백엔드는 배포 도메인을 모른다).
    """

    id: int
    token: str
    created_at: datetime


class GroupShareLinksRevokedResponse(BaseModel):
    """공유 중지 결과. 이번에 끊은 링크 수(이미 끊겨 있었으면 0)."""

    revoked_count: int


class SharedGroupItem(BaseModel):
    """공유 링크로 보는 후보 한 건. 여기 적힌 필드만 공개한다.

    공개    단지·평형·시세 지표·규제, 호가·층·향·인테리어, 동·호수(2026-09-16 사용자 결정)
    비공개  후보 id, 메모, 상태, 체크, 표시 순서, 등록·수정 시각, 계정 정보, 임장 기록
    """

    size_id: int
    list_price: int | None = None
    floor: int | None = None
    dong: str | None = None
    ho: str | None = None
    direction: Direction | None = None
    interior_state: InteriorState | None = None
    complex_name: str | None = None
    legal_dong_name: str | None = None
    build_year: int | None = None
    representative_area: float | None = None
    pyeong: int | None = None
    metrics: ItemMetrics | None = None
    regulation: RegulationStatus = Field(default_factory=RegulationStatus)


class SharedGroupResponse(BaseModel):
    """공유 링크 열람 응답(로그인 불필요). 후보는 그룹 주인이 정한 순서다."""

    name: str
    items: list[SharedGroupItem]
    count: int
