"""[user] schema — 프로필 API의 요청·응답 형태. "어떻게 주고받는가".

흐름   router 가 입력 검증과 출력 변환에 사용
짝     같은 폴더의 model.py 는 "어떻게 저장되는가"
소유   A

프로필 API의 요청·응답 형태 (A 담당).

DB 모델(app/user/model.py)이 "저장 형태"라면, 이 파일은 "주고받는 형태"다.

이름은 팀 "변수명 통일" 표를 따른다.
enum 성격의 값은 DB에 VARCHAR로 저장하고 허용값 검증은 여기(Pydantic)에서 한다.
Literal을 쓰면 /docs 문서에도 선택지가 그대로 노출된다.
"""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.scoring import ScoringWeights

AgeGroup = Literal["20s", "30s", "40s", "50s", "60s+"]
ServicePurpose = Literal["move", "buy", "jeonse", "invest"]


class ProfileResponse(BaseModel):
    """A-01, A-02: GET/PATCH /users/me/profile 응답."""

    # ORM 객체(Profile)를 그대로 반환해도 Pydantic이 알아서 변환하게 한다.
    model_config = ConfigDict(from_attributes=True)

    # DB 컬럼명은 id지만, 명세상 응답 키는 user_id다.
    user_id: uuid.UUID = Field(validation_alias="id", serialization_alias="user_id")
    nickname: str | None = None
    age_group: AgeGroup | None = None
    service_purposes: list[ServicePurpose] | None = None
    # 내 기본 임장 점수 기준. null이면 따로 정하지 않은 것이라 화면이 이용 목적
    # (전세/매매)의 기본값으로 점수를 낸다.
    scoring_weights: ScoringWeights | None = None
    created_at: datetime
    updated_at: datetime


class ProfileUpdateRequest(BaseModel):
    """A-02: PATCH /users/me/profile 요청. 보낸 필드만 바꾼다.

    email은 Supabase Auth가 관리하므로 여기서 바꾸지 않는다.
    세 항목 모두 선택값이라 null을 명시적으로 보내면 "지우기"가 된다.
    "안 보냄"과 "null 보냄"은 model_fields_set으로 구분한다.
    """

    nickname: str | None = Field(default=None, min_length=1, max_length=30)
    age_group: AgeGroup | None = None
    service_purposes: list[ServicePurpose] | None = Field(default=None, max_length=4)
    # null을 명시적으로 보내면 기본 기준을 지운다(이용 목적 기반 기본값으로 돌아간다).
    scoring_weights: ScoringWeights | None = None
