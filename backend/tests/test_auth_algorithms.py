"""JWT 서명 알고리즘 분기 테스트 (HS256 / ES256 / RS256 / 허용하지 않는 것).

app/core/security.py의 decode_token은 토큰 헤더의 alg를 보고 검증 방식을 고른다.
그 alg는 서명을 확인하기 전 값이라 공격자가 마음대로 적을 수 있으므로,
"우리가 아는 알고리즘만 통과시키는지"를 여기서 확인한다.

기존 tests/test_auth.py는 전부 HS256 기준이라 ES256/JWKS 경로가 비어 있었다.
이 파일은 실제 EC 키를 만들어 그 경로까지 덮는다.
"""
import base64
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException

from app.core import security
from tests.conftest import PROFILE_URL


def _b64url(data: dict) -> str:
    raw = json.dumps(data, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _payload(sub: str | None = None) -> dict:
    return {
        "sub": sub or str(uuid.uuid4()),
        "aud": "authenticated",
        "role": "authenticated",
        "email": "tester@example.com",
        "exp": 9_999_999_999,
    }


def _unsigned_token(header: dict, payload: dict) -> str:
    """서명이 비어있는 토큰. alg=none 위조를 흉내 낸다."""
    return f"{_b64url(header)}.{_b64url(payload)}."


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKSClient:
    """PyJWKClient 대역. 네트워크 없이 정해둔 공개키 하나를 돌려준다."""

    def __init__(self, public_key):
        self._public_key = public_key
        self.calls = 0

    def get_signing_key_from_jwt(self, token):
        self.calls += 1
        return _FakeSigningKey(self._public_key)


@pytest.fixture
def es256_keypair():
    """ES256(P-256) 개인키/공개키 한 쌍."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    return private_key, private_key.public_key()


@pytest.fixture(params=["HS256", "ES256", "RS256"])
def sign_token(request, monkeypatch):
    """실제 서명은 검증하되 테스트 키만 쓰고 JWKS 네트워크는 사용하지 않는다."""
    algorithm = request.param
    if algorithm == "HS256":
        key = "phase1-test-jwt-secret-at-least-32-bytes"
        monkeypatch.setattr(security, "SUPABASE_JWT_SECRET", key)
    else:
        key = (
            ec.generate_private_key(ec.SECP256R1())
            if algorithm == "ES256"
            else rsa.generate_private_key(public_exponent=65537, key_size=2048)
        )
        monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(key.public_key()))

    def encode(payload):
        return jwt.encode(payload, key, algorithm=algorithm, headers={"kid": "test-key"})

    return encode


# --- 허용하지 않는 알고리즘은 401 -------------------------------------------

@pytest.mark.parametrize(
    "header",
    [
        pytest.param({"alg": "none", "typ": "JWT"}, id="none-kid없음"),
        pytest.param({"alg": "none", "typ": "JWT", "kid": "any-kid"}, id="none-kid있음"),
        pytest.param({"alg": "HS512", "typ": "JWT"}, id="HS512"),
        pytest.param({"alg": "ES384", "typ": "JWT", "kid": "any-kid"}, id="ES384"),
    ],
)
def test_unsupported_algorithm_is_rejected(client, monkeypatch, es256_keypair, header):
    """우리가 쓰지 않는 alg는 검증을 시도하지도 않고 401로 막는다.

    JWKS 클라이언트를 "kid가 뭐든 공개키를 돌려주는" 대역으로 바꿔둔다.
    실제 Supabase JWKS에 있는 kid를 공격자가 그대로 베껴 쓰는 상황과 같다
    (kid는 공개 정보다). 이 조건이어야 예전 코드의 버그가 재현된다:
    alg=none이 JWKS 분기로 들어가 PyJWT가 InvalidKeyError를 냈는데, 그 예외가
    InvalidTokenError를 상속하지 않아 except를 빠져나가 500이 됐다
    (비로그인 상태로 아무나 500을 유발할 수 있었다).
    """
    _, public_key = es256_keypair
    monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(public_key))

    token = _unsigned_token(header, _payload())
    res = client.get(PROFILE_URL, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401, res.text


def test_none_algorithm_never_reaches_jwks(client, monkeypatch, es256_keypair):
    """alg=none은 JWKS 공개키를 받아오는 단계까지 가지 않아야 한다."""
    _, public_key = es256_keypair
    fake = _FakeJWKSClient(public_key)
    monkeypatch.setattr(security, "_jwks_client", fake)

    token = _unsigned_token({"alg": "none", "typ": "JWT", "kid": "k1"}, _payload())
    res = client.get(PROFILE_URL, headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 401
    assert fake.calls == 0, "허용하지 않는 alg인데 JWKS를 조회했다"


@pytest.mark.parametrize("algorithm", [[], {}], ids=["array", "object"])
def test_non_string_algorithm_is_401_before_jwks(client, monkeypatch, algorithm):
    """조작한 alg 자료형은 서버 오류 대신 기존 401 오류 형식으로 거절한다."""
    fake = _FakeJWKSClient(None)
    monkeypatch.setattr(security, "_jwks_client", fake)
    token = _unsigned_token({"alg": algorithm, "kid": "test-key"}, _payload())

    res = client.get(PROFILE_URL, headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 401, res.text
    assert res.json()["error"]["code"] == "UNAUTHORIZED"
    assert res.headers["WWW-Authenticate"] == "Bearer"
    assert fake.calls == 0


# --- 재로그인 직후 발급 시각 차이와 기존 검증 유지 ----------------------------

def test_future_iat_is_accepted(sign_token):
    """Supabase 시계가 서버보다 앞서도 방금 발급받은 정상 토큰은 허용한다."""
    payload = _payload() | {"iat": int(time.time()) + 60}

    assert security.decode_token(sign_token(payload)) == payload


@pytest.mark.parametrize(
    "invalid_claim",
    [
        pytest.param({"exp": 1_000_000_000}, id="expired"),
        pytest.param({"nbf": 9_999_999_999}, id="not-yet-valid"),
        pytest.param({"aud": "another-service"}, id="wrong-audience"),
    ],
)
def test_future_iat_keeps_other_claim_validation(sign_token, invalid_claim):
    """iat 검증을 끄더라도 exp/nbf/aud가 잘못된 토큰은 계속 거절한다."""
    payload = _payload() | {"iat": int(time.time()) + 60} | invalid_claim

    with pytest.raises(HTTPException) as exc:
        security.decode_token(sign_token(payload))

    assert exc.value.status_code == 401
    assert exc.value.headers == {"WWW-Authenticate": "Bearer"}


def test_future_iat_keeps_signature_validation(sign_token):
    """새 토큰의 사용자 ID를 서명 변경 없이 바꿔도 원본 소유자로 인증되지 않는다."""
    payload = _payload() | {"iat": int(time.time()) + 60}
    header, _, signature = sign_token(payload).split(".")
    tampered = _b64url(payload | {"sub": str(uuid.uuid4())})

    with pytest.raises(HTTPException) as exc:
        security.decode_token(f"{header}.{tampered}.{signature}")

    assert exc.value.status_code == 401
    assert exc.value.headers == {"WWW-Authenticate": "Bearer"}


# --- ES256(비대칭키) 정상 경로 ----------------------------------------------

def test_es256_token_is_accepted(monkeypatch, es256_keypair):
    """JWKS가 돌려준 공개키로 서명이 확인되면 페이로드를 그대로 돌려준다."""
    private_key, public_key = es256_keypair
    monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(public_key))

    payload = _payload()
    token = jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": "k1"})

    decoded = security.decode_token(token)

    assert decoded["sub"] == payload["sub"]
    assert decoded["aud"] == "authenticated"


def test_es256_signed_by_other_key_is_rejected(monkeypatch, es256_keypair):
    """서명한 키와 JWKS의 공개키가 다르면 401. (공격자가 제 키로 서명한 경우)"""
    _, public_key = es256_keypair
    monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(public_key))

    attacker_key = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(_payload(), attacker_key, algorithm="ES256", headers={"kid": "k1"})

    with pytest.raises(Exception) as exc:
        security.decode_token(token)
    assert getattr(exc.value, "status_code", None) == 401


def test_es256_wrong_audience_is_rejected(monkeypatch, es256_keypair):
    """비대칭키 경로에서도 aud 검사는 그대로 걸린다."""
    private_key, public_key = es256_keypair
    monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(public_key))

    payload = _payload() | {"aud": "someone-else"}
    token = jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": "k1"})

    with pytest.raises(Exception) as exc:
        security.decode_token(token)
    assert getattr(exc.value, "status_code", None) == 401


def test_es256_expired_token_is_rejected(monkeypatch, es256_keypair):
    """비대칭키 경로에서도 만료 검사는 그대로 걸린다."""
    private_key, public_key = es256_keypair
    monkeypatch.setattr(security, "_jwks_client", _FakeJWKSClient(public_key))

    payload = _payload() | {"exp": 1_000_000_000}  # 2001년
    token = jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": "k1"})

    with pytest.raises(Exception) as exc:
        security.decode_token(token)
    assert getattr(exc.value, "status_code", None) == 401


def test_jwks_not_configured_is_500(monkeypatch, es256_keypair):
    """SUPABASE_URL이 없어 JWKS 클라이언트를 못 만든 경우는 설정 실수이므로 500."""
    private_key, _ = es256_keypair
    monkeypatch.setattr(security, "_jwks_client", None)

    token = jwt.encode(_payload(), private_key, algorithm="ES256", headers={"kid": "k1"})

    with pytest.raises(Exception) as exc:
        security.decode_token(token)
    assert getattr(exc.value, "status_code", None) == 500


# --- HS256 경로가 그대로인지 (회귀 방지) -------------------------------------

def test_hs256_still_uses_secret_not_jwks(monkeypatch, es256_keypair):
    """HS256 토큰은 JWKS를 건드리지 않고 비밀키로만 검증해야 한다.

    비대칭키 공개키를 HMAC 비밀키로 써서 통과시키는 알고리즘 혼동 공격이
    성립하지 않는지도 함께 확인한다.
    """
    _, public_key = es256_keypair
    fake = _FakeJWKSClient(public_key)
    monkeypatch.setattr(security, "_jwks_client", fake)
    monkeypatch.setattr(security, "SUPABASE_JWT_SECRET", "phase1-test-jwt-secret-at-least-32-bytes")

    token = jwt.encode(_payload(), "attacker-chosen-secret", algorithm="HS256")

    with pytest.raises(Exception) as exc:
        security.decode_token(token)
    assert getattr(exc.value, "status_code", None) == 401
    assert fake.calls == 0, "HS256인데 JWKS를 조회했다"
