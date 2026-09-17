"use client";

import { useEffect, useRef, useState } from "react";
import ChipGroup from "./ChipGroup";
import InspectionChecklist from "./InspectionChecklist";
import { CloseIcon } from "./icons";
import { DIRECTIONS, INTERIORS, REGULATIONS } from "@/lib/data";
import {
  EMPTY_CHECKLIST,
  WEIGHT_CATEGORIES,
  computeOverallScore,
  editableWeights,
  scoringSource,
  weightsForContext,
} from "@/lib/checklist";

// 종합 평점은 사용자가 고르지 않는다(2026-09-16 결정). 체크한 항목으로 계산한
// 100점 만점 점수를 그대로 보여주고, 기준이 마음에 들지 않으면 "?"에서 비중을
// 고친다 - 점수를 직접 누르는 것보다 "무엇을 중요하게 보는지"를 고치는 쪽이
// 다음 후보에도 그대로 적용되기 때문이다.

// 가중치 합. 전부 0이면 점수를 낼 수 없어 저장을 막는다(서버도 422로 거절한다).
function weightsTotal(weights) {
  return WEIGHT_CATEGORIES.reduce((sum, { key }) => sum + (Number(weights?.[key]) || 0), 0);
}

// <EditListingDialog /> : 대시보드 카드의 연필 아이콘으로 여는 화면 중앙
// 팝업. #modal-overlay(InterestModal, 오른쪽 슬라이드 패널)와는 완전히
// 독립된 두 번째 오버레이 — 동시에 둘 다 열릴 일은 없지만(연필 아이콘은
// 모달이 닫혀 대시보드가 보일 때만 클릭 가능) 구조적으로 분리해뒀다.
// 매물 등록(DetailStep)과 동일한 필드 구성(호가/층/동호수/향/인테리어)이되,
// 아코디언 없이 전부 펼쳐서 보여준다.
//
// 2026-09: 헤더 우측의 "임장 체크리스트" 버튼으로 같은 팝업 안에서 폼
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
// 가중치는 "?"(helpOpen)에서 보고 고칠 수 있다. 어느 기준을 쓸지는 그룹 기준 >
// 내 기본 기준(프로필) > 이용 목적(전세/매매) 기본값 순으로 정해진다.
export default function EditListingDialog({
  open,
  item,
  initialChecklist,
  guest,
  group,
  profile,
  onSave,
  onSaveWeights,
  onCancel,
  onRequestLogin,
}) {
  const [price, setPrice] = useState("");
  const [floor, setFloor] = useState("");
  const [dong, setDong] = useState("");
  const [ho, setHo] = useState("");
  const [direction, setDirection] = useState(null);
  const [interior, setInterior] = useState(null);
  const [showChecklist, setShowChecklist] = useState(false);
  // 비로그인 상태에서 체크리스트를 열려고 하면 먼저 이 확인 팝업을 띄운다
  // (팝업 위의 팝업 - 2026-09-17. 예전에는 체크리스트 화면 안에 안내 문구를
  // 넣었다가 "화면에 안내가 끼어드는 게 별로다"라는 이유로 뺐었다 - 대신
  // 버튼을 누르는 시점에 한 번만 확인받는 방식으로 바꿨다).
  const [guestChecklistConfirmOpen, setGuestChecklistConfirmOpen] = useState(false);
  const [checklist, setChecklist] = useState(EMPTY_CHECKLIST);
  const [saving, setSaving] = useState(false);
  // "?" 로 펼치는 점수 기준 설명·수정. draftWeights는 펼칠 때의 현재 기준으로 채운다.
  const [helpOpen, setHelpOpen] = useState(false);
  const [draftWeights, setDraftWeights] = useState({});
  const [savingWeights, setSavingWeights] = useState(false);
  const priceInputRef = useRef(null);
  // 그룹 기준 > 내 기본 기준 > 이용 목적 기본값 순으로 고른다.
  const weights = weightsForContext(group, profile);
  const source = scoringSource(group, profile);

  function toggleHelp() {
    if (!helpOpen) setDraftWeights(editableWeights(group, profile));
    setHelpOpen((previous) => !previous);
  }

  // 저장 위치는 상위(NaejipsaApp)가 정한다 - 그룹을 보고 있으면 그 그룹에,
  // 전체 후보 화면이면 내 기본 기준에 저장한다. null이면 기준을 지운다.
  async function saveWeights(next) {
    if (savingWeights || !onSaveWeights) return;
    setSavingWeights(true);
    const saved = await onSaveWeights(next);
    setSavingWeights(false);
    if (saved) setHelpOpen(false);
  }

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
      setHelpOpen(false);
      setGuestChecklistConfirmOpen(false);
      setChecklist(initialChecklist || EMPTY_CHECKLIST);
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

  // 체크한 항목으로 계산한 100점 만점 점수(없으면 null)와, 저장할 1~5 평점.
  const auto = computeOverallScore(checklist, weights);
  const rating = auto?.rating ?? null;

  return (
    <div className={"edit-overlay" + (open ? " is-open" : "")} inert={!open} onClick={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}>
      <div className="edit-dialog" role="dialog" aria-modal="true" aria-label="매물 정보">
        <button type="button" className="edit-dialog-close" aria-label="닫기" onClick={onCancel}>
          <CloseIcon />
        </button>
        <div className="edit-dialog-header">
          {/* .edit-dialog-header-top: 제목/이름과 체크리스트 버튼을 가로로
              나란히 놓는 CSS인데, 이 래퍼 div가 없어서 버튼이 제목 아래로
              떨어져 보였다(2026-09-17 발견). */}
          <div className="edit-dialog-header-top">
            <div>
              <div className="edit-dialog-title">{showChecklist ? "체크리스트" : "매물 정보"}</div>
              <div className="edit-dialog-name-row">
              <div className="edit-dialog-name">{item ? item.name + " · " + item.sizeLabel : ""}</div>
              {item && (
                <div className="edit-dialog-badges">
                  {(() => {
                    const matched = (item.regulations || []).map((key) => REGULATIONS[key]).filter(Boolean);
                    const badges = matched.length > 0 ? matched : [REGULATIONS.none];
                    return badges.map((def) => (
                      <span key={def.label} className={"reg-badge reg-badge--tiny " + def.cls}>
                        {def.label}
                      </span>
                    ));
                  })()}
                </div>
              )}
            </div>
            </div>
            <button
              type="button"
              className="edit-dialog-checklist-btn"
              onClick={() => {
                if (!showChecklist && guest) {
                  setGuestChecklistConfirmOpen(true);
                  return;
                }
                setShowChecklist((prev) => !prev);
              }}
            >
              {showChecklist ? "매물 정보" : "임장 체크리스트"}
            </button>
          </div>
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
                  {auto ? `종합 평점 : ${auto.score}점` : "종합 평점"}
                  {auto && (
                    <span className="checklist-rating-coverage">
                      {`${auto.total}개 중 ${auto.checked}개 확인`}
                    </span>
                  )}
                  <button
                    type="button"
                    className="checklist-rating-help-btn"
                    aria-expanded={helpOpen}
                    aria-label="점수 산출 방식 보기"
                    title="점수가 어떻게 나왔는지 보고 기준을 바꿔요"
                    onClick={toggleHelp}
                  >
                    ?
                  </button>
                </div>
                <p className="checklist-rating-hint">
                  {auto
                    ? "체크한 항목으로 계산한 100점 만점 점수예요. 기준을 바꾸려면 ?를 눌러주세요."
                    : "항목을 체크하면 종합 평점이 계산돼요."}
                </p>
                {helpOpen && (
                  <div className="checklist-weights">
                    <p className="checklist-weights-source">
                      지금은 <strong>{source.label}</strong>으로 계산해요. 아래 비중을 바꾸면
                      점수가 바로 다시 계산됩니다.
                    </p>
                    {WEIGHT_CATEGORIES.map(({ key, label }) => (
                      <label key={key} className="checklist-weights-row">
                        <span>{label}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={draftWeights[key] ?? 0}
                          disabled={savingWeights}
                          onChange={(event) =>
                            setDraftWeights((previous) => ({
                              ...previous,
                              [key]: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                            }))
                          }
                        />
                      </label>
                    ))}
                    <div className="checklist-weights-actions">
                      {/* 팝업 아래의 "저장"(매물 정보 저장)과 헷갈리지 않게 이름을 나눈다. */}
                      <button
                        type="button"
                        className="checklist-weights-save"
                        aria-label="점수 기준 저장"
                        disabled={savingWeights || weightsTotal(draftWeights) === 0}
                        title={
                          weightsTotal(draftWeights) === 0
                            ? "하나 이상은 0보다 크게 정해주세요"
                            : undefined
                        }
                        onClick={() => saveWeights(draftWeights)}
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        disabled={savingWeights}
                        title="정해둔 기준을 지우고 이용 목적(전세/매매) 기본값으로 되돌려요"
                        onClick={() => saveWeights(null)}
                      >
                        기본값으로
                      </button>
                    </div>
                    <p className="checklist-weights-note">
                      {group
                        ? `지금 "${group.name}" 그룹을 보고 있어서 이 그룹의 기준으로 저장돼요. 그룹마다 기준을 다르게 둘 수 있어요.`
                        : "전체 후보에서 고치면 내 기본 기준으로 저장돼요. 그룹을 보고 있을 때 고치면 그 그룹에만 적용됩니다."}
                      {" 체크하지 않은 항목은 계산에서 빠집니다."}
                    </p>
                  </div>
                )}
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

        {guestChecklistConfirmOpen && (
          <div
            className="checklist-guest-confirm-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) setGuestChecklistConfirmOpen(false);
            }}
          >
            <div className="checklist-guest-confirm" role="alertdialog" aria-modal="true" aria-label="로그인 안내">
              <p className="checklist-guest-confirm-message">
                로그인 없이 작성하면 저장되지 않아요. 로그인하면 나중에도 확인할 수 있어요.
              </p>
              <div className="checklist-guest-confirm-actions">
                <button
                  type="button"
                  className="edit-dialog-cancel"
                  onClick={() => {
                    setGuestChecklistConfirmOpen(false);
                    setShowChecklist(true);
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="edit-dialog-save"
                  onClick={() => {
                    setGuestChecklistConfirmOpen(false);
                    onRequestLogin?.();
                  }}
                >
                  로그인
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
