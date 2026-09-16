"""Phase 2 AI 개인화 회귀 검사. 실제 DB와 LLM 호출 없이 라우터부터 검증한다."""
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.core.errors import register_exception_handlers
from app.insight import llm, router, service

INSIGHT_URL = "/api/v1/dashboard/insight"
# 이용 목적이 없을 때 LLM에 가는 기본 지시문 전체. 개인화가 이 지시문을 바꾸지 않고 뒤에
# 덧붙이기만 하는지 확인하는 기준이다. 2026-09-15 PR #15에서 "후보 id를 문장에 쓰지 않는다"
# 규칙이 추가되어 함께 반영했다.
_ORIGINAL_SYSTEM_PROMPT = """당신은 한국 아파트 매매를 돕는 분석가입니다.
사용자가 후보로 담아둔 매물들의 지표를 보고 비교 분석을 제공합니다.

반드시 지킬 것:
- 주어진 숫자만 근거로 삼습니다. 데이터에 없는 사실(학군, 교통, 개발 호재 등)을
  지어내지 않습니다.
- 금액 단위는 원입니다. 사용자에게 보여줄 때는 "3억 2,000만원"처럼 읽기 쉽게 씁니다.
- 강점과 약점은 각각 1~3개, 한 줄씩 씁니다.
- 지표가 없는(null) 항목은 "거래가 적어 판단이 어렵다"고 솔직히 씁니다.
- 투자를 권유하거나 단정하지 않습니다. 판단 근거만 제시합니다.
- "[후보 id=...]"는 내부적으로 후보를 구분하기 위한 값입니다. summary와
  strengths/weaknesses 문장에는 이 id를 절대 언급하거나 "(id=123)" 같은
  형태로 괄호에 넣지 않습니다. 단지명만으로 자연스럽게 씁니다.
- 모든 답변은 한국어로 씁니다."""


@pytest.fixture(autouse=True)
def auto_cleanup(monkeypatch):
    """공통 conftest의 실제 DB 정리 fixture를 대체하고 외부 호출을 차단한다."""
    def forbidden(*args, **kwargs):
        pytest.fail("격리 테스트에서 실제 DB/LLM/네트워크 호출을 시도했습니다.")

    monkeypatch.setattr(Engine, "connect", forbidden)
    monkeypatch.setattr(requests.sessions.Session, "request", forbidden)
    monkeypatch.setattr(llm, "ask_json", forbidden)


def _item(item_id):
    return SimpleNamespace(
        id=item_id,
        complex_name="테스트 단지",
        legal_dong_name="테스트동",
        build_year=2000,
        representative_area=None,
        list_price=500_000_000,
        floor=None,
        dong=None,
        direction=None,
        interior_state=None,
        memo=None,
        metrics=None,
    )


@pytest.fixture
def insight_context(monkeypatch):
    profile = SimpleNamespace(
        id=uuid4(), service_purposes=None, age_group="30s", nickname="private-nickname"
    )
    db = Mock(name="db")  # 트랜잭션 종료(commit)만 받는 가짜 세션
    get_items = Mock(return_value=[_item(11), _item(13)])
    ask = Mock(return_value={
        "summary": "후보 비교 요약",
        "items": [
            {"id": 11, "strengths": ["확인된 강점"], "weaknesses": ["확인된 약점"]},
            {"id": 999, "strengths": ["다른 사용자 후보"], "weaknesses": []},
        ],
    })
    monkeypatch.setattr(service, "get_items_with_metrics", get_items)
    monkeypatch.setattr(llm, "ask_json", ask)
    monkeypatch.setattr(llm, "is_configured", lambda: True)

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router.router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_profile] = lambda: profile
    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client, app=app, profile=profile, db=db, get_items=get_items, ask=ask
        )


def test_db_transaction_is_closed_before_llm_call(insight_context):
    """LLM 호출(최대 30초) 동안 DB 연결을 쥐고 있지 않도록 읽기 직후 트랜잭션을 끝낸다.

    연결 풀이 프로세스당 몇 개뿐이라, 트랜잭션을 연 채 LLM을 기다리면 동시에 들어온
    AI 분석 몇 건만으로 같은 서버의 다른 DB 요청이 전부 막힌다."""
    ctx = insight_context
    committed_before_llm = []
    reply = ctx.ask.return_value

    def ask(*args, **kwargs):
        committed_before_llm.append(ctx.db.commit.called)
        return reply

    ctx.ask.side_effect = ask

    response = ctx.client.post(INSIGHT_URL, json={"item_ids": [11]})

    assert response.status_code == 200
    assert committed_before_llm == [True]


@pytest.mark.parametrize("purposes", [None, [], ["unknown-purpose"]])
def test_missing_or_skipped_profile_keeps_original_prompts(insight_context, purposes):
    ctx = insight_context
    ctx.profile.service_purposes = purposes

    response = ctx.client.post(INSIGHT_URL, json={"item_ids": [11]})

    assert response.status_code == 200
    system_prompt, user_prompt, _ = ctx.ask.call_args.args
    assert system_prompt == _ORIGINAL_SYSTEM_PROMPT
    assert user_prompt == (
        "아래는 사용자가 담아둔 후보 매물 1건입니다.\n\n"
        "[후보 id=11] / 테스트 단지(테스트동, 2000년 준공) / "
        "내 호가 500,000,000원 / 시세 지표 없음(거래 데이터 부족)\n\n"
        "각 후보의 강점과 약점을 정리하고, 전체를 비교한 요약을 작성해 주세요.\n"
        "items의 id는 위 '후보 id=' 값을 그대로 사용하세요."
    )


def test_service_without_profile_argument_still_works(insight_context):
    ctx = insight_context

    response = service.build_insight(ctx.db, ctx.profile.id, None)

    assert [item.id for item in response.items] == [11, 13]
    assert ctx.ask.call_args.args[0] == _ORIGINAL_SYSTEM_PROMPT


@pytest.mark.parametrize(
    ("purpose", "expected_focus"),
    [
        ("move", "이사: 제공된 면적·준공연도·층·인테리어"),
        ("buy", "매수: 호가와 최근 대표가·거래범위"),
        ("jeonse", "전세: 제공된 전세가율"),
        ("invest", "투자: 거래량·평단가·전세가율"),
    ],
)
def test_selected_purpose_changes_emphasis_only(insight_context, purpose, expected_focus):
    ctx = insight_context
    ctx.profile.service_purposes = [purpose]

    response = ctx.client.post(INSIGHT_URL, json={})

    assert response.status_code == 200
    system_prompt, user_prompt, _ = ctx.ask.call_args.args
    assert system_prompt.startswith(_ORIGINAL_SYSTEM_PROMPT)
    assert expected_focus in system_prompt
    assert "소득·가족 구성·구매력을 추론하지 않습니다" in system_prompt
    assert "없는 정보는 알 수 없다고 밝힙니다" in system_prompt
    assert "내 호가 500,000,000원" in user_prompt
    assert ctx.profile.nickname not in system_prompt + user_prompt
    assert ctx.profile.age_group not in system_prompt + user_prompt


def test_multiple_purposes_are_combined_without_duplicate_guidance(insight_context):
    ctx = insight_context
    ctx.profile.service_purposes = ["buy", "move", "buy"]

    assert ctx.client.post(INSIGHT_URL, json={}).status_code == 200

    prompt = ctx.ask.call_args.args[0]
    assert prompt.count("매수:") == 1
    assert prompt.count("이사:") == 1
    assert "전세:" not in prompt
    assert "투자:" not in prompt


def test_age_and_nickname_are_never_read_by_insight(insight_context):
    class PurposeOnlyProfile:
        id = insight_context.profile.id
        service_purposes = ["buy"]

        @property
        def age_group(self):
            pytest.fail("AI가 나이대에 접근하면 안 됩니다.")

        @property
        def nickname(self):
            pytest.fail("AI가 닉네임에 접근하면 안 됩니다.")

    insight_context.app.dependency_overrides[get_current_profile] = PurposeOnlyProfile

    assert insight_context.client.post(INSIGHT_URL, json={}).status_code == 200


def test_personalization_preserves_owned_item_filter_and_response_schema(insight_context):
    ctx = insight_context
    ctx.profile.service_purposes = ["invest"]

    response = ctx.client.post(INSIGHT_URL, json={"item_ids": [11, 13, 999]})

    assert response.status_code == 200
    ctx.get_items.assert_called_once_with(ctx.db, ctx.profile.id)
    body = response.json()
    assert set(body) == {"summary", "items", "generated_at"}
    assert body["items"] == [
        {"id": 11, "strengths": ["확인된 강점"], "weaknesses": ["확인된 약점"]},
        {"id": 13, "strengths": [], "weaknesses": []},
    ]
    assert "후보 id=999" not in ctx.ask.call_args.args[1]
    assert ctx.ask.call_args.args[2] == {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "strengths": {"type": "array", "items": {"type": "string"}},
                        "weaknesses": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["id", "strengths", "weaknesses"],
                },
            },
        },
        "required": ["summary", "items"],
    }


def test_internal_candidate_ids_are_removed_from_ai_text(insight_context):
    """LLM이 내부 구분값을 "(id=11)"처럼 문장에 흘려도 응답 문장에는 남기지 않는다(PR #15)."""
    ctx = insight_context
    ctx.ask.return_value = {
        "summary": "테스트 단지(id=11)가 더 저렴합니다.",
        "items": [
            {"id": 11, "strengths": ["호가가 낮음 (ID: 11)"], "weaknesses": ["거래가 적음(id = 11)"]},
        ],
    }

    response = ctx.client.post(INSIGHT_URL, json={"item_ids": [11]})

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "테스트 단지가 더 저렴합니다."
    assert body["items"][0] == {"id": 11, "strengths": ["호가가 낮음"], "weaknesses": ["거래가 적음"]}


def test_only_other_users_ids_returns_400_without_llm(insight_context):
    ctx = insight_context
    ctx.profile.service_purposes = ["buy"]

    response = ctx.client.post(INSIGHT_URL, json={"item_ids": [999]})

    assert response.status_code == 400
    assert "분석할 후보가 없습니다" in response.json()["error"]["message"]
    ctx.get_items.assert_called_once_with(ctx.db, ctx.profile.id)
    ctx.ask.assert_not_called()


@pytest.mark.parametrize("purposes", [None, [], ["buy"]])
def test_llm_failure_retains_503_and_existing_error_format(insight_context, purposes):
    ctx = insight_context
    ctx.profile.service_purposes = purposes
    ctx.ask.side_effect = llm.LLMUnavailable("AI 분석 서버에 연결하지 못했습니다.")

    response = ctx.client.post(INSIGHT_URL, json={})

    assert response.status_code == 503
    assert response.json()["error"]["message"] == "AI 분석 서버에 연결하지 못했습니다."


def test_unconfigured_llm_does_not_query_items(insight_context, monkeypatch):
    monkeypatch.setattr(llm, "is_configured", lambda: False)

    response = insight_context.client.post(INSIGHT_URL, json={})

    assert response.status_code == 503
    insight_context.get_items.assert_not_called()
    insight_context.ask.assert_not_called()
