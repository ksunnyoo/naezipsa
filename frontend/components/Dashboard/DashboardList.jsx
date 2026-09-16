"use client";

import { useRef } from "react";
import InterestCard from "./InterestCard";
import useDragReorder from "./useDragReorder";
import { PlusIcon } from "../icons";
import { MAX_DASHBOARD_ITEMS } from "@/lib/data";

// <DashboardList /> : 왼쪽 관심 매물 카드 목록, 자체 스크롤. 채워진 카드 →
// (자리가 남아있다면) "+ 매물 추가하기" 트리거 1칸 순으로 렌더링한다. 등록되지
// 않은 나머지 자리는 더 이상 빈 칸으로 공간을 차지하지 않는다 - 6개를 다
// 채우면 추가 트리거도 사라진다.
//
// 그룹을 보고 있으면 items에는 그 그룹의 후보만 담기므로 남은 등록 칸은 전체 후보
// 수(totalCount)로 센다. 그룹 동작은 헤더의 그룹 메뉴(GroupBar)에서 한다.
// dragDisabled: 바꾼 순서를 서버에 저장하는 동안에는 다음 드래그를 시작하지 않는다.
export default function DashboardList({
  items,
  totalCount = items.length,
  onToggle,
  onEdit,
  onRemove,
  onReorder,
  onAdd,
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

      {remaining > 0 && (
        <div className="interest-row" data-slot="add">
          <span className="interest-drag-spacer" aria-hidden="true" />
          <button
            type="button"
            className="dashboard-add-slot"
            id="dashboard-add-slot-btn"
            tabIndex={0}
            onClick={onAdd}
          >
            <span className="plus-icon-circle">
              <PlusIcon />
            </span>
            매물 추가하기
          </button>
        </div>
      )}
    </div>
  );
}
