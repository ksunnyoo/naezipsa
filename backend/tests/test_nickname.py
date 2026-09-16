"""랜덤 닉네임 규칙: 수식어 + 동물, 어색하거나 부적절한 조합은 다시 뽑는다."""
import random
from itertools import product

import pytest

from app.user import nickname as nick


@pytest.fixture(autouse=True)
def auto_cleanup():
    """상위 conftest의 실제 DB 정리 fixture를 사용하지 않는다."""
    yield


def _split(name):
    for modifier in nick.MODIFIERS:
        if name.startswith(modifier) and name[len(modifier):] in nick.ANIMALS:
            return modifier, name[len(modifier):]
    return None


def test_generated_nickname_is_a_natural_modifier_plus_animal():
    rng = random.Random(0)
    for _ in range(500):
        name = nick.random_nickname(rng)
        parts = _split(name)
        assert parts is not None, name
        assert nick.is_natural(*parts), name
        assert nick.MIN_LENGTH <= len(name) <= nick.MAX_LENGTH


def test_example_style_nickname_is_allowed():
    assert nick.is_natural("반포사는", "호랑이")


@pytest.mark.parametrize(("modifier", "animal"), [
    ("반포사는", "사자"),        # "사는사자" 같은 소리 반복
    ("반포사는", "사슴"),
    ("용감한", "한우"),          # 붙는 자리 글자가 같음
    ("든든한", "하마"),          # 받침만 다르고 같은 소리("한하")
    ("발품파는", "판다"),
    ("미친", "고양이"),          # 부적절한 표현
    ("아주아주아주아주긴", "고양이"),  # 너무 김
    ("큰", "소"),               # 너무 짧음
])
def test_awkward_or_inappropriate_combinations_are_rejected(modifier, animal):
    assert not nick.is_natural(modifier, animal)


def test_word_lists_are_clean_and_give_enough_variety():
    assert len(set(nick.MODIFIERS)) == len(nick.MODIFIERS)
    assert len(set(nick.ANIMALS)) == len(nick.ANIMALS)
    natural = [pair for pair in product(nick.MODIFIERS, nick.ANIMALS) if nick.is_natural(*pair)]
    assert len(natural) > 1000
    rng = random.Random(1)
    assert len({nick.random_nickname(rng) for _ in range(200)}) > 150


def test_falls_back_when_no_natural_combination_exists(monkeypatch):
    monkeypatch.setattr(nick, "MODIFIERS", ("반포사는",))
    monkeypatch.setattr(nick, "ANIMALS", ("사자",))

    assert nick.random_nickname(random.Random(0)) == nick.FALLBACK_NICKNAME
