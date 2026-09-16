"use client";

import { useEffect, useRef, useState } from "react";
import ChipGroup from "./ChipGroup";
import InspectionChecklist from "./InspectionChecklist";
import { CloseIcon } from "./icons";
import { DIRECTIONS, INTERIORS } from "@/lib/data";
import { EMPTY_CHECKLIST } from "@/lib/checklist";

// <EditListingDialog /> : 대시보드 카드의 연필 아이콘으로 여는 화면 중앙
// 팝업. #modal-overlay(InterestModal, 오른쪽 슬라이드 패널)와는 완전히
// 독립된 두 번째 오버레이 — 동시에 둘 다 열릴 일은 없지만(연필 아이콘은
// 모달이 닫혀 대시보드가 보일 때만 클릭 가능) 구조적으로 분리해뒀다.
// 매물 등록(DetailStep)과 동일한 필드 구성(호가/층/동호수/향/인테리어)이되,
// 아코디언 없이 전부 펼쳐서 보여준다.
//
// 2026-09: 헤더 우측의 "체크리스트 작성" 버튼으로 같은 팝업 안에서 폼
// 화면 ↔ 체크리스트 화면(InspectionChecklist)을 전환한다(showChecklist).
// 팝업 크기/헤더 레이아웃은 그대로 두고 제목 텍스트만 바뀌며, 헤더 아래
// 컨텐츠 영역만 CSS 애니메이션(editPanelEnterRight/Left)으로 좌우로
// 슬라이드되듯 전환된다 - 별도의 "이전" 버튼 없이 같은 버튼을 다시
// 누르면 폼 화면으로 돌아간다.
//
// 체크리스트는 아직 저장 API가 없다(진수 확인: 일단 임시 유지만). 그래서
// 이 컴포넌트 자신은 여전히 매번 EMPTY_CHECKLIST로 리셋되지만, 상위
// (NaejipsaApp)가 매물 id별로 들고 있는 세션 캐시를 initialChecklist로
// 내려주면 그 값으로 채운다 - 저장을 누르면(handleSave) onChecklistSave로
// 그 캐시에 반영되고, 취소를 누르면 반영되지 않아 버려진다. 새로고침하면
// 캐시 자체가 사라지므로 진짜 "저장"은 아니고, 같은 세션 안에서 팝업을
// 다시 열었을 때만 이어서 보이는 정도다.
export default function EditListingDialog({
  open,
  item,
  initialChecklist,
  onSave,
  onChecklistSave,
  onCancel,
}) {
  const [price, setPrice] = useState("");
  const [floor, setFloor] = useState("");
  const [dong, setDong] = useState("");
  const [ho, setHo] = useState("");
  const [direction, setDirection] = useState(null);
  const [interior, setInterior] = useState(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklist, setChecklist] = useState(EMPTY_CHECKLIST);
  const priceInputRef = useRef(null);

  // 열릴 때(open이 true가 되는 시점)마다 해당 item의 현재 값으로 필드를
  // 채운다. InterestModal과 동일한 이유로 useEffect+setState 대신 "렌더링
  // 중 state 조정" 패턴을 쓴다(react-hooks/set-state-in-effect 회피).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && item) {
      setPrice(item.price || "");
      setFloor(item.floor || "");
      setDong(item.dong || "");
      setHo(item.ho || "");
      setDirection(item.direction || null);
      setInterior(item.interior || null);
      // 이 세션에서 저장해둔 값이 있으면 그걸로, 없으면 빈 체크리스트로.
      setShowChecklist(false);
      setChecklist(initialChecklist || EMPTY_CHECKLIST);
    }
  }

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => priceInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  function handleSave() {
    if (!item) return;
    onSave(item.id, { price, floor, dong, ho, direction, interior });
    onChecklistSave?.(item.id, checklist);
  }

  function updateChecklistField(key, value) {
    setChecklist((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className={"edit-overlay" + (open ? " is-open" : "")} inert={!open} onClick={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}>
      <div className="edit-dialog" role="dialog" aria-modal="true" aria-label="매물 정보">
        <button type="button" className="edit-dialog-close" aria-label="닫기" onClick={onCancel}>
          <CloseIcon />
        </button>
        <div className="edit-dialog-header">
          <div>
            <div className="edit-dialog-title">{showChecklist ? "체크리스트" : "매물 정보"}</div>
            <div className="edit-dialog-name">{item ? item.name + " · " + item.sizeLabel : ""}</div>
          </div>
          <button
            type="button"
            className="edit-dialog-checklist-btn"
            onClick={() => setShowChecklist((prev) => !prev)}
          >
            {showChecklist ? "매물 정보 작성" : "체크리스트 작성"}
          </button>
        </div>

        <div className={"edit-dialog-panel" + (showChecklist ? " is-checklist-panel" : "")}>
          {!showChecklist ? (
            <>
              <div className="price-field">
                <div className="price-field-label">호가</div>
                <div className="field-suffix-wrap">
                  <input
                    ref={priceInputRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="32,000"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <span className="field-suffix">만원</span>
                </div>
              </div>

              <div className="field-block">
                <div className="field-block-label">층</div>
                <div className="field-row">
                  <div className="field-small field-suffix-wrap">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="8"
                      value={floor}
                      onChange={(e) => setFloor(e.target.value)}
                    />
                    <span className="field-suffix">층</span>
                  </div>
                </div>
              </div>

              <div className="field-block">
                <div className="field-block-label">동/호수</div>
                <div className="field-row">
                  <div className="field-small field-suffix-wrap">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="208"
                      value={dong}
                      onChange={(e) => setDong(e.target.value)}
                    />
                    <span className="field-suffix">동</span>
                  </div>
                  <span className="field-sep">/</span>
                  <div className="field-small field-suffix-wrap">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="1501"
                      value={ho}
                      onChange={(e) => setHo(e.target.value)}
                    />
                    <span className="field-suffix">호</span>
                  </div>
                </div>
              </div>

              <div className="field-block">
                <div className="field-block-label">향</div>
                <ChipGroup name="direction" options={DIRECTIONS} value={direction} onChange={setDirection} />
              </div>

              <div className="field-block">
                <div className="field-block-label">인테리어</div>
                <ChipGroup name="interior" options={INTERIORS} value={interior} onChange={setInterior} />
              </div>
            </>
          ) : (
            <InspectionChecklist values={checklist} onChange={updateChecklistField} />
          )}
        </div>

        <div className="edit-dialog-actions">
          <button type="button" className="edit-dialog-cancel" tabIndex={0} onClick={onCancel}>
            취소
          </button>
          <button type="button" className="edit-dialog-save" tabIndex={0} onClick={handleSave}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
