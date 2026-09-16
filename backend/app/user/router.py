"""[user] router — 프로필 엔드포인트 (A-01, A-02).

흐름   main ▶ security ▶ deps ▶ ★router ▶ model / schema
경로   GET·PATCH /api/v1/users/me/profile
소유   A

A-01, A-02: 프로필 조회·수정.

로그인은 Supabase Auth가 처리하므로 이 파일에 회원가입·로그인 엔드포인트는 없다.
프론트가 Supabase에서 받은 토큰을 Authorization 헤더에 실어 보내면,
get_current_profile이 검증 + 프로필 조회까지 끝낸 상태로 넘겨준다.

온보딩 화면이든 대시보드의 프로필 화면이든 같은 엔드포인트를 쓴다.
어느 화면에서 호출해도 같은 사용자의 같은 프로필을 읽고 쓰게 된다.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_profile
from app.core.database import get_db
from app.user.model import Profile
from app.user.nickname import random_nickname
from app.user.schema import ProfileResponse, ProfileUpdateRequest

router = APIRouter(prefix="/users/me", tags=["users"])


@router.get("/profile", response_model=ProfileResponse)
def read_my_profile(profile: Profile = Depends(get_current_profile)):
    """A-01: 내 프로필 조회.

    첫 호출이면 profiles 행이 이 시점에 만들어진다.
    service_purposes가 null이면 온보딩 전, 빈 배열이면 건너뛰기 완료다.
    """
    return profile


@router.patch("/profile", response_model=ProfileResponse)
def update_my_profile(
    payload: ProfileUpdateRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-02: 내 프로필 수정. PATCH라서 보낸 필드만 바꾼다.

        {"nickname": "홍길동"}                -> 닉네임만 변경
        {"nickname": null}                    -> 새 랜덤 닉네임(닉네임을 비워 두지 않는다)
        {"service_purposes": ["move", "buy"]} -> 이용 목적만 변경
        {}                                    -> 아무것도 안 바꿈

    온보딩에서 한 번에 다 보내도 되고, 화면을 나눠 여러 번 보내도 된다.
    """
    # exclude_unset=True로 뽑으면 사용자가 실제로 보낸 필드만 남는다.
    # ("안 보냄"과 "null 보냄"을 구분하기 위함)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    # 닉네임을 지우면 빈 채로 두지 않고 새 랜덤 닉네임을 준다(app/user/nickname.py).
    if profile.nickname is None:
        profile.nickname = random_nickname()

    db.commit()
    db.refresh(profile)
    return profile
