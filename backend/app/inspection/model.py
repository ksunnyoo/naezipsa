"""후보 매물별 임장 기록. 후보당 1건만 두고 고쳐 쓴다.

2026-09-16 사용자 결정으로 두 가지가 바뀌었다(마이그레이션 a4f2c8e91b07).

- 저장할 때마다 새 기록을 쌓지 않는다. property_id에 UNIQUE를 걸어 후보당
  1건만 두고, 다시 저장하면 그 행을 고쳐 쓴다. 화면에 방문 이력을 보여줄
  자리가 없어 이력을 남겨도 쓰이지 않기 때문이다.
- 후보를 지우면 임장 기록도 함께 지워진다(CASCADE). 예전에는 RESTRICT라
  기록이 있는 후보를 지울 수 없었는데, 후보를 "제외" 상태로 바꾸는 화면이
  없어 사용자가 빠져나갈 길이 없었다.
"""
from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Integer, Text, UniqueConstraint, func

from app.core.database import Base


class PropertyInspection(Base):
    __tablename__ = "property_inspections"
    __table_args__ = (
        CheckConstraint("transport IN (1, 2, 3)", name="ck_inspections_transport"),
        CheckConstraint("commute_road IN (1, 2, 3)", name="ck_inspections_commute_road"),
        CheckConstraint("school IN (1, 2, 3)", name="ck_inspections_school"),
        CheckConstraint("academy IN (1, 2, 3)", name="ck_inspections_academy"),
        CheckConstraint("convenience IN (1, 2, 3)", name="ck_inspections_convenience"),
        CheckConstraint("noise IN (1, 2, 3)", name="ck_inspections_noise"),
        CheckConstraint("harmful_facility IN (0, 1)", name="ck_inspections_harmful_facility"),
        CheckConstraint("parking IN (1, 2, 3)", name="ck_inspections_parking"),
        CheckConstraint("sunlight IN (1, 2, 3)", name="ck_inspections_sunlight"),
        CheckConstraint("natural_light IN (1, 2, 3)", name="ck_inspections_natural_light"),
        CheckConstraint("leak_mold IN (1, 2, 3)", name="ck_inspections_leak_mold"),
        CheckConstraint("wallpaper IN (1, 2, 3)", name="ck_inspections_wallpaper"),
        CheckConstraint("water_pressure IN (1, 2, 3)", name="ck_inspections_water_pressure"),
        CheckConstraint("toilet_drain IN (1, 2, 3)", name="ck_inspections_toilet_drain"),
        CheckConstraint("drain_smell IN (1, 2, 3)", name="ck_inspections_drain_smell"),
        CheckConstraint("window_condition IN (1, 2, 3)", name="ck_inspections_window_condition"),
        CheckConstraint("heating IN (1, 2, 3)", name="ck_inspections_heating"),
        CheckConstraint("floor_noise IN (1, 2, 3)", name="ck_inspections_floor_noise"),
        CheckConstraint("overall_rating BETWEEN 1 AND 5", name="ck_inspections_rating"),
        CheckConstraint("length(memo) <= 2000", name="ck_inspections_memo"),
        # 후보당 1건. 같은 후보로 두 번 저장하면 INSERT가 아니라 UPDATE가 된다.
        UniqueConstraint("property_id", name="uq_inspections_property"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    property_id = Column(BigInteger, ForeignKey("dashboard_items.id", name="fk_inspections_property", ondelete="CASCADE"), nullable=False)
    transport = Column(Integer, nullable=True)
    commute_road = Column(Integer, nullable=True)
    school = Column(Integer, nullable=True)
    academy = Column(Integer, nullable=True)
    convenience = Column(Integer, nullable=True)
    noise = Column(Integer, nullable=True)
    harmful_facility = Column(Integer, nullable=True)
    parking = Column(Integer, nullable=True)
    sunlight = Column(Integer, nullable=True)
    natural_light = Column(Integer, nullable=True)
    leak_mold = Column(Integer, nullable=True)
    wallpaper = Column(Integer, nullable=True)
    water_pressure = Column(Integer, nullable=True)
    toilet_drain = Column(Integer, nullable=True)
    drain_smell = Column(Integer, nullable=True)
    window_condition = Column(Integer, nullable=True)
    heating = Column(Integer, nullable=True)
    floor_noise = Column(Integer, nullable=True)
    overall_rating = Column(Integer, nullable=False)
    memo = Column(Text, nullable=False, server_default="")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # 고쳐 쓰는 구조라 "처음 쓴 시각"과 "마지막으로 고친 시각"이 둘 다 필요하다.
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
