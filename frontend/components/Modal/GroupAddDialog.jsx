"use client";

import { useState } from "react";
import { CloseIcon } from "../icons";
import useScrollLock from "@/hooks/useScrollLock";
import { unitText } from "@/lib/data";

// <GroupAddDialog /> : 그룹을 보고 있을 때 목록 맨 아래 "이 그룹에 넣기"를 누르면 뜨는 창.
//
// 그룹 화면에서 "추가"를 누르는 사람이 원하는 건 대개 새 매물 등록이 아니라 **이미 담아둔
// 후보를 이 그룹에도 넣는 것**이다. 전에는 그러려면 전체 후보로 나가서 → 카드 체크 →
// 그룹 메뉴 → 추가, 네 단계를 거쳐야 했다(2026-09-17 결정).
//
// 후보 상한(6개)은 그룹별이 아니라 전체 기준이라, 6개를 다 채웠어도 여기서는 담을 수 있다.
// 새로 만드는 게 아니라 이미 있는 후보를 넣는 것이라 상한과 무관하기 때문이다.
export default function GroupAddDialog({
  open,
  groupName,
  candidates = [],
  canCreateNew = false,
  onAdd,
  onCreateNew,
  onCancel,
}) {
  const [picked, setPicked] = useState([]);
  useScrollLock(open);
  if (!open) return null;

  function toggle(id) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit() {
    if (picked.length === 0) return;
    onAdd(picked);
    setPicked([]);
  }

  return (
    <div
      className="edit-overlay is-open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="edit-dialog" role="dialog" aria-modal="true" aria-label="이 그룹에 넣기">
        <button type="button" className="edit-dialog-close" aria-label="닫기" onClick={onCancel}>
          <CloseIcon />
        </button>
        <div className="edit-dialog-header">
          <div>
            <div className="edit-dialog-title">이 그룹에 넣기</div>
            <div className="edit-dialog-name">{groupName}</div>
          </div>
        </div>

        <div className="edit-dialog-panel">
          {candidates.length > 0 ? (
            <ul className="group-add-list">
              {candidates.map((item) => (
                <li key={item.id}>
                  <label className="group-add-row">
                    <input
                      type="checkbox"
                      checked={picked.includes(item.backendId)}
                      onChange={() => toggle(item.backendId)}
                    />
                    <span className="group-add-name">{item.name}</span>
                    <span className="group-add-sub">
                      {`${item.sizeLabel} · ${unitText(item)}`}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="group-add-empty">
              담아둔 후보가 모두 이 그룹에 들어 있어요.
            </p>
          )}

          {/* 상한이 남아 있으면 새 매물을 등록하는 길도 같이 열어 둔다.
              여기서 등록한 후보는 보고 있는 그룹에도 함께 들어간다. */}
          {canCreateNew && (
            <button type="button" className="group-add-new" onClick={onCreateNew}>
              + 새 매물 등록하기
            </button>
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
            disabled={picked.length === 0}
            onClick={submit}
          >
            {picked.length > 0 ? `${picked.length}개 담기` : "담기"}
          </button>
        </div>
      </div>
    </div>
  );
}
