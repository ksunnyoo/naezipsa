"""모바일 임장 API 입력과 응답. 매물 ID는 dashboard_items.id다."""
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

Score = Annotated[int, Field(strict=True, ge=1, le=3)]
Facility = Annotated[int, Field(strict=True, ge=0, le=1)]
Rating = Annotated[int, Field(strict=True, ge=1, le=5)]


class InspectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transport: Score | None = None
    commute_road: Score | None = None
    school: Score | None = None
    academy: Score | None = None
    convenience: Score | None = None
    noise: Score | None = None
    harmful_facility: Facility | None = None
    parking: Score | None = None
    sunlight: Score | None = None
    natural_light: Score | None = None
    leak_mold: Score | None = None
    wallpaper: Score | None = None
    water_pressure: Score | None = None
    toilet_drain: Score | None = None
    drain_smell: Score | None = None
    window_condition: Score | None = None
    heating: Score | None = None
    floor_noise: Score | None = None
    overall_rating: Rating
    memo: str = Field(default="", max_length=2000)


class InspectionRecord(InspectionCreate):
    """저장된 임장 기록 1건. GET과 POST가 똑같이 이 모양으로 돌려준다.

    InspectionCreate를 물려받아 18개 항목·종합 평점·메모를 그대로 갖고,
    DB가 채우는 값 네 개를 더한다. 예전 201 응답({id, property_id,
    created_at})을 그대로 포함하므로 그 세 값만 읽던 쪽은 영향이 없다.
    """

    model_config = ConfigDict(from_attributes=True, extra="ignore")

    id: int
    property_id: int
    created_at: datetime
    updated_at: datetime


class InspectionListResponse(BaseModel):
    """내 후보의 임장 기록 전체. 후보 카드에 점수를 띄우려면 목록 단계에서
    모든 후보의 항목 점수가 필요해서 한 번에 준다(후보마다 한 번씩 부르면 느리다).

    후보 목록 응답(DashboardItemWithMetrics)에 섞지 않는 이유: 그 모양은 그룹
    상세와 공유 링크 응답에도 함께 쓰여서, 거기에 임장 값을 넣으면 로그인 없이
    보는 공유 링크로 임장 기록이 새어 나간다.
    """

    items: list[InspectionRecord]
    count: int


class InspectionProperty(BaseModel):
    id: int
    size_id: int
    complex_name: str | None
    dong: str | None
    ho: str | None
    representative_area: float | None
    pyeong: int | None
    floor: int | None
    list_price: int | None
