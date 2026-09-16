"use client";

import { useEffect, useRef, useState } from "react";
import ChipGroup from "./ChipGroup";
import InspectionChecklist from "./InspectionChecklist";
import { CloseIcon } from "./icons";
import { DIRECTIONS, INTERIORS } from "@/lib/data";
import {
  EMPTY_CHECKLIST,
  computeOverallScore,
  weightsForPurposes,
} from "@/lib/checklist";

// 종합 평점 선택지(1~5). ChipGroup은 같은 값을 다시 누르면 null을 주는데,
// 여기선 그게 "직접 고른 값을 지우고 자동 계산으로 되돌린다"는 뜻이 된다.
const RATING_OPTIONS = [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }));

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
// 2026-09-16부터 체크리스트도 서버에 저장한다. 값을 불러오고 보내는 일은
// 상위(NaejipsaApp)가 맡고, 이 컴포넌트는 initialChecklist/initialRating으로
// 받은 값을 보여주다가 저장할 때 onSave로 함께 올려보낸다.
//
// 종합 평점: 저장 API가 1~5 정수를 필수로 받는데 체크리스트에는 입력칸이
// 없었다. 그래서 체크한 항목으로 점수를 계산해 미리 골라두고, 사용자가 다르게
// 느끼면 직접 고를 수 있게 한다. 직접 고른 값(ratingOverride)이 있으면 그게
// 이기고, 같은 값을 다시 누르면 자동 계산으로 돌아간다.
//
// 가중치는 프로필의 이용 목적(전세/매매)에 따라 달라진다 - servicePurposes.
export default function EditListingDialog({
  open,
  item,
  initialChecklist,
  initialRating,
  servicePurposes,
  onSave,
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
  // null이면 "자동 계산을 쓴다", 숫자면 "사용자가 직접 고른 값".
  const [ratingOverride, setRatingOverride] = useState(null);
  const [saving, setSaving] = useState(false);
  const priceInputRef = useRef(null);
  const weights = weightsForPurposes(servicePurposes);

  // 열릴 때(open이 true가 되는 시점)마다 해당 item의 현재 값으로 필드를
  // 채운다. InterestModal과 동일한 이유로 useEffect+setState 대신 "렌더링
  // 중 state 조정" 패턴을 쓴다(react-hooks/set-state-in-effect 회피).
  // false로 시작한다(open으로 시작하지 않는다) - 실제 앱에서는 닫힌 채 떠 있다가
  // 열리지만, 처음부터 열린 상태로 마운트되면 아래 초기화가 한 번도 돌지 않아
  // 저장해둔 값이 빈 화면으로 보이기 때문이다.
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && item) {
      setPrice(item.price || "");
      setFloor(item.floor || "");
      setDong(item.dong || "");
      setHo(item.ho || "");
      setDirection(item.direction || null);
      setInterior(item.interior || null);
      // 저장해둔 값이 있으면 그걸로, 없으면 빈 체크리스트로.
      setShowChecklist(false);
      const loaded = initialChecklist || EMPTY_CHECKLIST;
      setChecklist(loaded);
      // 저장된 평점이 자동 계산값과 같으면 "자동"으로 두어 항목을 고칠 때마다
      // 따라 움직이게 하고, 다르면 사용자가 직접 고른 값으로 보고 지킨다.
      const autoOnLoad = computeOverallScore(loaded, weights);
      setRatingOverride(
        initialRating != null && initialRating !== autoOnLoad?.rating
          ? initialRating
          : null,
      );
    }
  }

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => priceInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 매물 정보와 체크리스트를 저장 버튼 하나로 함께 올려보낸다. 저장이 끝날
  // 때까지 버튼을 잠그고, 실패하면 상위가 팝업을 닫지 않아 입력값이 남는다.
  async function handleSave() {
    if (!item || saving) return;
    setSaving(true);
    try {
      await onSave(
        item.id,
        { price, floor, dong, ho, direction, interior },
        checklist,
        rating,
      );
    } finally {
      setSaving(false);
    }
  }

  function updateChecklistField(key, value) {
    setChecklist((prev) => ({ ...prev, [key]: value }));
  }

  // 체크한 항목으로 계산한 점수(없으면 null)와, 실제로 저장할 평점.
  const auto = computeOverallScore(checklist, weights);
  const rating = ratingOverride ?? auto?.rating ?? null;

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
            <>
              <InspectionChecklist values={checklist} onChange={updateChecklistField} />
              <div className="field-block checklist-rating">
                <div className="field-block-label">
                  종합 평점
                  {auto && (
                    <span className="checklist-rating-auto">자동 계산 {auto.score}점</span>
                  )}
                </div>
                <ChipGroup
                  name="overall_rating"
                  options={RATING_OPTIONS}
                  value={rating}
                  onChange={setRatingOverride}
                />
                <p className="checklist-rating-hint">
                  {auto
                    ? "체크한 항목으로 계산했어요. 다르게 느끼면 직접 골라주세요."
                    : "항목을 체크하면 종합 평점이 자동으로 계산돼요."}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="edit-dialog-actions">
          <button type="button" className="edit-dialog-cancel" tabIndex={0} onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="edit-dialog-save"
            tabIndex={0}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
