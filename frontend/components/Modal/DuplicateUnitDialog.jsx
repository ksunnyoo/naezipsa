"use client";

import { CloseIcon } from "../icons";
import useScrollLock from "@/hooks/useScrollLock";

// <DuplicateUnitDialog /> : 담으려는 집이 이미 담아둔 후보와 카드에서 똑같이 보일 때만
// 뜨는 확인 창.
//
// 왜 동·호수를 필수로 받지 않는가: 매물을 보고 담는 시점에는 "12층대"까지만 아는 일이
// 흔하고, 동·호수는 임장을 다녀와야 아는 경우가 많다. 필수로 받으면 모르는 사람이
// 아무 값이나 적거나 담기를 포기한다. 그래서 평소에는 묻지 않고, **화면에서 구분이
// 안 되는 순간에만** 물어본다(판정은 카드에 쓰는 것과 같은 unitText로 한다).
//
// 어느 쪽을 골라도 막지 않는다 - "다른 집이에요"는 담은 뒤 수정 창을 열어 구분할
// 정보를 넣게 해주고, 거기서 아무것도 안 넣고 닫아도 그대로 담긴 채로 남는다.
export default function DuplicateUnitDialog({
  open,
  name,
  sizeLabel,
  unit,
  onSame,
  onDifferent,
  onCancel,
}) {
  useScrollLock(open);
  if (!open) return null;

  return (
    <div
      className="edit-overlay is-open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="이미 담은 집인지 확인"
      >
        <button type="button" className="edit-dialog-close" aria-label="닫기" onClick={onCancel}>
          <CloseIcon />
        </button>
        <div className="edit-dialog-header">
          <div>
            <div className="edit-dialog-title">이미 담은 집인가요?</div>
            <div className="edit-dialog-name">{`${name} · ${sizeLabel}`}</div>
          </div>
        </div>

        <div className="edit-dialog-panel">
          <p className="duplicate-dialog-text">
            같은 단지·평형 후보가 이미 있어요. 지금 담으면 카드에
            <b>{` ${unit} `}</b>
            으로 똑같이 보여서 둘을 구분할 수 없어요.
          </p>
          <p className="duplicate-dialog-hint">
            다른 집이라면 담은 뒤에 동·호수나 층을 넣어 구분할 수 있어요.
          </p>
        </div>

        <div className="edit-dialog-actions">
          <button type="button" className="edit-dialog-cancel" tabIndex={0} onClick={onSame}>
            이미 담은 집이에요
          </button>
          <button type="button" className="edit-dialog-save" tabIndex={0} onClick={onDifferent}>
            다른 집이에요
          </button>
        </div>
      </div>
    </div>
  );
}
