"""[insight] service — 후보들을 LLM에 넘길 형태로 정리하고 결과를 조립한다.

흐름   router ▶ ★service ▶ llm ▶ 외부 LLM API
참조   app/dashboard/service.py (같은 A 소유)
소유   A (대시보드 담당)

⚠️ 팀 명세 규칙: "원본 수백 건을 LLM에 직접 전달하지 않는다."
   거래 내역을 통째로 넘기면 비용이 크고 느리며, LLM이 숫자를 잘못 세기도 한다.
   이미 계산된 지표(대표가·평단가·전세가율 등)만 표로 만들어 넘긴다.
   계산은 코드가 하고, LLM은 해석만 한다.
"""
import datetime as dt
import re

from sqlalchemy.orm import Session

from app.dashboard.service import get_items_with_metrics
from app.insight import llm
from app.insight.schema import InsightResponse, ItemInsight

_SYSTEM_PROMPT = """당신은 한국 아파트 매매를 돕는 분석가입니다.
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

# 기존 프로필의 허용값만 고정 안내로 변환한다. 나이·닉네임은 LLM에 전달하지 않는다.
_PURPOSE_GUIDANCE = {
    "move": "이사: 제공된 면적·준공연도·층·인테리어 정보의 차이를 중심으로 비교합니다.",
    "buy": "매수: 호가와 최근 대표가·거래범위의 차이를 중심으로 비교합니다.",
    "jeonse": "전세: 제공된 전세가율을 중심으로 비교하되, 보증금 반환 안전성을 단정하지 않습니다.",
    "invest": "투자: 거래량·평단가·전세가율을 중심으로 비교하되, 수익을 예측하거나 투자를 권유하지 않습니다.",
}

# LLM이 이 형태로만 답하도록 강제한다. 줄글로 오면 프론트가 파싱할 수 없다.
_RESPONSE_SCHEMA = {
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


# 프롬프트로 "id를 언급하지 말라"고 지시해도 LLM이 가끔 흘려서 쓸 수 있다
# ([후보 id=921] 형태를 그대로 본떠 "올림픽파크포레온(id=921)"처럼 씀). 화면에
# 그대로 노출되면 사용자에게는 의미 없는 내부 값이라 결과를 돌려주기 전에
# 한 번 더 깎아낸다 - "(id=921)", "(ID: 921)"처럼 대소문자/구분자가 조금
# 달라도 걸리게 느슨하게 잡는다.
_ID_PAREN_RE = re.compile(r"\s*\(\s*id\s*[:=]\s*\d+\s*\)", re.IGNORECASE)


def _strip_id_mentions(text: str) -> str:
    return _ID_PAREN_RE.sub("", text or "").strip()


def _describe(item) -> str:
    """후보 한 건을 LLM이 읽을 한 줄로 만든다.

    JSON을 그대로 던지지 않고 사람이 읽는 문장으로 바꾸는 이유:
    같은 정보라도 이쪽이 토큰을 덜 쓰고 LLM이 덜 헷갈린다.
    """
    parts = [f"[후보 id={item.id}]"]
    parts.append(f"{item.complex_name or '단지명 미상'}"
                 f"({item.legal_dong_name or '-'}, {item.build_year or '?'}년 준공)")
    if item.representative_area:
        parts.append(f"전용 {item.representative_area}㎡({item.pyeong}평)")

    if item.list_price:
        parts.append(f"내 호가 {item.list_price:,}원")
    for label, value in (("층", item.floor), ("동", item.dong), ("향", item.direction),
                         ("인테리어", item.interior_state)):
        if value:
            parts.append(f"{label} {value}")
    if item.memo:
        parts.append(f"내 메모: {item.memo}")

    m = item.metrics
    if m is None:
        parts.append("시세 지표 없음(거래 데이터 부족)")
    else:
        if m.recent_median_price:
            parts.append(f"최근 대표가 {m.recent_median_price:,}원")
        if m.min_price and m.max_price:
            parts.append(f"거래범위 {m.min_price:,}~{m.max_price:,}원")
        if m.price_per_pyeong:
            parts.append(f"평단가 {m.price_per_pyeong:,}원")
        if m.trade_count_3y is not None:
            parts.append(f"3년 거래 {m.trade_count_3y}건")
        if m.jeonse_ratio is not None:
            parts.append(f"전세가율 {m.jeonse_ratio}%")
        if m.last_trade_date:
            parts.append(f"최종거래 {m.last_trade_date}")

    return " / ".join(parts)


def build_insight(
    db: Session,
    user_id,
    item_ids: list[int] | None,
    *,
    service_purposes: list[str] | None = None,
) -> InsightResponse:
    """내 후보들을 분석해 요약과 항목별 강점·약점을 만든다.

    item_ids를 줘도 "내 후보 중에서" 고른다. 남의 후보 id를 섞어 보내도
    애초에 목록에 없으므로 걸러진다(소유권 검사가 자동으로 따라온다).
    """
    items = get_items_with_metrics(db, user_id)
    # 필요한 DB 읽기는 여기서 끝난다. 아래 LLM 호출은 최대 30초가 걸리므로, 트랜잭션을
    # 열어둔 채 기다리면 그동안 DB 연결을 쥐고 있게 된다(연결 풀이 작아 다른 요청이 막힌다).
    # 결과는 ORM 객체가 아니라 Pydantic 모델이라 트랜잭션을 끝내도 그대로 쓸 수 있다.
    db.commit()
    if item_ids:
        wanted = set(item_ids)
        items = [i for i in items if i.id in wanted]

    if not items:
        raise ValueError("분석할 후보가 없습니다. 먼저 관심 매물을 담아 주세요.")

    lines = "\n".join(_describe(i) for i in items)
    user_prompt = (
        f"아래는 사용자가 담아둔 후보 매물 {len(items)}건입니다.\n\n"
        f"{lines}\n\n"
        "각 후보의 강점과 약점을 정리하고, 전체를 비교한 요약을 작성해 주세요.\n"
        "items의 id는 위 '후보 id=' 값을 그대로 사용하세요."
    )

    system_prompt = _SYSTEM_PROMPT
    guidance = [
        text for purpose, text in _PURPOSE_GUIDANCE.items()
        if purpose in (service_purposes or [])
    ]
    if guidance:
        system_prompt += (
            "\n\n사용자가 선택한 이용 목적에 맞춰 다음 강조점만 조정합니다:\n"
            + "\n".join(f"- {text}" for text in guidance)
            + "\n- 나이대(age_group)나 이용 목적으로 소득·가족 구성·구매력을 추론하지 않습니다."
            "\n- 주어진 후보 정보와 지표만 사용하며, 없는 정보는 알 수 없다고 밝힙니다."
        )

    raw = llm.ask_json(system_prompt, user_prompt, _RESPONSE_SCHEMA)

    # LLM이 없는 id를 만들어내거나 빠뜨릴 수 있으므로 우리 목록 기준으로 맞춘다.
    by_id = {int(r["id"]): r for r in raw.get("items", []) if str(r.get("id", "")).isdigit()}
    results = [
        ItemInsight(
            id=i.id,
            strengths=[_strip_id_mentions(s) for s in by_id.get(i.id, {}).get("strengths", [])],
            weaknesses=[_strip_id_mentions(w) for w in by_id.get(i.id, {}).get("weaknesses", [])],
        )
        for i in items
    ]

    return InsightResponse(
        summary=_strip_id_mentions(raw.get("summary", "")),
        items=results,
        generated_at=dt.datetime.now(dt.timezone.utc),
    )
