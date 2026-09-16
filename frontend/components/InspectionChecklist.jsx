"use client";

import { useState } from "react";
import ChecklistOptionGroup from "./ChecklistOptionGroup";
import { ChevronIcon } from "./icons";
import { CHECKLIST_GROUPS } from "@/lib/checklist";

// <InspectionChecklist values onChange /> : EditListingDialog의 "체크리스트
// 작성" 화면 본문. values는 lib/checklist.js의 EMPTY_CHECKLIST와 같은 모양
// (item.key -> 숫자|null), onChange(key, value)는 항목 하나가 바뀔 때 호출된다.
// 각 항목은 ChecklistOptionGroup 하나(값들 중 하나만 선택, 다시 누르면
// 해제)로 그린다 - 체크 아이콘+텍스트 형태라 향/인테리어의 칩 모양과는
// 다르다(ChipGroup.jsx 참고).
//
// 그룹(교통/교육·생활/단지/내부 상태/설비)은 제목을 눌러 아코디언처럼
// 접고 펼 수 있다 - collapsedGroups는 이 컴포넌트 안에서만 쓰는 화면
// 상태라 EditListingDialog에 끌어올리지 않았고, 다이얼로그가 새로
// 열릴 때마다 다시 마운트되므로 항상 전부 펼쳐진 상태로 시작한다.
export default function InspectionChecklist({ values, onChange }) {
  const [collapsedGroups, setCollapsedGroups] = useState({});

  function toggleGroup(key) {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="checklist-groups">
      {CHECKLIST_GROUPS.map((group) => {
        const collapsed = !!collapsedGroups[group.key];
        return (
          <div key={group.key} className="checklist-group">
            <button
              type="button"
              className="checklist-group-title"
              onClick={() => toggleGroup(group.key)}
              aria-expanded={!collapsed}
            >
              <span>{group.label}</span>
              <ChevronIcon
                className={"checklist-group-chevron" + (collapsed ? " is-collapsed" : "")}
              />
            </button>
            {!collapsed &&
              group.items.map((item) => (
                <div key={item.key} className="field-block checklist-item">
                  <div className="field-block-label">{item.label}</div>
                  <ChecklistOptionGroup
                    name={item.key}
                    options={item.options}
                    value={values[item.key]}
                    onChange={(value) => onChange(item.key, value)}
                  />
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
