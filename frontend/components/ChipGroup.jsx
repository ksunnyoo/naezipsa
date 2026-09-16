"use client";

import { useId } from "react";

// <ChipGroup name options value onChange /> : 향/인테리어처럼 라디오처럼 하나만
// 선택되는 칩 그룹. 같은 값을 다시 누르면 선택 해제(null)된다.
//
// 2026-09: 예전엔 칩마다 <button role="radio" tabIndex={0}>라 브라우저
// 입장에선 그냥 버튼이 여러 개인 것과 같아서, Tab을 누르면 칩 하나하나에
// 다 포커스가 걸렸다(피드백). 진짜 <input type="radio">를 같은 name으로
// 묶으면 Tab은 그룹 전체를 한 번에 넘어가고(선택된 하나에만 포커스가
// 걸림), 그룹 안에서는 방향키로 이동하는 표준 동작을 공짜로 얻는다.
//
// name은 화면 안에서 같이 쓰이는 다른 ChipGroup(예: 향/인테리어)과 겹치지
// 않도록 호출부가 넘겨주는 값 + useId()를 합쳐서 만든다 - 이 다이얼로그와
// 다른 다이얼로그(EditListingDialog/InterestModal)가 항상 같이 DOM에
// 떠있는 구조라, 이름이 겹치면 서로 다른 다이얼로그의 라디오 그룹이 같은
// name으로 묶여 버리는(브라우저가 문서 전체에서 name으로 그룹을 잡는다)
// 사고를 막기 위함이다.
//
// options는 두 형태 모두 받는다 - 문자열 배열(["남동", "남서", ...], 기존
// 향/인테리어 방식으로 값과 라벨이 같음)이거나, {value, label} 객체 배열
// (체크리스트처럼 저장값(숫자 등)과 화면에 보일 문구가 다를 때). 문자열은
// 내부적으로 {value: opt, label: opt}로 취급해서 기존 호출부는 그대로 둔다.
function normalizeOption(raw) {
  return raw !== null && typeof raw === "object" ? raw : { value: raw, label: raw };
}

export default function ChipGroup({ name, options, value, onChange }) {
  const groupId = useId();
  const radioName = name ? `${name}-${groupId}` : groupId;

  return (
    <div className="chip-row" role="radiogroup">
      {options.map((raw) => {
        const opt = normalizeOption(raw);
        const selected = value === opt.value;
        const inputId = `${groupId}-${opt.value}`;
        return (
          <div key={opt.value} className="chip-option">
            <input
              type="radio"
              id={inputId}
              className="chip-input"
              name={radioName}
              value={String(opt.value)}
              checked={selected}
              onChange={() => onChange(opt.value)}
              onClick={() => {
                // 라디오는 "이미 선택된 걸 다시 클릭"해도 change가 안 뜬다
                // (체크 상태가 안 바뀌므로) - click은 항상 뜨니 여기서
                // 선택 해제만 별도로 처리한다.
                if (selected) onChange(null);
              }}
            />
            <label htmlFor={inputId} className={"chip" + (selected ? " is-selected" : "")}>
              {opt.label}
            </label>
          </div>
        );
      })}
    </div>
  );
}
