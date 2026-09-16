"""로그인한 사용자의 후보 매물 조회와 모바일 임장 저장."""
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.inspection import service
from app.inspection.schema import InspectionCreate, InspectionProperty, InspectionRecord
from app.user.model import Profile

router = APIRouter(prefix="/properties", tags=["inspection"])
PropertyId = Annotated[int, Path(gt=0, le=9223372036854775807)]


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
