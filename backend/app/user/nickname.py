"""[user] nickname — 랜덤 닉네임("반포사는호랑이"처럼 수식어 + 동물).

흐름   deps(프로필 생성) / router(닉네임 비우기) ▶ ★nickname
소유   A

두 목록에서 하나씩 골라 붙인다. 목록은 어느 쪽끼리 붙여도 자연스러운 말만 골라 두고,
그래도 어색하거나 부적절한 조합은 버리고 다시 뽑는다.

  - 두 단어가 붙는 자리에서 같은 소리가 반복되는 조합("반포사는사자", "…한한…")
  - 붙이면서 우연히 부적절한 표현이 생기는 조합
  - 너무 짧거나 긴 이름
"""
import random

# 동네에 사는 · 집 구하는 중 · 성격. 모두 뒤에 동물 이름이 붙는 꾸밈말 모양이다.
MODIFIERS = (
    "반포사는", "잠실사는", "성수사는", "마포사는", "판교사는", "분당사는", "목동사는", "송도사는",
    "용산사는", "여의도사는", "광교사는", "일산사는", "위례사는", "평촌사는", "동탄사는", "은평사는",
    "임장가는", "청약넣는", "이사가는", "집보러가는", "발품파는", "도면보는",
    "꼼꼼한", "부지런한", "느긋한", "든든한", "씩씩한", "다정한", "명랑한", "차분한", "똑똑한",
    "용감한", "상냥한", "야무진", "당당한", "알뜰한", "반짝이는", "호기심많은",
)

ANIMALS = (
    "호랑이", "고양이", "다람쥐", "펭귄", "수달", "판다", "코끼리", "부엉이", "돌고래", "너구리",
    "알파카", "햄스터", "강아지", "사슴", "고래", "여우", "토끼", "오리", "참새", "거북이",
    "기린", "하마", "미어캣", "고슴도치", "치타", "사자", "코알라", "해달", "비버", "라쿤",
)

MIN_LENGTH = 4
MAX_LENGTH = 10
FALLBACK_NICKNAME = "꼼꼼한다람쥐"
_MAX_ATTEMPTS = 50

# 두 단어가 붙으면서 우연히 생길 수 있는 부적절한 표현. 하나라도 들어 있으면 쓰지 않는다.
_BLOCKED_WORDS = ("시발", "씨발", "병신", "새끼", "개새", "존나", "좆", "지랄", "미친", "죽어", "섹스")


def is_natural(modifier: str, animal: str) -> bool:
    """수식어와 동물을 붙인 닉네임이 자연스러운지."""
    nickname = modifier + animal
    if not MIN_LENGTH <= len(nickname) <= MAX_LENGTH:
        return False
    if any(word in nickname for word in _BLOCKED_WORDS):
        return False
    # 붙는 자리에서 같은 소리가 반복되면 발음이 꼬이고 어색하다(받침은 무시하고 비교).
    #   "든든한" + "하마"   -> 바로 붙은 소리가 같음("한하")
    #   "반포사는" + "사자" -> 한 글자 건너 같은 소리("사는사자")
    head = _sound(animal[0])
    if head is not None and head in (_sound(modifier[-1]), _sound(modifier[-2]) if len(modifier) >= 2 else None):
        return False
    return True


def _sound(char: str) -> int | None:
    """한글 한 글자에서 받침을 뺀 소리(첫소리 + 가운뎃소리). 한글이 아니면 None."""
    code = ord(char) - 0xAC00
    return code // 28 if 0 <= code < 11172 else None


def random_nickname(rng: random.Random | None = None) -> str:
    """자연스러운 조합이 나올 때까지 다시 뽑는다. 끝내 못 찾으면 고정 닉네임을 쓴다."""
    rng = rng or random.SystemRandom()
    for _ in range(_MAX_ATTEMPTS):
        modifier, animal = rng.choice(MODIFIERS), rng.choice(ANIMALS)
        if is_natural(modifier, animal):
            return modifier + animal
    return FALLBACK_NICKNAME
