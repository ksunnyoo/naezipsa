"use client";

import { useEffect, useRef, useState } from "react";
import { DocumentIcon, PencilIcon, PlusIcon, ShareIcon, XIcon } from "../icons";

// <GroupBar /> : 헤더 "그룹" 버튼을 누르면 그 아래 말풍선 모양으로 펼쳐지는 그룹 메뉴.
// 그룹에 관한 동작은 모두 여기서 한다(목록 위에 따로 버튼 줄이나 이름 입력 모달을 두지 않는다).
//
//   그룹 한 줄      이름·후보 수. 누르면 목록이 그 그룹의 후보로 좁혀지고, 보고 있는 그룹은
//                   메인색으로 표시된다. 한 번 더 누르면 전체 후보로 돌아간다.
//     추가          카드에서 체크한 후보를 이 그룹에 넣는다.
//     연필          그 자리에서 이름을 고친다(Enter·입력칸 밖 클릭 저장, Esc 취소).
//     X             그룹만 삭제한다. 후보는 전체 후보에 남는다.
//     공유 아이콘   그룹 링크를 공유하고 있을 때만 보인다. 누르면 이 그룹 링크를 모두 끊는다(공유 중지).
//   새 그룹 만들기  이름을 묻지 않고 지금 보이는 목록의 체크한 후보로 바로 만들고,
//                   새 줄의 이름 입력칸을 열어 둔다(그대로 두면 기본 이름 유지).
//
// 어떤 동작도 후보를 지우거나 다시 만들지 않는다(백엔드 app/group).
export default function GroupBar({ menu }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);
  // 이번 이름 편집이 이미 저장·취소됐으면 뒤따르는 blur에서 다시 저장하지 않는다.
  const editDoneRef = useRef(false);

  useEffect(() => {
    if (editingId === null) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingId]);

  if (!menu.open) return null;

  const { groups, activeGroup, selectedCount } = menu;
  const canAdd = selectedCount > 0;
  const createHint = canAdd ? `체크한 후보 ${selectedCount}개` : "빈 그룹";

  function startEditing(group) {
    editDoneRef.current = false;
    setDraft(group.name);
    setEditingId(group.id);
  }

  function cancelEditing() {
    editDoneRef.current = true;
    setEditingId(null);
  }

  async function saveEditing(group) {
    if (editDoneRef.current) return;
    editDoneRef.current = true;
    const name = draft.trim();
    if (!name || name === group.name) {
      setEditingId(null);
      return;
    }
    if (await menu.onRename(group.id, name)) {
      setEditingId(null);
      return;
    }
    // 저장에 실패하면 입력을 그대로 두고 다시 시도할 수 있게 한다.
    editDoneRef.current = false;
  }

  async function createGroup() {
    if (creating) return;
    setCreating(true);
    const created = await menu.onCreate();
    setCreating(false);
    if (created) startEditing(created);
  }

  return (
    <div className="group-bar" data-component="GroupBar">
      <div className="group-bar-list">
        {groups.length === 0 ? (
          <p className="group-bar-empty">아직 만든 그룹이 없어요</p>
        ) : (
          groups.map((group) => {
            const active = group.id === activeGroup?.id;
            const editing = group.id === editingId;
            return (
              <div key={group.id} className={"group-row" + (active ? " is-active" : "")}>
                <div className="group-row-line">
                  {editing ? (
                    <div className="group-row-rename">
                      <DocumentIcon />
                      <input
                        ref={inputRef}
                        type="text"
                        maxLength={30}
                        value={draft}
                        aria-label={`"${group.name}" 그룹 이름`}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveEditing(group);
                          } else if (e.key === "Escape") {
                            // 메뉴 전체를 닫는 Esc 처리로 번지지 않게 끊는다.
                            e.stopPropagation();
                            cancelEditing();
                          }
                        }}
                        onBlur={() => saveEditing(group)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      tabIndex={0}
                      className="group-row-main"
                      title={active ? "한 번 더 누르면 전체 후보로 돌아가요" : group.name}
                      aria-label={`${group.name} (후보 ${group.item_count}개)`}
                      aria-pressed={active}
                      onClick={() => menu.onSelect(group.id)}
                    >
                      <DocumentIcon />
                      <span className="group-row-name">{group.name}</span>
                      <span className="group-row-count">{group.item_count}</span>
                    </button>
                  )}
                  {!editing && group.share_link_count > 0 && (
                    <button
                      type="button"
                      tabIndex={0}
                      className="group-row-share"
                      title="공유 중 · 누르면 공유를 중지해요"
                      aria-label={`"${group.name}" 그룹 공유 중지`}
                      onClick={() => menu.onStopShare(group.id)}
                    >
                      <ShareIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    tabIndex={0}
                    className="group-row-add"
                    disabled={!canAdd}
                    title={canAdd ? undefined : "그룹에 넣을 후보를 먼저 체크해주세요"}
                    aria-label={`체크한 후보 ${selectedCount}개를 "${group.name}" 그룹에 추가`}
                    onClick={() => menu.onAddTo(group.id)}
                  >
                    추가
                  </button>
                  {!editing && (
                    <button
                      type="button"
                      tabIndex={0}
                      className="group-row-edit"
                      aria-label={`"${group.name}" 그룹 이름 수정`}
                      onClick={() => startEditing(group)}
                    >
                      <PencilIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    tabIndex={0}
                    className="group-row-delete"
                    aria-label={`"${group.name}" 그룹 삭제`}
                    onClick={() => menu.onDelete(group.id)}
                  >
                    <XIcon />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        tabIndex={0}
        className="group-bar-create"
        disabled={creating}
        aria-label={`새 그룹 만들기 (${createHint})`}
        onClick={createGroup}
      >
        <PlusIcon />
        새 그룹 만들기
        <span className="group-bar-create-hint">{createHint}</span>
      </button>
    </div>
  );
}
