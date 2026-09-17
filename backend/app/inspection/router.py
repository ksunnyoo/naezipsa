"""로그인한 사용자의 후보 매물 조회와 모바일 임장 저장."""
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.inspection import service
from app.inspection.schema import (
    InspectionCreate,
    InspectionDeleted,
    InspectionListResponse,
    InspectionProperty,
    InspectionRecord,
)
from app.user.model import Profile

router = APIRouter(prefix="/properties", tags=["inspection"])
PropertyId = Annotated[int, Path(gt=0, le=9223372036854775807)]


@router.get("/inspections", response_model=InspectionListResponse)
def list_inspections(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """내 후보의 임장 기록을 한 번에 불러온다(후보 카드 점수용).

    아래 `/{property_id}`보다 **먼저** 선언해야 한다. FastAPI는 선언한 순서대로
    경로를 맞춰보므로, 뒤에 두면 "inspections"가 {property_id}(정수)에 먼저 걸려
    422가 나고 이 함수까지 오지 않는다.
    """
    return service.list_inspections(db, profile.id)


@router.get("/{property_id}", response_model=InspectionProperty)
def get_property(
    property_id: PropertyId,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    return service.get_property(db, profile.id, property_id)


@router.get("/{property_id}/inspection", response_model=InspectionRecord)
def get_inspection(
    property_id: PropertyId,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """저장해둔 임장 기록을 불러온다. 아직 없으면 404 - 화면은 빈 값으로 시작한다."""
    return service.get_inspection(db, profile.id, property_id)


@router.delete("/{property_id}/inspection", response_model=InspectionDeleted)
def delete_inspection(
    property_id: PropertyId,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """임장 기록을 지운다. 체크리스트를 모두 비우고 저장하면 화면이 이걸 부른다.

    원래 기록이 없었으면 `deleted=false`로 200이다(지울 게 없었을 뿐 오류가 아니다).
    """
    return InspectionDeleted(deleted=service.delete_inspection(db, profile.id, property_id))


@router.post("/{property_id}/inspection", response_model=InspectionRecord, status_code=201)
def save_inspection(
    property_id: PropertyId,
    payload: InspectionCreate,
    response: Response,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """후보당 1건을 저장한다. 처음 저장이면 201, 기존 기록을 고쳤으면 200이다."""
    record, created = service.save_inspection(db, profile.id, property_id, payload)
    if not created:
        response.status_code = 200
    return record
