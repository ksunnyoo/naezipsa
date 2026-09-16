"""프로필 온보딩 계약을 기존 API로 검증한다. 실제 DB/외부 인증 서버는 사용하지 않는다."""

from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import security
from app.core.database import get_db
from app.core.errors import register_exception_handlers
from app.user.model import Profile
from app.user.nickname import ANIMALS, MODIFIERS
from app.user.router import router


PROFILE_URL = "/api/v1/users/me/profile"
TEST_SECRET = "phase2-profile-test-secret-at-least-32-bytes"


def is_random_nickname(value):
    """랜덤 닉네임 모양(수식어 + 동물)인지."""
    return isinstance(value, str) and any(
        value.startswith(modifier) and value[len(modifier):] in ANIMALS for modifier in MODIFIERS
    )


@pytest.fixture(autouse=True)
def auto_cleanup():
    """상위 conftest의 실제 DB 정리 fixture를 사용하지 않는다."""
    yield


class MemoryProfileSession:
    """요청마다 별도 ORM 객체를 읽고 commit한 값만 다음 요청에 전달한다."""

    def __init__(self, rows):
        self.rows = rows
        self.loaded = {}

    def get(self, model, user_id):
        assert model is Profile
        if user_id not in self.rows:
            return None
        profile = Profile(**deepcopy(self.rows[user_id]))
        self.loaded[user_id] = profile
        return profile

    def add(self, profile):
        self.loaded[profile.id] = profile

    def commit(self):
        now = datetime.now(timezone.utc)
        for user_id, profile in self.loaded.items():
            profile.created_at = profile.created_at or now
            profile.updated_at = now
            self.rows[user_id] = deepcopy({
                column.name: getattr(profile, column.name)
                for column in Profile.__table__.columns
            })

    def refresh(self, profile):
        for field, value in deepcopy(self.rows[profile.id]).items():
            setattr(profile, field, value)


@pytest.fixture
def profile_api(monkeypatch):
    """실제 JWT 검증/프로필 dependency/라우터를 유지하고 저장소만 대체한다."""
    monkeypatch.setattr(security, "SUPABASE_JWT_SECRET", TEST_SECRET)
    monkeypatch.setattr(security, "_jwks_client", None)
    rows = {}
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router, prefix="/api/v1")

    def memory_db():
        yield MemoryProfileSession(rows)

    app.dependency_overrides[get_db] = memory_db

    def headers(user_id):
        payload = {
            "sub": str(user_id),
            "email": "profile-test@example.com",
            "role": "authenticated",
            "aud": "authenticated",
            "exp": int(datetime.now(timezone.utc).timestamp()) + 3600,
        }
        token = jwt.encode(payload, TEST_SECRET, algorithm="HS256")
        return {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield SimpleNamespace(client=client, headers=headers, rows=rows)


def test_first_profile_has_null_purposes_for_onboarding(profile_api):
    user_id = uuid.uuid4()

    response = profile_api.client.get(PROFILE_URL, headers=profile_api.headers(user_id))

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == str(user_id)
    assert body["service_purposes"] is None
    # 닉네임은 비워 두지 않고 랜덤으로 시작한다.
    assert is_random_nickname(body["nickname"])
    assert body["age_group"] is None
    assert set(body) == {
        "user_id", "nickname", "age_group", "service_purposes", "created_at", "updated_at",
    }
    assert profile_api.rows[user_id]["service_purposes"] is None


@pytest.mark.parametrize("purposes", [["move", "buy"], ["jeonse"], ["invest"]])
def test_saved_profile_remains_complete_on_next_request(profile_api, purposes):
    user_id = uuid.uuid4()
    response = profile_api.client.patch(
        PROFILE_URL,
        headers=profile_api.headers(user_id),
        json={"nickname": "내집사", "age_group": "30s", "service_purposes": purposes},
    )
    assert response.status_code == 200
    assert response.json()["service_purposes"] == purposes

    # 새 요청/세션에서 읽어도 null로 되돌아가지 않아 온보딩 완료 판정을 유지한다.
    restored = profile_api.client.get(PROFILE_URL, headers=profile_api.headers(user_id))
    assert restored.status_code == 200
    assert restored.json()["service_purposes"] == purposes
    assert restored.json()["nickname"] == "내집사"
    assert restored.json()["age_group"] == "30s"


def test_skip_persists_empty_list_instead_of_null(profile_api):
    user_id = uuid.uuid4()
    headers = profile_api.headers(user_id)
    first = profile_api.client.get(PROFILE_URL, headers=headers).json()
    assert first["service_purposes"] is None

    skipped = profile_api.client.patch(
        PROFILE_URL, headers=headers, json={"service_purposes": []},
    )
    assert skipped.status_code == 200
    assert skipped.json()["service_purposes"] == []

    restored = profile_api.client.get(PROFILE_URL, headers=profile_api.headers(user_id))
    assert restored.status_code == 200
    assert restored.json()["service_purposes"] == []
    # 건너뛰기는 처음 받은 랜덤 닉네임을 바꾸지 않는다.
    assert restored.json()["nickname"] == first["nickname"]
    assert restored.json()["age_group"] is None


@pytest.mark.parametrize("purposes", [[], ["buy"]], ids=["skipped", "saved"])
def test_partial_patch_preserves_onboarding_state_and_other_fields(profile_api, purposes):
    headers = profile_api.headers(uuid.uuid4())
    saved = profile_api.client.patch(
        PROFILE_URL,
        headers=headers,
        json={"nickname": "첫이름", "age_group": "40s", "service_purposes": purposes},
    )
    assert saved.status_code == 200

    patched = profile_api.client.patch(PROFILE_URL, headers=headers, json={"nickname": "새이름"})
    assert patched.status_code == 200
    restored = profile_api.client.get(PROFILE_URL, headers=headers).json()
    assert restored["nickname"] == "새이름"
    assert restored["age_group"] == "40s"
    assert restored["service_purposes"] == purposes


def test_explicit_null_still_clears_purposes(profile_api):
    headers = profile_api.headers(uuid.uuid4())
    assert profile_api.client.patch(
        PROFILE_URL, headers=headers, json={"service_purposes": ["invest"]},
    ).status_code == 200

    cleared = profile_api.client.patch(
        PROFILE_URL, headers=headers, json={"service_purposes": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["service_purposes"] is None
    assert profile_api.client.get(PROFILE_URL, headers=headers).json()["service_purposes"] is None


def test_profile_completion_is_separate_for_each_user(profile_api):
    first_id, second_id = uuid.uuid4(), uuid.uuid4()
    first_headers = profile_api.headers(first_id)
    second_headers = profile_api.headers(second_id)
    assert profile_api.client.patch(
        PROFILE_URL, headers=first_headers, json={"service_purposes": ["buy"]},
    ).status_code == 200

    second = profile_api.client.get(PROFILE_URL, headers=second_headers)
    assert second.status_code == 200
    assert second.json()["user_id"] == str(second_id)
    assert second.json()["service_purposes"] is None
    assert profile_api.client.patch(
        PROFILE_URL, headers=second_headers, json={"service_purposes": []},
    ).status_code == 200

    first = profile_api.client.get(PROFILE_URL, headers=first_headers)
    assert first.status_code == 200
    assert first.json()["user_id"] == str(first_id)
    assert first.json()["service_purposes"] == ["buy"]


@pytest.mark.parametrize("method", ["get", "patch"])
def test_anonymous_profile_access_is_rejected_before_storage(profile_api, method):
    kwargs = {"json": {"service_purposes": []}} if method == "patch" else {}

    response = getattr(profile_api.client, method)(PROFILE_URL, **kwargs)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert profile_api.rows == {}


@pytest.mark.parametrize(
    "payload, field",
    [
        ({"service_purposes": ["unknown"]}, "body.service_purposes"),
        ({"service_purposes": "buy"}, "body.service_purposes"),
        ({"service_purposes": ["buy"] * 5}, "body.service_purposes"),
        ({"age_group": "99s"}, "body.age_group"),
    ],
)
def test_invalid_profile_values_keep_existing_state_and_error_format(profile_api, payload, field):
    headers = profile_api.headers(uuid.uuid4())
    assert profile_api.client.patch(
        PROFILE_URL, headers=headers, json={"service_purposes": []},
    ).status_code == 200

    response = profile_api.client.patch(PROFILE_URL, headers=headers, json=payload)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"][0]["field"].startswith(field)
    assert profile_api.client.get(PROFILE_URL, headers=headers).json()["service_purposes"] == []


def test_clearing_nickname_gives_a_new_random_nickname(profile_api):
    headers = profile_api.headers(uuid.uuid4())
    named = profile_api.client.patch(PROFILE_URL, headers=headers, json={"nickname": "내이름"})
    assert named.json()["nickname"] == "내이름"

    cleared = profile_api.client.patch(PROFILE_URL, headers=headers, json={"nickname": None})

    assert cleared.status_code == 200
    assert is_random_nickname(cleared.json()["nickname"])
    assert profile_api.client.get(PROFILE_URL, headers=headers).json()["nickname"] == cleared.json()["nickname"]


def test_existing_profile_without_nickname_gets_a_random_nickname_once(profile_api):
    user_id = uuid.uuid4()
    headers = profile_api.headers(user_id)
    profile_api.client.get(PROFILE_URL, headers=headers)
    profile_api.rows[user_id]["nickname"] = None  # 랜덤 닉네임 도입 전에 만들어진 계정

    filled = profile_api.client.get(PROFILE_URL, headers=headers).json()["nickname"]

    assert is_random_nickname(filled)
    assert profile_api.client.get(PROFILE_URL, headers=headers).json()["nickname"] == filled
