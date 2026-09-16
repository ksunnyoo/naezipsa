"""소유권 확인 후 조회·저장한다. 저장 실패 시 전체 트랜잭션을 롤백한다."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dashboard.model import DashboardItem
from app.inspection.model import PropertyInspection
from app.inspection.schema import (
    InspectionCreate,
    InspectionListResponse,
    InspectionProperty,
    InspectionRecord,
)
from app.property.model import ComplexMaster, SizeMaster


def get_property(db: Session, user_id, property_id: int) -> InspectionProperty:
    row = db.execute(
        select(DashboardItem, SizeMaster, ComplexMaster)
        .outerjoin(SizeMaster, SizeMaster.id == DashboardItem.size_id)
        .outerjoin(ComplexMaster, ComplexMaster.id == SizeMaster.complex_id)
        .where(DashboardItem.id == property_id, DashboardItem.user_id == user_id)
    ).first()
    if row is None:
        raise HTTPException(404, "해당 후보 매물을 찾을 수 없습니다.")
    item, size, complex_ = row
    return InspectionProperty(
        id=item.id, size_id=item.size_id,
        complex_name=complex_.apt_nm if complex_ else None,
        dong=item.dong, ho=item.ho, floor=item.floor, list_price=item.list_price,
        representative_area=size.representative_area if size else None,
        pyeong=size.pyeong if size else None,
    )


def list_inspections(db: Session, user_id) -> InspectionListResponse:
    """내 후보의 임장 기록을 한 번에 돌려준다(후보 카드에 점수를 띄우기 위함).

    남의 후보 기록은 조인 조건에서 걸러진다. 아직 체크리스트를 쓰지 않은 후보는
    기록 자체가 없어 목록에서 빠진다(빈 껍데기를 만들어 보내지 않는다).
    """
    rows = db.scalars(
        select(PropertyInspection)
        .join(DashboardItem, DashboardItem.id == PropertyInspection.property_id)
        .where(DashboardItem.user_id == user_id)
        .order_by(PropertyInspection.property_id)
    ).all()
    return InspectionListResponse(
        items=[InspectionRecord.model_validate(row) for row in rows],
        count=len(rows),
    )


def get_inspection(db: Session, user_id, property_id: int) -> InspectionRecord:
    """저장해둔 임장 기록 1건을 돌려준다.

    없는 후보·남의 후보·아직 기록이 없는 후보 모두 404다. 화면은 셋 다
    "빈 체크리스트로 시작"으로 똑같이 처리하면 되고, 남의 후보인지 기록이
    없는 것뿐인지를 구분해 알려주지 않는다.
    """
    owned_id = db.scalar(
        select(DashboardItem.id)
        .where(DashboardItem.id == property_id, DashboardItem.user_id == user_id)
    )
    if owned_id is None:
        raise HTTPException(404, "해당 후보 매물을 찾을 수 없습니다.")
    record = db.scalar(
        select(PropertyInspection).where(PropertyInspection.property_id == owned_id)
    )
    if record is None:
        raise HTTPException(404, "아직 저장된 임장 기록이 없습니다.")
    return InspectionRecord.model_validate(record)


def save_inspection(db: Session, user_id, property_id: int, payload: InspectionCreate):
    """후보당 1건을 저장한다. 처음이면 새로 만들고, 이미 있으면 고쳐 쓴다.

    (기록, 새로 만들었는지) 를 돌려준다 - 라우터가 201과 200을 가른다.
    """
    try:
        # 후보 삭제와 저장이 경합해도 소유권 확인부터 저장까지 일관되게 처리한다.
        item = db.execute(
            select(DashboardItem)
            .where(DashboardItem.id == property_id, DashboardItem.user_id == user_id)
            .with_for_update()
        ).scalar_one_or_none()
        if item is None:
            raise HTTPException(404, "해당 후보 매물을 찾을 수 없습니다.")
        record = db.scalar(
            select(PropertyInspection).where(PropertyInspection.property_id == item.id)
        )
        created = record is None
        if created:
            record = PropertyInspection(property_id=item.id, **payload.model_dump())
            db.add(record)
        else:
            # 보내지 않은 항목은 미확인(null)으로 돌아간다. 화면이 늘 18개
            # 전체를 보내는 구조라 부분 수정이 아니라 통째로 덮어쓰는 게 맞다.
            for field, value in payload.model_dump().items():
                setattr(record, field, value)
        db.flush()
        result = InspectionRecord.model_validate(record)
        db.commit()
        return result, created
    except Exception:
        db.rollback()
        raise
