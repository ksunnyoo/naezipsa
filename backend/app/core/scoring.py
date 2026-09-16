"""임장 점수 가중치 — 프로필과 그룹이 함께 쓰는 정의.

가중치는 두 곳에 저장한다(2026-09-16 사용자 결정).

  - `profiles.scoring_weights` : 내 기본 기준. 그룹이 따로 정하지 않았을 때 쓴다.
  - `groups.scoring_weights`   : 그 그룹만의 기준. 있으면 프로필 기본을 이긴다.

둘이 같은 모양이라 검증 규칙을 여기 한 곳에 둔다. 한쪽만 고쳐 규칙이 갈라지면
같은 값이 한 곳에서는 저장되고 다른 곳에서는 422가 나는 상황이 생긴다.

카테고리 키는 화면의 체크리스트 묶음과 같다(frontend/lib/checklist.js의
CHECKLIST_GROUPS). 항목 18개는 모든 그룹·사용자가 공통이고 비중만 다르다.
"""
from pydantic import BaseModel, ConfigDict, Field, model_validator

SCORING_CATEGORIES = (
    "transport_group",
    "education_life_group",
    "complex_group",
    "interior_condition_group",
    "facility_group",
)


class ScoringWeights(BaseModel):
    """카테고리 비중.

    합이 100일 필요는 없다 - 점수를 낼 때 "고른 항목이 있는 묶음"의 가중치 합으로
    나눠 정규화하므로 비율만 의미가 있다. 다만 값을 읽고 고치는 사람이 헷갈리지
    않게 화면은 합 100을 기본으로 보여준다.
    """

    model_config = ConfigDict(extra="forbid")

    transport_group: int = Field(ge=0, le=100)
    education_life_group: int = Field(ge=0, le=100)
    complex_group: int = Field(ge=0, le=100)
    interior_condition_group: int = Field(ge=0, le=100)
    facility_group: int = Field(ge=0, le=100)

    @model_validator(mode="after")
    def require_one_positive(self):
        if all(value == 0 for value in self.model_dump().values()):
            raise ValueError("가중치를 하나 이상 0보다 크게 정해 주세요.")
        return self
