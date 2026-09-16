"use client";

import { useId } from "react";
import { ChecklistCheckIcon } from "./icons";

// <ChecklistOptionGroup /> : InspectionChecklist 전용 단일 선택 그룹.
// ChipGroup(향/인테리어에서 쓰는 알약 모양 칩)은 그대로 두고, 체크리스트만
// 아이콘(ChecklistCheckIcon)+텍스트 형태로 따로 만들었다 - 칩이 항목 수(최대
// 3개)에 비해 두껍고 공간을 많이 차지해서, 더 가벼운 형태로 바꾸고 항목
// 사이 좌우 간격도 넉넉히 뒀다(globals.css .checklist-option-row 참고).
// 접근성 패턴(radiogroup, 숨긴 input + label, 같은 값 다시 클릭하면 선택
// 해제)은 ChipGroup과 동일하게 유지한다.
export default function ChecklistOptionGroup({ name, options, value, onChange }) {
  const groupId = useId();
  const radioName = name ? `${name}-${groupId}` : groupId;

  return (
    <div className="checklist-option-row" role="radiogroup">
      {options.map((opt) => {
        const selected = value === opt.value;
        const inputId = `${groupId}-${opt.value}`;
        return (
          <div key={opt.value} className="checklist-option-item">
            <input
              type="radio"
              id={inputId}
              className="checklist-option-input"
              name={radioName}
              value={String(opt.value)}
              checked={selected}
              onChange={() => onChange(opt.value)}
              onClick={() => {
                if (selected) onChange(null);
              }}
            />
            <label
              htmlFor={inputId}
              className={"checklist-option" + (selected ? " is-selected" : "")}
            >
              <ChecklistCheckIcon checked={selected} />
              <span>{opt.label}</span>
            </label>
          </div>
        );
      })}
    </div>
  );
}
