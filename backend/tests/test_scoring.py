"""임장 점수 계산(app/core/scoring.py)과 AI 프롬프트에 실리는 임장 문장.

화면(frontend/lib/checklist.js)과 같은 규칙을 파이썬으로 옮긴 것이라, **화면 테스트와
같은 예시로 같은 값**을 확인한다(frontend/tests/inspection-checklist.test.js 참고).
두 값이 갈라지면 사용자가 카드에서 본 점수와 AI가 말하는 점수가 달라진다.
"""
from types import SimpleNamespace

import pytest

from app.core.scoring import (
    BUY_WEIGHTS,
    CATEGORY_ITEMS,
    JEONSE_WEIGHTS,
    SCORING_CATEGORIES,
    compute_score,
    weights_for,
)
from app.insight.service import _describe, _inspection_text

ALL_KEYS = tuple(key for keys in CATEGORY_ITEMS.values() for key in keys)


def all_items(value, harmful):
    values = {key: value for key in ALL_KEYS}
    values["harmful_facility"] = harmful
    return values


def test_all_good_is_100_all_bad_is_0():
    assert compute_score(all_items(3, 0), BUY_WEIGHTS) == 100
    assert compute_score(all_items(1, 1), BUY_WEIGHTS) == 0


def test_unchecked_items_are_left_out():
    # 교통 묶음만 "좋음"으로 채우면 나머지를 비워둬도 점수가 깎이지 않는다.
    assert compute_score({"transport": 3, "commute_road": 3}, BUY_WEIGHTS) == 100
    # 같은 묶음 안에서는 고른 항목끼리만 평균: (3+1)/2 = 2 -> 50점
    assert compute_score({"transport": 3, "commute_road": 1}, BUY_WEIGHTS) == 50


def test_nothing_checked_has_no_score():
    assert compute_score({}, BUY_WEIGHTS) is None
    assert compute_score({key: None for key in ALL_KEYS}, BUY_WEIGHTS) is None


def test_full_marks_stay_100_however_weights_are_set():
    """가중치 합이 100이 아니어도 만점은 100이다(합으로 나눠 정규화하기 때문)."""
    odd = {category: 50 for category in SCORING_CATEGORIES}
    assert compute_score(all_items(3, 0), odd) == 100
    assert compute_score(all_items(1, 1), odd) == 0


def test_harmful_facility_direction_is_inverted():
    """유해시설만 0=없음(좋음)이라 다른 항목과 방향이 반대다."""
    none = compute_score({"harmful_facility": 0}, BUY_WEIGHTS)
    exists = compute_score({"harmful_facility": 1}, BUY_WEIGHTS)
    assert none == 100 and exists == 0


def test_jeonse_and_buy_score_the_same_checks_differently():
    # 내부 상태는 좋고 단지는 나쁜 집: 전세가 내부 상태를 더 크게 본다.
    values = {
        "leak_mold": 3, "wallpaper": 3, "water_pressure": 3, "toilet_drain": 3,
        "drain_smell": 3, "parking": 1, "sunlight": 1, "natural_light": 1,
    }
    assert compute_score(values, JEONSE_WEIGHTS) > compute_score(values, BUY_WEIGHTS)


@pytest.mark.parametrize("purposes,expected", [
    (["jeonse"], JEONSE_WEIGHTS),
    (["buy"], BUY_WEIGHTS),
    (["invest"], BUY_WEIGHTS),
    (["move", "buy"], BUY_WEIGHTS),
])
def test_weights_from_service_purposes(purposes, expected):
    assert weights_for(None, purposes) == expected


@pytest.mark.parametrize("purposes", [["jeonse", "buy"], [], None, ["move"]])
def test_both_or_none_uses_the_middle(purposes):
    middle = weights_for(None, purposes)
    assert middle["transport_group"] == 30  # 교통은 양쪽 다 30이라 그대로
    assert middle["interior_condition_group"] == (30 + 15) / 2


def test_saved_weights_beat_service_purposes():
    mine = {category: 20 for category in SCORING_CATEGORIES}
    assert weights_for(mine, ["jeonse"]) == mine
    # 카테고리가 빠진 값은 믿지 않고 이용 목적 기본값으로 돌아간다.
    assert weights_for({"transport_group": 30}, ["jeonse"]) == JEONSE_WEIGHTS


# --- AI 프롬프트에 실리는 임장 문장 -----------------------------------------


def record(**values):
    row = {key: None for key in ALL_KEYS}
    row.update(values)
    return SimpleNamespace(memo="", **row)


def test_inspection_text_has_score_and_what_user_checked():
    text = _inspection_text(record(transport=3, water_pressure=1, harmful_facility=0), BUY_WEIGHTS)

    assert "임장 점수" in text and "100점 만점" in text
    assert "transport 좋음" in text
    assert "water_pressure 나쁨" in text
    assert "유해시설 없음" in text  # 0/1은 좋음·나쁨이 아니라 있음·없음으로 쓴다


def test_inspection_text_is_none_without_record_or_checks():
    assert _inspection_text(None, BUY_WEIGHTS) is None
    assert _inspection_text(record(), BUY_WEIGHTS) is None


def test_inspection_memo_is_included():
    row = record(transport=2)
    row.memo = "곰팡이 냄새 남"
    assert "임장 메모: 곰팡이 냄새 남" in _inspection_text(row, BUY_WEIGHTS)


def test_describe_appends_inspection_only_when_present():
    item = SimpleNamespace(
        id=7, complex_name="테스트 아파트", legal_dong_name="역삼동", build_year=2020,
        representative_area=84.95, pyeong=34, list_price=None, floor=None, dong=None,
        direction=None, interior_state=None, memo=None, metrics=None,
    )
    assert "임장" not in _describe(item)
    assert "임장 점수" in _describe(item, _inspection_text(record(transport=3), BUY_WEIGHTS))
