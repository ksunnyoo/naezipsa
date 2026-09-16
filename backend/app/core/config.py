"""[공용] core · config — .env의 환경변수를 한 곳에서 읽는다.

흐름   서버 시작 시 1회 로드. 다른 파일은 os.getenv 대신 여기서 import
소유   공용

환경변수를 한 곳에서 로드하는 설정 모듈.
다른 파일에서는 os.getenv를 직접 쓰지 않고 여기서 import해서 사용합니다.
"""
import os
from urllib.parse import unquote

import certifi
from dotenv import load_dotenv

load_dotenv()  # .env 파일 로드

# 2026-09: macOS(특히 python.org 설치본) + 가상환경 조합에서 시스템 인증서
# 저장소 대신 자체 SSL을 쓰다 보니, urllib 같은 저수준 HTTPS 호출이
# "SSL: CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate"로
# 실패하는 경우가 있다(PyJWT의 PyJWKClient가 Supabase JWKS 공개키를 받아올
# 때 이 문제로 매번 401이 났던 게 원인이었다 - 로그인 후 관심 매물 저장이
# 막혀있던 버그). requests 라이브러리는 certifi를 자동으로 쓰지만 urllib은
# 안 그래서, 여기서 한 번 맞춰준다(이미 설정된 값이 있으면 존중해서 덮어쓰지
# 않는다).
os.environ.setdefault("SSL_CERT_FILE", certifi.where())


def _decode_if_encoded(key: str) -> str:
    """공공데이터포털 서비스키는 발급 화면에 URL 인코딩된 형태
    (예: %2F, %2B, %3D 포함)로 표시되는 경우가 많다.
    인코딩된 키를 그대로 requests에 넘기면, requests가 다시 한 번
    인코딩해버려서(이중 인코딩) API 호출이 실패한다.
    '%'가 포함되어 있으면 디코딩해서 원래 키로 되돌려 놓는다.
    """
    if "%" in key:
        return unquote(key)
    return key


MOLIT_API_KEY = _decode_if_encoded(os.getenv("MOLIT_API_KEY", ""))
KAKAO_API_KEY = os.getenv("KAKAO_API_KEY", "")
REB_API_KEY = os.getenv("REB_API_KEY", "")
KOSIS_API_KEY = os.getenv("KOSIS_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
# 프론트엔드용(브라우저 노출 가능) / 백엔드용(노출 금지)으로 분리해서 관리한다.
# 현재 백엔드 코드는 둘 다 사용하지 않는다(REST API 대신 ORM으로 직접 접속).
# 프론트 담당자에게 넘겨줄 값이라 자리만 잡아둔 것이다.
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Supabase가 발급한 JWT의 서명을 검증할 때 쓰는 비밀키.
# 대시보드 -> Project Settings -> API -> JWT Settings -> JWT Secret
# 접속용 값이 아니라 "토큰이 위조되지 않았는지" 대조하는 용도다.
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

# ORM(SQLAlchemy)이 직접 DB에 접속할 때 쓰는 연결 문자열.
# Supabase 대시보드 -> Project Settings -> Database -> Connection string(URI)에서 확인.
# SUPABASE_URL/KEY(REST API용)와는 별개의 값이니 혼동하지 말 것.
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Alembic 마이그레이션 전용 연결 문자열(선택). 비어 있으면 DATABASE_URL을 쓴다.
# 앱은 트랜잭션 풀러(6543)로 붙고, DDL을 실행하는 마이그레이션은 세션 풀러(5432)나
# 직접 연결을 쓰는 것이 Supabase 권장이라 분리했다.
MIGRATION_DATABASE_URL = os.getenv("MIGRATION_DATABASE_URL", "")

# 앱 DB 연결 풀(프로세스당). 기본값은 여러 명이 로컬 서버를 함께 띄우는 개발 환경 기준.
# 요청 하나가 DB를 쓰는 동안 연결 하나를 쥐므로, 서버 프로세스 하나가 동시에 처리하는
# DB 요청 수는 DB_POOL_SIZE + DB_MAX_OVERFLOW를 넘지 못한다. 배포 시 부하에 맞춰 늘린다.
# 값이 비어 있어도(.env.example을 그대로 복사한 경우) 기본값을 쓴다.
DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE") or 3)
DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW") or 2)
DB_POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT") or 10)  # 연결을 기다리는 최대 초

# 필수 키가 비어있으면 앱 시작 시점에 바로 알 수 있도록 경고
_required = {
    "MOLIT_API_KEY": MOLIT_API_KEY,
    "DATABASE_URL": DATABASE_URL,
}
_missing = [k for k, v in _required.items() if not v]
if _missing:
    print(f"[경고] .env에 다음 값이 비어있습니다: {', '.join(_missing)}")
