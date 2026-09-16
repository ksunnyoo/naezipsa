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


# --- 점수 계산 (AI 분석에 임장 기록을 넘기기 위해, 2026-09-17) ----------------
#
# 화면(frontend/lib/checklist.js)과 같은 규칙을 파이썬으로 옮긴 것이다. 화면 점수와
# AI가 보는 점수가 달라지면 사용자가 바로 알아채므로, 규칙을 바꿀 때는 양쪽을 함께
# 고쳐야 한다(양쪽 테스트가 같은 예시로 같은 값을 확인한다).

# 카테고리별 항목. 화면의 CHECKLIST_GROUPS와 구성이 같다.
CATEGORY_ITEMS = {
    "transport_group": ("transport", "commute_road"),
    "education_life_group": ("school", "academy", "convenience", "noise", "harmful_facility"),
    "complex_group": ("parking", "sunlight", "natural_light"),
    "interior_condition_group": (
        "leak_mold", "wallpaper", "water_pressure", "toilet_drain", "drain_smell",
    ),
    "facility_group": ("window_condition", "heating", "floor_noise"),
}

# 이용 목적에서 고르는 기본 가중치. 화면의 CATEGORY_WEIGHTS와 값이 같다.
JEONSE_WEIGHTS = {
    "transport_group": 30, "education_life_group": 10, "complex_group": 15,
    "interior_condition_group": 30, "facility_group": 15,
}
BUY_WEIGHTS = {
    "transport_group": 30, "education_life_group": 20, "complex_group": 25,
    "interior_condition_group": 15, "facility_group": 10,
}
_MIDDLE_WEIGHTS = {
    key: (JEONSE_WEIGHTS[key] + BUY_WEIGHTS[key]) / 2 for key in SCORING_CATEGORIES
}


def _item_score(key, value):
    """항목 하나를 1~3 자로 옮긴다. 유해시설만 0=없음(좋음)이라 방향이 반대다."""
    if value is None:
        return None
    if key == "harmful_facility":
        return 3 if value == 0 else 1
    return value


def weights_for(scoring_weights, service_purposes):
    """쓸 가중치를 고른다: 정해둔 기준 > 이용 목적 기본값."""
    if scoring_weights and all(
        isinstance(scoring_weights.get(category), (int, float))
        for category in SCORING_CATEGORIES
    ):
        return scoring_weights
    purposes = set(service_purposes or [])
    wants_jeonse = "jeonse" in purposes
    wants_buy = bool(purposes & {"buy", "invest"})
    if wants_jeonse and not wants_buy:
        return JEONSE_WEIGHTS
    if wants_buy and not wants_jeonse:
        return BUY_WEIGHTS
    return _MIDDLE_WEIGHTS


def compute_score(values, weights):
    """체크한 항목으로 100점 만점 점수를 낸다. 하나도 없으면 None.

    묶음마다 항목 수가 달라(교통 2개, 교육·생활 5개) 18개를 그냥 더하면 항목이 많은
    묶음이 자동으로 세진다. 묶음 안에서 평균을 낸 뒤 가중치를 곱한다. 가중치 "합"으로
    나눠 정규화하므로 비중을 어떻게 정하든 만점은 항상 100이다.
    """
    weighted = 0.0
    weight_sum = 0.0
    for category, keys in CATEGORY_ITEMS.items():
        scores = [score for score in (_item_score(key, values.get(key)) for key in keys)
                  if score is not None]
        if not scores:
            continue
        weight = weights.get(category, 0)
        weighted += (sum(scores) / len(scores)) * weight
        weight_sum += weight
    if weight_sum == 0:
        return None
    on_three = weighted / weight_sum
    return round(((on_three - 1) / 2) * 100)
