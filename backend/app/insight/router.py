"""[insight] router — AI 종합분석 엔드포인트 (AI-01).

흐름   main ▶ security ▶ deps ▶ ★router ▶ service ▶ llm
경로   POST /api/v1/dashboard/insight
소유   A (대시보드 담당)

GET이 아니라 POST인 이유: 분석할 후보를 body로 골라 받고, 호출할 때마다
외부 LLM 비용이 발생하는 "행위"이기 때문이다. GET은 몇 번 불러도 부담이
없어야 한다는 기대가 있어서 브라우저나 프록시가 임의로 캐시·재요청할 수 있다.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_profile
from app.core.database import get_db
from app.insight import llm, service
from app.insight.schema import InsightRequest, InsightResponse
from app.user.model import Profile

router = APIRouter(prefix="/dashboard", tags=["insight"])


@router.post("/insight", response_model=InsightResponse)
def create_insight(
    payload: InsightRequest | None = None,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """AI-01: 내 후보들을 비교 분석한다.

        {}                      -> 내 후보 전체
        {"item_ids": [3, 7]}    -> 그중 둘만

    분석 결과는 저장하지 않는다(팀 명세: 초기 X). 부를 때마다 새로 만든다.
    지금 시세를 기준으로 한 해석이라 오래 보관할 값이 아니고,
    보관하면 "언제 기준인지" 관리가 또 필요해진다.
    """
    if not llm.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI 분석이 설정되지 않았습니다. 관리자에게 문의해 주세요.",
        )

    try:
        return service.build_insight(
            db,
            profile.id,
            (payload.item_ids if payload else None),
            service_purposes=profile.service_purposes,
        )
    except ValueError as e:
        # 후보가 하나도 없는 경우. 사용자가 고칠 수 있는 상황이라 400.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except llm.LLMUnavailable as e:
        # 외부 서비스 문제. 잠시 후 다시 하면 될 수 있으므로 503.
        # 분석이 실패해도 대시보드 자체는 멀쩡해야 한다.
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
