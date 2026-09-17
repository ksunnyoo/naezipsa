"use client";

import { DragHandleIcon, PencilIcon, XIcon } from "../icons";
import { REGULATIONS, dongHoText } from "@/lib/data";

// <InterestCard /> : 관심 매물 카드 한 줄(드래그 손잡이 + 카드). 카드 전체
// (수정/삭제 버튼 영역 제외)를 누르면 대시보드 반영 체크가 토글된다 —
// "체크박스 영역이 좁아 누르기 힘드니 카드 전체를 누르면 토글되게" 피드백
// 반영. 라벨로 감싸는 대신 카드에 클릭 리스너를 걸고, 클릭 지점이
// .interest-card-actions(수정/삭제 버튼 영역) 안이면 무시하는 방식 — 별도
// 오버레이/z-index 없이 이벤트 버블링만으로 처리해 구조가 단순하다.
export default function InterestCard({ item, onToggle, onEdit, onRemove, onDragHandleMouseDown }) {
  const matchedBadges = (item.regulations || [])
    .map((key) => REGULATIONS[key])
    .filter(Boolean);
  // 해당하는 규제가 하나도 없으면 "규제 해당 없음" 뱃지를 대신 보여준다.
  const badges = matchedBadges.length > 0 ? matchedBadges : [REGULATIONS.none];

  return (
    <div
      className={"interest-row" + (item.checked ? "" : " is-unchecked")}
      data-item-id={item.id}
    >
      <button
        type="button"
        className="interest-drag-handle"
        tabIndex={0}
        aria-label="순서 변경"
        onMouseDown={(e) => onDragHandleMouseDown(e, item.id)}
      >
        <DragHandleIcon />
      </button>
      <div
        className="interest-card"
        onClick={(e) => {
          if (e.target.closest(".interest-card-actions")) return;
          onToggle(item.id);
        }}
      >
        <div className="interest-card-top">
          <button
            type="button"
            className={"interest-checkbox" + (item.checked ? " is-checked" : "")}
            tabIndex={0}
            aria-pressed={item.checked}
            aria-label="대시보드에 반영"
          >
            {item.checked ? (
              <img className="interest-checkbox-icon" src="/check-icon.png" alt="" />
            ) : null}
          </button>
          <div className="interest-card-actions">
            <button
              type="button"
              className="interest-edit-btn"
              tabIndex={0}
              aria-label="동/호수 수정"
              onClick={() => onEdit(item.id)}
            >
              <PencilIcon />
            </button>
            <button
              type="button"
              className="interest-remove-btn"
              tabIndex={0}
              aria-label="목록에서 제거"
              onClick={() => onRemove(item.id)}
            >
              <XIcon />
            </button>
          </div>
        </div>
        <div className="interest-card-name">
          {item.name}
          {/* 임장 체크리스트 점수. 체크리스트를 쓰지 않은 후보는 점수가 없어 뱃지도 없다.
              지금 보고 있는 화면 기준(그룹이면 그 그룹 가중치)으로 계산된 값이다. */}
          {item.score != null && (
            <span
              className="interest-card-score"
              title={
                `임장 체크리스트 ${item.score}점 (100점 만점)`
                + (item.scoreTotal ? ` · ${item.scoreTotal}개 중 ${item.scoreChecked}개 확인` : "")
              }
            >
              {item.score}
            </span>
          )}
        </div>
        <div className="interest-card-size">
          {item.sizeLabel} · <span className="interest-card-dongho">{dongHoText(item)}</span>
        </div>
        <div className="interest-card-badges">
          {badges.map((def) => (
            <span key={def.label} className={"reg-badge " + def.cls}>
              {def.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
