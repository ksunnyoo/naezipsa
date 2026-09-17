"use client";

import { useRef } from "react";
import InterestCard from "./InterestCard";
import useDragReorder from "./useDragReorder";
import { PlusIcon, XIcon } from "../icons";
import { MAX_DASHBOARD_ITEMS } from "@/lib/data";

// <DashboardList /> : 왼쪽 관심 매물 카드 목록, 자체 스크롤. (그룹을 보고 있으면 맨 위에
// 그룹 칩) → 채워진 카드 → 후보를 더하는 칸 1개 순으로 렌더링한다. 등록되지 않은 나머지
// 자리는 더 이상 빈 칸으로 공간을 차지하지 않는다.
//
// 그룹을 보고 있으면 items에는 그 그룹의 후보만 담기므로 남은 등록 칸은 전체 후보
// 수(totalCount)로 센다. 그룹 동작은 헤더의 그룹 메뉴(GroupBar)에서 한다.
//
// 그룹 칩이 여기 있는 이유: 그룹을 보고 있다는 표시가 그룹 메뉴(팝오버) 안에만 있어서,
// 메뉴를 닫으면 "6개였던 목록이 3개로 줄어든 것"만 보이고 왜 그런지 알 수 없었다.
// 걸러진 목록 바로 위에 두어야 인과가 붙어 보인다(2026-09-17 결정).
//
// 맨 아래 칸은 보고 있는 화면에 따라 뜻이 달라진다.
//   전체 후보 화면  후보를 새로 등록한다. 6개를 다 채웠으면 숨기지 않고 이유를 보여준다.
//   그룹 화면      이미 담아둔 후보를 이 그룹에 넣는다(상한과 무관하므로 항상 누를 수 있다).
//
// dragDisabled: 바꾼 순서를 서버에 저장하는 동안에는 다음 드래그를 시작하지 않는다.
export default function DashboardList({
  items,
  totalCount = items.length,
  group = null,
  onToggle,
  onEdit,
  onRemove,
  onReorder,
  onAdd,
  onAddToGroup,
  onExitGroup,
  dragDisabled = false,
}) {
  const listRef = useRef(null);
  const startDrag = useDragReorder(listRef, items, onReorder);
  const handleDragStart = dragDisabled ? (e) => e.preventDefault() : startDrag;

  const remaining = MAX_DASHBOARD_ITEMS - totalCount;

  return (
    <div
      className="dashboard-list"
      id="dashboard-list"
      ref={listRef}
      data-component="DashboardList"
      aria-busy={dragDisabled || undefined}
    >
      {group && (
        <div className="group-chip">
          <span className="group-chip-name">{group.name}</span>
          <span className="group-chip-count">{`${items.length}개`}</span>
          <button
            type="button"
            className="group-chip-exit"
            tabIndex={0}
            title="전체 후보로 돌아가기 (Esc)"
            aria-label={`"${group.name}" 그룹에서 나가 전체 후보 보기`}
            onClick={onExitGroup}
          >
            <XIcon />
          </button>
        </div>
      )}

      {items.map((item) => (
        <InterestCard
          key={item.id}
          item={item}
          onToggle={onToggle}
          onEdit={onEdit}
          onRemove={onRemove}
          onDragHandleMouseDown={handleDragStart}
        />
      ))}

      {group ? (
        <div className="interest-row" data-slot="add">
          <button
            type="button"
            className="dashboard-add-slot"
            id="dashboard-add-slot-btn"
            tabIndex={0}
            onClick={onAddToGroup}
          >
            <span className="plus-icon-circle">
              <PlusIcon />
            </span>
            이 그룹에 넣기
          </button>
        </div>
      ) : (
        <div className="interest-row" data-slot="add">
          <button
            type="button"
            className="dashboard-add-slot"
            id="dashboard-add-slot-btn"
            tabIndex={0}
            disabled={remaining <= 0}
            // 전에는 6개를 채우면 이 칸이 말없이 사라져서 고장으로 보였다.
            title={remaining <= 0 ? `후보는 ${MAX_DASHBOARD_ITEMS}개까지 담을 수 있어요` : undefined}
            onClick={onAdd}
          >
            <span className="plus-icon-circle">
              <PlusIcon />
            </span>
            {remaining > 0
              ? "매물 추가하기"
              : `후보는 ${MAX_DASHBOARD_ITEMS}개까지예요`}
          </button>
        </div>
      )}
    </div>
  );
}
