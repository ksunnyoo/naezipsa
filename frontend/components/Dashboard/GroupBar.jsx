"use client";

import { useEffect, useRef, useState } from "react";
import { DocumentIcon, PencilIcon, PlusIcon, ShareIcon, XIcon } from "../icons";
import { WEIGHT_CATEGORIES, editableWeights } from "@/lib/checklist";

// 가중치 합. 전부 0이면 점수를 낼 수 없어 저장 버튼을 잠근다(서버도 422로 막는다).
function scoringTotal(weights) {
  return WEIGHT_CATEGORIES.reduce((sum, { key }) => sum + (Number(weights[key]) || 0), 0);
}

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
  // 점수 기준(가중치)을 펼쳐 놓은 그룹과 편집 중인 값. 그룹마다 따로 저장한다.
  const [scoringId, setScoringId] = useState(null);
  const [weights, setWeights] = useState({});
  const [savingWeights, setSavingWeights] = useState(false);
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

  // 점수 기준 펼치기 - 이 그룹에 정해둔 값이 있으면 그걸로, 없으면 프로필
  // 이용 목적(전세/매매)에서 온 기본값을 시작점으로 보여준다.
  function openScoring(group) {
    setScoringId(group.id);
    setWeights(editableWeights(group, menu.profile));
  }

  async function saveWeights(group, next) {
    if (savingWeights) return;
    setSavingWeights(true);
    const saved = await menu.onUpdateScoring(group.id, next);
    setSavingWeights(false);
    if (saved) setScoringId(null);
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
                  {!editing && (
                    <button
                      type="button"
                      tabIndex={0}
                      className="group-row-scoring"
                      title="이 그룹의 점수 기준"
                      aria-expanded={scoringId === group.id}
                      aria-label={`"${group.name}" 그룹 점수 기준`}
                      onClick={() =>
                        scoringId === group.id ? setScoringId(null) : openScoring(group)
                      }
                    >
                      점수
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
                {scoringId === group.id && (
                  <div className="group-scoring">
                    <p className="group-scoring-hint">
                      이 그룹의 후보만 아래 비중으로 점수를 매겨요. 합이 100일 필요는
                      없어요 — 비율만 씁니다.
                    </p>
                    {WEIGHT_CATEGORIES.map(({ key, label }) => (
                      <label key={key} className="group-scoring-row">
                        <span>{label}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={weights[key] ?? 0}
                          disabled={savingWeights}
                          onChange={(e) =>
                            setWeights((prev) => ({
                              ...prev,
                              [key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            }))
                          }
                        />
                      </label>
                    ))}
                    <div className="group-scoring-actions">
                      <button
                        type="button"
                        className="group-scoring-save"
                        disabled={savingWeights || scoringTotal(weights) === 0}
                        title={
                          scoringTotal(weights) === 0
                            ? "하나 이상은 0보다 크게 정해주세요"
                            : undefined
                        }
                        onClick={() => saveWeights(group, weights)}
                      >
                        저장
                      </button>
                      <button
                        type="button"
                        className="group-scoring-reset"
                        disabled={savingWeights}
                        title="이 그룹만의 기준을 지우고 프로필 기본(전세/매매)으로 되돌려요"
                        onClick={() => saveWeights(group, null)}
                      >
                        기본값으로
                      </button>
                    </div>
                  </div>
                )}
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
