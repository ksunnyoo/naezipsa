"""AI 분석 LLM 호출: 생각 단계를 낮춘 설정과 일시 과부하 재시도. 실제 외부 호출은 하지 않는다."""
from types import SimpleNamespace

import pytest

from app.insight import llm


@pytest.fixture(autouse=True)
def auto_cleanup():
    """상위 conftest의 실제 DB 정리 fixture를 사용하지 않는다."""
    yield


class FakeResponse:
    def __init__(self, status_code, body=None, text=""):
        self.status_code = status_code
        self._body = body
        self.text = text

    def json(self):
        return self._body


def _ok(text):
    return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": text}]}}]})


@pytest.fixture
def gemini(monkeypatch):
    state = SimpleNamespace(payloads=[], responses=[], sleeps=[])

    def fake_post(url, params, json, timeout):
        state.payloads.append(json)
        return state.responses.pop(0)

    monkeypatch.setattr(llm, "GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(llm.requests, "post", fake_post)
    monkeypatch.setattr(llm.time, "sleep", state.sleeps.append)
    return state


def test_request_uses_low_thinking_and_returns_parsed_json(gemini):
    gemini.responses.append(_ok('{"summary": "요약", "items": []}'))

    assert llm.ask_json("시스템", "질문", {"type": "object"}) == {"summary": "요약", "items": []}

    config = gemini.payloads[0]["generationConfig"]
    assert config["thinkingConfig"] == {"thinkingLevel": "low"}
    assert config["temperature"] == 0.3
    assert config["responseSchema"] == {"type": "object"}
    assert gemini.sleeps == []


@pytest.mark.parametrize("status_code", [429, 503])
def test_temporary_overload_is_retried_once(gemini, status_code):
    gemini.responses += [FakeResponse(status_code, text="busy"), _ok('{"summary": "", "items": []}')]

    assert llm.ask_json("시스템", "질문", {}) == {"summary": "", "items": []}

    assert len(gemini.payloads) == 2
    assert gemini.sleeps == [llm._RETRY_DELAY_SECONDS]


def test_overload_twice_fails_without_further_retries(gemini):
    gemini.responses += [FakeResponse(503, text="busy"), FakeResponse(503, text="busy")]

    with pytest.raises(llm.LLMUnavailable):
        llm.ask_json("시스템", "질문", {})

    assert len(gemini.payloads) == 2


def test_other_errors_are_not_retried(gemini):
    gemini.responses.append(FakeResponse(400, text="bad request"))

    with pytest.raises(llm.LLMUnavailable):
        llm.ask_json("시스템", "질문", {})

    assert len(gemini.payloads) == 1
    assert gemini.sleeps == []
