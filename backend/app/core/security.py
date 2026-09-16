"""[공용] core · security — 토큰이 진짜인지 검증한다. (1단계)

흐름   main ▶ ★security ▶ core/deps ▶ {기능}/router
역할   서명·만료·aud 검증 → CurrentUser(id, email, role) 반환
소유   A (인증 담당). 수정 전 A와 상의

JWT 검증과 로그인 사용자 식별 (A 담당).

--- 전체 흐름 -------------------------------------------------------------

  1. 사용자가 프론트엔드에서 로그인          -> Supabase Auth 가 처리 (우리 서버 아님)
  2. Supabase 가 access_token(JWT) 발급      -> 프론트엔드가 보관
  3. 프론트가 우리 API를 부를 때 헤더에 첨부  -> Authorization: Bearer eyJhbGci...
  4. 우리는 그 토큰이 진짜인지 "검증"만 한다  -> 이 파일이 하는 일

우리는 비밀번호를 저장하지도, 로그인을 처리하지도 않는다.
Supabase가 서명해서 발급한 토큰이 위조/변조되지 않았는지만 확인한다.

--- JWT가 뭔가 ------------------------------------------------------------

점 두 개로 나뉜 문자열이다.

    eyJhbGciOiJIUzI1NiJ9 . eyJzdWIiOiJhYmMiLCJleHAiOjE3MzR9 . 4fJ2xK9...
    └─── 헤더 ────┘       └──────── 페이로드 ────────┘      └ 서명 ┘
       (서명 알고리즘)      (누구인지 sub + 만료시각 exp)      (위조 방지)

페이로드는 암호화가 아니라 그냥 Base64 인코딩이다. 누구나 열어볼 수 있으므로
비밀 정보를 담으면 안 된다. JWT의 안전성은 "내용을 숨기는 것"이 아니라
"비밀키 없이는 유효한 서명을 만들 수 없다"는 데서 나온다.

--- 검증이 확인하는 것 ----------------------------------------------------

  1) 서명  : 헤더+페이로드를 SUPABASE_JWT_SECRET으로 다시 해싱해 서명과 대조.
             누가 페이로드의 sub를 남의 ID로 바꾸면 서명이 안 맞아 즉시 걸린다.
  2) exp   : 만료된 토큰인지
  3) aud   : Supabase가 로그인 사용자에게 발급한 토큰이 맞는지 ("authenticated")

서명만 맞으면 DB를 조회할 필요가 없다. 그래서 세션 테이블 조회 없이 빠르다.

--- 비대칭키(ES256/RS256) 프로젝트 -----------------------------------

2026-09 확인: 이 프로젝트는 실제로 비대칭키(ES256)로 토큰을 서명한다
(HS256 + SUPABASE_JWT_SECRET로 고정 검증하던 예전 코드는 서명이 항상
안 맞아 모든 로그인 요청이 401로 막혔다 - 로그인 후 관심 매물 저장이
안 되는 버그로 발견됨). 그래서 아래는 헤더의 alg를 보고 두 갈래로
나눈다:

  - alg가 HS256      -> 기존처럼 SUPABASE_JWT_SECRET으로 검증
  - 그 외(ES256 등)   -> Supabase의 공개키(JWKS, /auth/v1/.well-known/
                         jwks.json)를 받아 그걸로 검증(PyJWKClient)

공개키는 비밀이 아니라서 안전하고, 대시보드 -> Project Settings ->
API -> JWT Keys에서 "Asymmetric"으로 뜨면 이 경로를 타는 게 맞다.
"""
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.core.config import SUPABASE_JWT_SECRET, SUPABASE_URL

# Supabase가 로그인한 사용자에게 발급하는 토큰의 aud 클레임 고정값
_EXPECTED_AUDIENCE = "authenticated"
_ALGORITHM = "HS256"

# 비대칭키로 서명된 토큰에서 허용할 알고리즘. Supabase가 실제로 쓰는 것만 적는다.
# "HS256이 아니면 전부 허용"으로 두면 안 되는 이유: 토큰 헤더의 alg는 서명을
# 확인하기 전 값이라 공격자가 마음대로 적을 수 있다. 그걸 그대로 decode()에
# 넘기면 우리가 의도한 적 없는 알고리즘(예: "none")까지 검증 경로에 들어온다.
# 실제로 "none"은 PyJWT가 키 검사에서 막아주긴 하지만, 거기서 나오는
# InvalidKeyError가 InvalidTokenError를 상속하지 않아 아래 except를 빠져나가
# 401이 아니라 500이 됐다. 들어올 수 있는 값을 먼저 좁히는 게 맞다.
_ASYMMETRIC_ALGORITHMS = frozenset({"ES256", "RS256"})

# JWKS(공개키 집합) 엔드포인트. SUPABASE_URL이 REST API용 /rest/v1/
# 접미사를 달고 있을 수 있어(프론트 lib/supabaseClient.js와 같은 이유로)
# 떼어내고 프로젝트 base URL만 쓴다.
_supabase_base_url = SUPABASE_URL.rstrip("/")
if _supabase_base_url.endswith("/rest/v1"):
    _supabase_base_url = _supabase_base_url[: -len("/rest/v1")]
_JWKS_URL = (
    f"{_supabase_base_url}/auth/v1/.well-known/jwks.json"
    if _supabase_base_url
    else ""
)

# PyJWKClient가 내부적으로 키 집합을 캐시해두기 때문에(기본 cache_keys=True),
# 요청마다 새로 만들지 않고 모듈 로드 시 한 번만 만든다.
_jwks_client = PyJWKClient(_JWKS_URL) if _JWKS_URL else None

# Swagger(/docs) 화면에 "Authorize" 버튼을 띄워주는 역할도 겸한다.
# auto_error=False 로 두면 헤더가 없을 때 FastAPI가 곧바로 403을 내지 않고
# 우리가 직접 401과 한글 메시지를 돌려줄 수 있다.
_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    """검증을 통과한 로그인 사용자. 여기 담긴 값은 위조될 수 없다."""

    id: str      # JWT의 sub 클레임 = auth.users.id (UUID 문자열)
    email: str   # JWT의 email 클레임
    role: str    # Supabase 내부 역할. 보통 "authenticated"

    # --- 아래는 소셜 로그인일 때만 채워진다 ---
    # 구글·카카오는 이름과 프로필 사진을 함께 주므로, 프로필을 처음 만들 때
    # 닉네임 초기값으로 쓴다. 이메일 가입은 이 값이 없어서 None이다.
    display_name: str | None = None
    avatar_url: str | None = None
    provider: str | None = None   # "email" / "google" / "kakao"


def _unauthorized(detail: str) -> HTTPException:
    # 401에는 WWW-Authenticate 헤더를 같이 주는 것이 HTTP 규약이다.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_token(token: str) -> dict:
    """토큰을 검증하고 페이로드를 돌려준다. 실패하면 401.

    라우터에서 직접 쓸 일은 없고, get_current_user가 호출한다.
    (테스트에서 단독으로 부르기 쉽도록 분리해 두었다)

    헤더의 alg를 먼저 들여다본다. 서명 검증 전 값이라 신뢰할 수 없으므로,
    "어느 방식으로 검증할지"를 고르는 데에만 쓰고 우리가 아는 알고리즘이
    아니면 그 자리에서 거절한다(_ASYMMETRIC_ALGORITHMS 참고).
    HS256이면 비밀키로, ES256/RS256이면 JWKS 공개키로 검증한다.
    """
    try:
        algorithm = jwt.get_unverified_header(token).get("alg", _ALGORITHM)
    except jwt.InvalidTokenError:
        raise _unauthorized("유효하지 않은 토큰입니다.")

    if not isinstance(algorithm, str):
        raise _unauthorized("유효하지 않은 토큰입니다.")

    try:
        if algorithm == _ALGORITHM:
            if not SUPABASE_JWT_SECRET:
                # 설정 실수를 401(사용자 잘못)이 아니라 500(서버 잘못)으로 구분해서 알린다.
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=".env에 SUPABASE_JWT_SECRET이 설정되지 않아 토큰을 검증할 수 없습니다.",
                )
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=[_ALGORITHM],
                audience=_EXPECTED_AUDIENCE,
                # 발급 서버와 시계가 달라도 로그인 직후 iat 때문에 거절하지 않는다.
                # 만료(exp), 사용 시작(nbf), 대상(aud), 서명 검증은 유지한다.
                options={"verify_iat": False},
            )
        elif algorithm in _ASYMMETRIC_ALGORITHMS:
            if _jwks_client is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=".env에 SUPABASE_URL이 설정되지 않아 JWKS로 토큰을 검증할 수 없습니다.",
                )
            # kid(키 id)로 지금 유효한 공개키를 골라온다.
            # algorithms에는 위에서 허용 목록에 들어있다고 확인한 값만 넘긴다.
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[algorithm],
                audience=_EXPECTED_AUDIENCE,
                # HS256과 동일하게 iat 검증만 제외한다.
                options={"verify_iat": False},
            )
        else:
            # "none"을 비롯해 우리가 쓰지 않는 알고리즘. 검증 시도조차 하지 않는다.
            raise _unauthorized("유효하지 않은 토큰입니다.")
    except jwt.ExpiredSignatureError:
        raise _unauthorized("토큰이 만료되었습니다. 다시 로그인해 주세요.")
    except jwt.InvalidAudienceError:
        raise _unauthorized("이 서비스용 토큰이 아닙니다.")
    except jwt.PyJWKClientError:
        # JWKS를 못 받아왔거나(네트워크 등) kid에 맞는 공개키가 없는 경우.
        raise _unauthorized("토큰 서명을 확인할 공개키를 가져오지 못했습니다.")
    except jwt.InvalidTokenError:
        # 서명 불일치, 형식 오류 등 나머지 전부.
        # 어느 쪽으로 실패했는지 자세히 알려주면 공격자에게 힌트가 되므로 뭉뚱그린다.
        raise _unauthorized("유효하지 않은 토큰입니다.")
    except jwt.PyJWTError:
        # PyJWT 예외 중 InvalidTokenError를 상속하지 않는 것들(InvalidKeyError 등).
        # 위의 허용 목록으로 이미 걸러지지만, 라이브러리가 바뀌어 새 예외가 생겨도
        # 토큰 문제가 500으로 새어나가지 않도록 남겨 둔다.
        raise _unauthorized("유효하지 않은 토큰입니다.")

    return payload


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser:
    """로그인이 필요한 엔드포인트에 붙이는 의존성.

    사용법:
        @router.get("/me")
        def read_me(user: CurrentUser = Depends(get_current_user)):
            return {"id": user.id}

    이 함수가 값을 돌려줬다는 것은 검증을 이미 통과했다는 뜻이다.
    """
    if credentials is None:
        raise _unauthorized("로그인이 필요합니다. Authorization 헤더가 없습니다.")

    payload = decode_token(credentials.credentials)

    user_id = payload.get("sub")
    if not user_id:
        raise _unauthorized("토큰에 사용자 정보(sub)가 없습니다.")

    # Supabase는 소셜 로그인으로 받아온 정보를 user_metadata에 넣어 준다.
    # 제공자마다 키 이름이 달라서(구글은 full_name, 카카오는 name 등) 순서대로 찾는다.
    meta = payload.get("user_metadata") or {}
    app_meta = payload.get("app_metadata") or {}

    return CurrentUser(
        id=user_id,
        email=payload.get("email", ""),
        role=payload.get("role", ""),
        display_name=_first_of(meta, "full_name", "name", "nickname", "preferred_username"),
        avatar_url=_first_of(meta, "avatar_url", "picture", "profile_image_url"),
        provider=app_meta.get("provider"),
    )


def _first_of(data: dict, *keys: str) -> str | None:
    """여러 후보 키 중 값이 있는 첫 번째를 돌려준다.

    소셜 제공자마다 같은 정보를 다른 이름으로 준다.
      구글   full_name, avatar_url
      카카오 name, profile_image_url
    새 제공자가 늘어도 여기 키만 추가하면 된다.
    """
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> CurrentUser | None:
    """로그인해도 되고 안 해도 되는 엔드포인트용.

    예: 단지 상세 조회는 누구나 볼 수 있지만, 로그인한 사람에게는
        "이미 즐겨찾기에 담았는지"를 같이 내려주고 싶을 때.

    헤더가 없으면 None을 준다. 단, 헤더가 있는데 토큰이 잘못됐다면
    조용히 넘기지 않고 401을 낸다. (만료된 토큰을 들고 온 사용자에게
    비로그인 화면을 보여주면 원인을 알 수 없어 더 혼란스럽다)
    """
    if credentials is None:
        return None
    return get_current_user(credentials)
