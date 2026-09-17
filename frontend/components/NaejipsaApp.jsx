"use client";

import { useEffect, useRef, useState } from "react";
import Header from "./Header";
import Workspace from "./Workspace";
import InterestModal from "./Modal/InterestModal";
import EditListingDialog from "./EditListingDialog";
import AuthModal from "./Modal/AuthModal";
import ProfileOnboardingModal from "./Modal/ProfileOnboardingModal";
import useProfileOnboarding from "@/hooks/useProfileOnboarding";
import ImportShareModal from "./Modal/ImportShareModal";
import DuplicateUnitDialog from "./Modal/DuplicateUnitDialog";
import GroupAddDialog from "./Modal/GroupAddDialog";
import Toast from "./Toast";
import useToast from "@/hooks/useToast";
import { MAX_DASHBOARD_GROUPS, MAX_DASHBOARD_ITEMS, unitText } from "@/lib/data";
import { supabase } from "@/lib/supabaseClient";
import {
  getDashboardItems,
  createDashboardItem,
  updateDashboardItemDetails,
  deleteDashboardItem,
  reorderDashboardItems,
  getGroups,
  getGroup,
  createGroup,
  renameGroup,
  deleteGroup,
  addGroupItems,
  removeGroupItem,
  createDashboardShare,
  getDashboardShare,
  createGroupShareLink,
  revokeGroupShareLinks,
  getSharedGroup,
  deleteInspection,
  getInspection,
  getInspections,
  saveInspection,
  updateGroupScoring,
} from "@/lib/api";
import {
  toCreateItemPayload,
  toDetailsPayload,
  fromBackendItem,
} from "@/lib/dashboardItems";
import {
  computeOverallScore,
  fromInspectionRecord,
  toInspectionPayload,
  weightsForContext,
} from "@/lib/checklist";

// 새 그룹 기본 이름: "새 그룹", 이미 있으면 "새 그룹 2", "새 그룹 3" ...
// 이름을 먼저 묻지 않고 만든 뒤 그룹 메뉴에서 바로 고친다.
function nextGroupName(groups) {
  const names = new Set(groups.map((group) => group.name));
  if (!names.has("새 그룹")) return "새 그룹";
  let n = 2;
  while (names.has(`새 그룹 ${n}`)) n += 1;
  return `새 그룹 ${n}`;
}

// 체크리스트 캐시 키. 로그인 후보는 서버 id로 잡는다 - 목록을 다시 불러오면
// 화면용 id("item-1")가 순번대로 다시 매겨지기 때문에, 그 사이 후보를 지운 적이
// 있으면 다른 매물의 체크리스트가 붙을 수 있다. 게스트 후보는 서버 id가 없어
// 화면용 id를 쓰되, 두 종류가 섞이지 않게 접두어를 붙인다.
function checklistKey(item) {
  if (!item) return null;
  return item.backendId != null ? `srv-${item.backendId}` : `loc-${item.id}`;
}

// 주소에서 공유 토큰(?share= / ?groupShare=)을 지운다.
//
// 미리보기를 닫은 뒤, 또는 열리지 않는 링크일 때만 부른다. 링크를 열자마자 지우면
// 새로고침했을 때 불러올 토큰이 없어서, 받은 사람이 링크를 다시 붙여넣기 전까지
// 그룹의 최신 내용을 볼 수 없다 - 그룹 링크는 열 때마다 지금 후보를 보여주는 게 핵심이다.
function clearShareTokenFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("share") && !url.searchParams.has("groupShare")) return;
  url.searchParams.delete("share");
  url.searchParams.delete("groupShare");
  window.history.replaceState({}, "", url);
}

// 보고 있는 그룹을 주소에 남긴다(?group=12).
//
// 전에는 보고 있는 그룹이 화면 state에만 있어서 새로고침하면 전체 후보로 풀렸다.
// 주소에 남기면 새로고침해도 유지되고, 들어갈 때 기록을 쌓으므로(pushState)
// 브라우저 뒤로가기로 전체 후보에 돌아올 수 있다(2026-09-17 결정).
// 공유 토큰(?share=/?groupShare=)과 같은 자리를 쓰므로 이 키만 손댄다.
function readGroupIdFromUrl() {
  const raw = new URL(window.location.href).searchParams.get("group");
  const id = Number(raw);
  return raw && Number.isInteger(id) && id > 0 ? id : null;
}

// 이미 같은 값이면 아무것도 하지 않는다 - 뒤로가기로 주소가 먼저 바뀐 경우에
// 우리가 그 위에 기록을 또 쌓아서 뒤로가기가 안 먹는 것을 막는다.
function writeGroupIdToUrl(groupId, { replace = false } = {}) {
  const url = new URL(window.location.href);
  const next = groupId == null ? null : String(groupId);
  if ((url.searchParams.get("group") ?? null) === next) return;
  if (next == null) url.searchParams.delete("group");
  else url.searchParams.set("group", next);
  if (replace) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
}

// 목록을 주어진 id 순서로 줄 세운다(key: 로컬 id "id" 또는 서버 id "backendId").
// 후보 내용(체크·메모 등)은 건드리지 않고, 순서에 없는 후보는 원래 순서대로 뒤에 둔다.
function orderItemsBy(items, ids, key) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  const last = ids.length;
  return [...items].sort((a, b) => (rank.get(a[key]) ?? last) - (rank.get(b[key]) ?? last));
}

// <App /> : 최상위 클라이언트 컴포넌트. 대시보드 아이템, 히어로 노출 여부,
// 모달/수정팝업 열림 상태처럼 여러 자식이 함께 필요로 하는 state를 여기서
// 들고 내려준다(3~4단계 깊이라 prop 전달로 충분 — 별도 context는 안 씀).
export default function NaejipsaApp() {
  const [dashboardItems, setDashboardItems] = useState([]);
  const [dashboardUserId, setDashboardUserId] = useState(null);
  const [dashboardItemSeq, setDashboardItemSeq] = useState(0);
  // dashboardRevealed: 한 번 true가 되면 영구히 true(다시 안 돌아감) — 대시보드
  // 탭/"대시보드로 돌아가기" 버튼처럼 "최초 1회 이후로 쓸 수 있는" UI를 켜는
  // 가드. heroCleared: 히어로가 지금 시각적으로 걷혀있는지 — 로고 클릭으로
  // 다시 열 수 있고, 매물을 등록할 때마다(최초든 재등록이든) 다시 닫힌다.
  const [dashboardRevealed, setDashboardRevealed] = useState(false);
  const [heroCleared, setHeroCleared] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [profileEditorUserId, setProfileEditorUserId] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  // itemChecklists: 후보별 임장 체크리스트. checklistKey(item) -> {values, rating, memo}
  // 이고, 아직 서버에서 받아오지 않았으면 키 자체가 없다(불러왔는데 기록이
  // 없으면 null이 들어간다 - 그래야 팝업을 다시 열 때 또 부르지 않는다).
  //
  // 2026-09-16부터 로그인 사용자는 서버에 저장하므로 새로고침해도 남는다.
  // 여기서 들고 있는 이유는 팝업을 열 때마다 다시 부르지 않기 위해서다.
  // 게스트는 서버에 저장할 수 없어 이 세션 동안만 유지된다.
  const [itemChecklists, setItemChecklists] = useState({});
  // activeContentTab: 헤더의 "상세 데이터"/"인사이트" 메뉴 - Workspace가 이
  // 값을 받아 .content-track(오른쪽 차트 영역)을 좌우로 슬라이드한다.
  const [activeContentTab, setActiveContentTab] = useState("detail");
  // 로그인 세션(user) - Supabase Auth가 관리하는 세션을 그대로 반영한다.
  // getSession()으로 새로고침 시 기존 로그인을 복원하고, onAuthStateChange로
  // 로그인/로그아웃/토큰 갱신이 일어날 때마다 최신 상태를 따라간다(로그인
  // 모달의 이메일·소셜 로그인은 성공하면 이 리스너를 통해 자동으로 반영됨).
  const [user, setUser] = useState(null);
  const { profile, error: profileError, retry: retryProfile, save: saveProfile } = useProfileOnboarding(user?.id);
  const profileEditorOpen = Boolean(profile && user?.id === profileEditorUserId);
  const toast = useToast();

  // 정렬 저장(Phase 3 보완). serverOrderRef는 마지막으로 서버와 맞춘 내 후보 순서(서버 id)로,
  // 순서를 저장할 때 "드래그 전 순서"로 함께 보낸다. 저장하는 동안에는 다음 드래그를 막는다.
  const serverOrderRef = useRef([]);
  const [orderSaving, setOrderSaving] = useState(false);
  // 비동기 응답이 도착했을 때 로그인 계정이 바뀌었는지 확인한다.
  const currentUserIdRef = useRef(null);
  useEffect(() => {
    currentUserIdRef.current = user?.id ?? null;
  }, [user]);

  // 그룹(Phase 4) - 그룹은 기존 후보를 가리키기만 한다(백엔드 app/group). 그룹을 보거나
  // 바꿔도 dashboardItems를 지우거나 다시 만들지 않으므로 후보 id가 유지되고, 후보에
  // 연결된 임장 기록 같은 데이터도 끊기지 않는다. groups는 GroupBar를 펼칠 때마다 새로 받는다.
  const [groups, setGroups] = useState([]);
  const [groupBarOpen, setGroupBarOpen] = useState(false);
  // 지금 보고 있는 그룹. null이면 "전체 후보". itemIds는 그룹에 든 후보의 서버 id(backendId),
  // userId는 이 보기 상태를 만든 계정(계정이 바뀌면 쓰지 않는다).
  const [activeGroup, setActiveGroup] = useState(null);
  // 그룹 요청이 끝나기 전에 Enter/클릭이 반복돼 같은 요청이 두 번 가는 것을 막는다.
  const groupBusyRef = useRef(false);
  // 그룹 화면의 "이 그룹에 넣기" 창.
  const [groupAddOpen, setGroupAddOpen] = useState(false);
  // 주소에 있던 그룹을 복원하기 전에는 주소를 건드리지 않는다(복원 전에 지워버리면 안 된다).
  const groupRestoredRef = useRef(false);

  // 공유 - URL의 ?share=<token>(매물 스냅샷)이나 ?groupShare=<token>(그룹 링크)을 열었을 때 보여줄
  // 미리보기 상태. sharePreviewGroupName은 그룹 링크일 때만 그룹 이름이 들어간다.
  const [sharePreviewItems, setSharePreviewItems] = useState([]);
  const [sharePreviewGroupName, setSharePreviewGroupName] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  // 담으려는 집이 이미 담아둔 후보와 카드에서 똑같이 보일 때만 채워진다.
  // { item: 담으려던 값, twinId: 똑같이 보이는 기존 후보의 화면용 id }
  const [duplicatePrompt, setDuplicatePrompt] = useState(null);

  // 늦은 프로필 조회가 기존 후보 입력창·그룹/공유 팝업 위에 새 모달을 겹쳐 열지
  // 않게 한다. 그룹·공유 팝업 state를 참조하므로 그 선언 뒤에 둔다.
  const onboardingOpen = profile?.service_purposes === null &&
    !modalOpen && !authModalOpen && !profileEditorOpen && editingItemId === null &&
    !importModalOpen;

  useEffect(() => {
    let cancelled = false;
    let authEventReceived = false;

    supabase.auth.getSession().then(({ data }) => {
      // 초기 조회보다 로그인 이벤트가 먼저 왔다면 최신 세션을 유지한다.
      if (cancelled || authEventReceived) return;
      setUser(data.session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      setUser(session?.user ?? null);
      setProfileEditorUserId((current) => current === session?.user?.id ? current : null);
      if (session?.user) setAuthModalOpen(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  function handleLogout() {
    supabase.auth.signOut();
    // 로그아웃 자체는 사용자 액션이라 여기서 바로 비운다(로그인 전
    // 게스트 상태로 되돌아감). 세션이 다른 이유로 끊기는 경우(토큰 만료
    // 등)는 흔치 않아 일단 로그아웃 버튼 경로만 처리한다.
    setDashboardItems([]);
    serverOrderRef.current = [];
    setGroups([]);
    setActiveGroup(null);
  }

  // 로그인 상태가 바뀔 때마다 대시보드 아이템을 서버 기준으로 맞춘다.
  // 로그인: 이전에 저장해둔 후보 목록을 그대로 불러와 보여준다(요청 사항).
  // 로그아웃: 서버 목록을 치우고 빈 게스트 상태로 돌아간다 - 로그인 전에
  // 게스트로 추가했던 항목은 애초에 서버에 없던 것이라 같이 사라진다.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    getDashboardItems()
      .then((res) => {
        if (cancelled) return;
        const items = res.items.map((raw, index) =>
          fromBackendItem(raw, `item-${index + 1}`),
        );
        setDashboardItemSeq(items.length);
        setDashboardItems(items);
        serverOrderRef.current = res.items.map((raw) => raw.id);
        setDashboardUserId(user.id);
        if (items.length > 0) {
          setDashboardRevealed(true);
          setHeroCleared(true);
        }
        // 카드에 점수를 띄우려면 목록 단계에서 모든 후보의 체크리스트가 필요하다.
        // 후보마다 한 번씩 부르면 느려서 한 번에 받아온다. 실패하면 목록은 그대로
        // 보여주고 점수만 안 보인다(작성·저장은 그대로 된다).
        getInspections()
          .then((inspections) => {
            if (cancelled || currentUserIdRef.current !== user.id) return;
            setItemChecklists(
              Object.fromEntries(
                inspections.items.map((record) => [
                  `srv-${record.property_id}`,
                  fromInspectionRecord(record),
                ]),
              ),
            );
          })
          .catch(() => {});
      })
      .catch(() => {
        if (cancelled) return;
        toast.show("저장된 관심 매물을 불러오지 못했어요.");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 공유 링크로 들어온 경우 미리보기를 띄운다. 로그인 여부와 무관하게 동작해야
  // 하므로(게스트도 공유받은 걸 볼 수 있어야 함) user에 의존하지 않는 별도 마운트
  // 1회 효과로 둔다.
  //   ?share=<token>       전체 후보를 떠 둔 매물 스냅샷
  //   ?groupShare=<token>  그룹 링크(Phase 5) - 열 때마다 그 그룹의 지금 후보. 동·호수까지 보인다.
  // 어느 쪽이든 링크를 열기만 해서는 아무것도 저장하지 않는다. "내 목록에 추가"를 눌러야 복사한다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const groupToken = params.get("groupShare");
    const snapshotToken = params.get("share");
    if (!groupToken && !snapshotToken) return;

    let cancelled = false;
    const preview = groupToken ? getSharedGroup(groupToken) : getDashboardShare(snapshotToken);
    preview
      .then((res) => {
        if (cancelled) return;
        setSharePreviewItems(res.items);
        setSharePreviewGroupName(groupToken ? res.name : null);
        setImportModalOpen(true);
      })
      .catch(() => {
        if (cancelled) return;
        toast.show(groupToken
          ? "존재하지 않거나 공유가 중지된 그룹 링크예요."
          : "존재하지 않거나 만료된 공유 링크예요.");
        // 열리지 않는 링크는 바로 지운다. 남겨두면 새로고침할 때마다 같은 안내가 뜬다.
        clearShareTokenFromUrl();
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editingItem =
    dashboardItems.find((it) => it.id === editingItemId) || null;
  const mainScreenInert =
    modalOpen ||
    authModalOpen ||
    editingItemId != null ||
    onboardingOpen ||
    profileEditorOpen ||
    importModalOpen ||
    duplicatePrompt != null ||
    groupAddOpen;

  // 그룹을 보고 있으면 그 그룹에 든 후보만 보여준다(순서는 전체 후보에서 정한 순서).
  // 후보 자체는 dashboardItems에 그대로 있다.
  const shownGroup = activeGroup && activeGroup.userId === user?.id ? activeGroup : null;
  const scopedItems = shownGroup
    ? dashboardItems.filter(
        (it) => it.backendId != null && shownGroup.itemIds.includes(it.backendId),
      )
    : dashboardItems;
  // "이 그룹에 넣기"에서 고를 수 있는 후보 - 이미 담아뒀지만 이 그룹에는 없는 것.
  const groupAddCandidates = shownGroup
    ? dashboardItems.filter(
        (it) => it.backendId != null && !shownGroup.itemIds.includes(it.backendId),
      )
    : [];
  // 카드에 띄울 임장 점수. 지금 보고 있는 화면 기준으로 가중치를 고른다 - 그룹을
  // 보고 있으면 그 그룹 기준, 전체 후보 화면이면 프로필 기본(전세/매매)이다.
  // 같은 후보라도 그룹을 옮기면 점수가 달라 보이지만, 한 그룹 안에서는 모두 같은
  // 자로 재기 때문에 그 안의 비교는 언제나 공정하다(2026-09-16 결정).
  const scoringWeights = weightsForContext(shownGroup, profile);
  const visibleItems = scopedItems.map((item) => {
    const saved = itemChecklists[checklistKey(item)];
    const result = saved ? computeOverallScore(saved.values, scoringWeights) : null;
    // 체크리스트를 쓰지 않은 후보는 점수가 없다(카드에 뱃지도 안 붙는다).
    // 몇 개를 보고 낸 점수인지도 함께 넘긴다 - 2개만 보고 낸 100점과 18개를 다 본
    // 72점이 카드에 나란히 놓이면 앞이 더 좋아 보이기 때문이다.
    return result == null
      ? item
      : { ...item, score: result.score, scoreChecked: result.checked, scoreTotal: result.total };
  });
  // 그룹 만들기·기존 그룹에 추가의 "선택"은 카드 체크 상태를 그대로 쓴다(서버에 저장된 후보만).
  const selectedBackendIds = visibleItems
    .filter((it) => it.checked && it.backendId != null)
    .map((it) => it.backendId);

  // 새로고침 복원 - 후보 목록을 받은 뒤에 한 번만 한다.
  // 그룹은 후보의 서버 id로 이뤄져 있어서, 목록보다 먼저 복원하면 걸러낼 대상이 없다.
  useEffect(() => {
    if (!user || dashboardUserId !== user.id || groupRestoredRef.current) return;
    groupRestoredRef.current = true;
    const id = readGroupIdFromUrl();
    if (id == null) return;
    getGroup(id)
      .then(showGroup)
      // 지워졌거나 남의 그룹이면 조용히 전체 후보로 두고 주소만 정리한다.
      .catch(() => writeGroupIdToUrl(null, { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showGroup은 렌더마다 새로 만들어지는 함수라 넣으면 복원이 반복된다. 복원은 목록을 처음 받았을 때 한 번뿐이다(groupRestoredRef).
  }, [user, dashboardUserId]);

  // 보고 있는 그룹이 바뀌면 주소에 남긴다. 복원이 끝나기 전에는 건드리지 않는다.
  useEffect(() => {
    if (!groupRestoredRef.current) return;
    writeGroupIdToUrl(shownGroup?.id ?? null);
  }, [shownGroup?.id]);

  // 브라우저 뒤로/앞으로 - 주소가 먼저 바뀌므로 화면을 그쪽에 맞춘다.
  useEffect(() => {
    if (!user) return;
    function syncFromUrl() {
      const id = readGroupIdFromUrl();
      if (id === (shownGroup?.id ?? null)) return;
      if (id == null) {
        setActiveGroup(null);
        return;
      }
      getGroup(id)
        .then(showGroup)
        .catch(() => {
          setActiveGroup(null);
          writeGroupIdToUrl(null, { replace: true });
        });
    }
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showGroup은 렌더마다 새로 만들어져, 넣으면 매 렌더 리스너를 떼었다 다시 단다. 이 효과가 알아야 할 변화는 로그인 계정과 보고 있는 그룹뿐이다.
  }, [user, shownGroup?.id]);

  // Escape로 닫기 — edit-overlay가 열려 있으면 그쪽을 먼저 닫고, 아니면
  // modal-overlay를 닫는 순서(프로토타입과 동일). ImportShareModal도 같은
  // edit-overlay 뼈대를 쓰므로 같은 순서에 낀다. 그룹 메뉴도 Esc로 닫는다.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      if (editingItemId != null) {
        setEditingItemId(null);
        return;
      }
      if (groupBarOpen) {
        setGroupBarOpen(false);
        return;
      }
      if (importModalOpen) {
        handleImportCancel();
        return;
      }
      if (groupAddOpen) {
        setGroupAddOpen(false);
        return;
      }
      if (modalOpen) setModalOpen(false);
      if (authModalOpen) setAuthModalOpen(false);
      // 아무 창도 열려 있지 않을 때만 - 그룹 보기에서 나간다(칩의 ✕와 같은 동작).
      if (!modalOpen && !authModalOpen && shownGroup) setActiveGroup(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingItemId, modalOpen, authModalOpen, groupBarOpen, importModalOpen,
      groupAddOpen, shownGroup]);

  // 매물을 등록할 때마다 호출 — 대시보드 최초 노출 여부(dashboardRevealed)와
  // 무관하게 히어로는 매번 걷힌다. 로고로 히어로를 다시 연 상태에서 매물을
  // 추가로 등록해도 등록 직후 다시 위로 슬라이드되며 사라져야 하기 때문.
  function revealDashboard() {
    setDashboardRevealed(true);
    setHeroCleared(true);
  }
  function reopenHero() {
    if (!dashboardRevealed) return;
    setHeroCleared(false);
  }
  function closeHeroAgain() {
    if (!dashboardRevealed) return;
    setHeroCleared(true);
  }

  // --- 그룹 --------------------------------------------------------------
  // 게스트는 서버에 후보가 없으므로 로그인 사용자만 쓸 수 있다.

  // 팝업이 열려있을 때 트리거 버튼/팝업(.group-save-wrap) 바깥을 클릭하면
  // 닫는다. 버튼 클릭 자체도 이 리스너를 타지만 버튼이 .group-save-wrap
  // 안에 있어서 걸러지므로 토글이 이중으로 일어나지 않는다.
  useEffect(() => {
    if (!groupBarOpen) return;
    function onOutsideClick(e) {
      if (!e.target.closest(".group-save-wrap")) {
        setGroupBarOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [groupBarOpen]);

  function showGroup(group) {
    setActiveGroup({
      id: group.id, name: group.name, itemIds: group.item_ids, userId: user.id,
      // 이 그룹의 점수 기준. null이면 프로필 기본(전세/매매)으로 점수를 낸다.
      scoring_weights: group.scoring_weights ?? null,
    });
  }

  // 서버가 돌려준 그룹 상세로 GroupBar 목록과 보고 있는 그룹을 함께 갱신한다.
  function applyGroup(group) {
    setGroups((gs) => gs.map((g) => (g.id === group.id ? group : g)));
    setActiveGroup((current) =>
      current?.id === group.id
        ? {
            ...current,
            name: group.name,
            itemIds: group.item_ids,
            scoring_weights: group.scoring_weights ?? null,
          }
        : current,
    );
  }

  async function refreshGroups() {
    const res = await getGroups();
    setGroups(res.groups);
  }

  async function handleGroupBarToggle() {
    if (!user) {
      toast.show("로그인 후 이용할 수 있어요");
      return;
    }
    const next = !groupBarOpen;
    setGroupBarOpen(next);
    if (!next) return;
    try {
      await refreshGroups();
    } catch (err) {
      toast.show(err.message);
    }
  }

  // 그룹 보기 - 목록을 이 그룹의 후보로 좁혀 보여줄 뿐, 후보를 지우거나 다시 만들지 않는다.
  // 보고 있는 그룹을 한 번 더 누르면 선택이 풀리고 전체 후보로 돌아간다. 메뉴는 열어 둬서
  // 어떤 그룹을 보고 있는지(테두리) 바로 확인할 수 있게 한다.
  async function handleSelectGroup(groupId) {
    if (shownGroup?.id === groupId) {
      setActiveGroup(null);
      return;
    }
    try {
      showGroup(await getGroup(groupId));
    } catch (err) {
      toast.show(err.message);
    }
  }

  // 그룹 메뉴의 새 그룹 만들기 - 이름을 먼저 묻지 않고 기본 이름으로 바로 만든다.
  // 지금 보이는 목록(전체 후보 또는 보고 있는 그룹)에서 체크한 후보를 가리키며, 원래 그룹과
  // 후보는 그대로 남는다. 보고 있는 화면은 바꾸지 않는다(만든 그룹은 메뉴에서 눌러 들어간다).
  // 만든 그룹을 돌려줘 메뉴가 그 줄의 이름 입력칸을 바로 열게 한다.
  async function handleCreateGroup() {
    if (groups.length >= MAX_DASHBOARD_GROUPS) {
      toast.show(`그룹은 최대 ${MAX_DASHBOARD_GROUPS}개까지 만들 수 있어요`);
      return null;
    }
    if (groupBusyRef.current) return null;
    groupBusyRef.current = true;
    try {
      const group = await createGroup(nextGroupName(groups), selectedBackendIds);
      setGroups((gs) => [...gs, group]);
      return group;
    } catch (err) {
      toast.show(err.message);
      return null;
    } finally {
      groupBusyRef.current = false;
    }
  }

  // 그룹 메뉴 안에서 바로 이름을 고친다(모달 없음). 성공 여부를 돌려줘 메뉴가 편집을 끝낼지 정한다.
  async function handleRenameGroup(groupId, name) {
    try {
      applyGroup(await renameGroup(groupId, name));
      return true;
    } catch (err) {
      toast.show(err.message);
      return false;
    }
  }

  // 그룹의 점수 기준(카테고리 가중치) 저장. weights가 null이면 그룹 기준을 지워
  // 프로필 기본(전세/매매)으로 되돌린다. 저장하면 그 그룹을 보고 있는 동안 카드
  // 점수가 바로 새 기준으로 다시 계산된다.
  async function handleUpdateScoring(groupId, weights) {
    try {
      applyGroup(await updateGroupScoring(groupId, weights));
      toast.show(weights ? "점수 기준을 저장했어요" : "점수 기준을 기본값으로 되돌렸어요");
      return true;
    } catch (err) {
      toast.show(err.message);
      return false;
    }
  }

  // 체크리스트의 "?"에서 점수 기준을 고쳤을 때. 어디에 저장할지는 지금 보고 있는
  // 화면이 정한다 - 그룹을 보는 중이면 그 그룹에, 전체 후보 화면이면 내 기본
  // 기준(프로필)에 저장한다. weights가 null이면 정해둔 기준을 지운다.
  // 저장하면 profile이나 그룹이 갱신되어 카드·팝업 점수가 바로 다시 계산된다.
  async function handleSaveWeights(weights) {
    if (shownGroup) return handleUpdateScoring(shownGroup.id, weights);
    if (!user) {
      toast.show("로그인 후 이용할 수 있어요");
      return false;
    }
    try {
      await saveProfile({ scoring_weights: weights });
      toast.show(weights ? "점수 기준을 저장했어요" : "점수 기준을 기본값으로 되돌렸어요");
      return true;
    } catch {
      toast.show("점수 기준을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
      return false;
    }
  }

  // 그룹 칩의 ✕ (와 Esc) - 목록을 전체 후보로 되돌릴 뿐, 그룹도 후보도 건드리지 않는다.
  function handleExitGroup() {
    setActiveGroup(null);
  }

  // 그룹 화면 맨 아래 "이 그룹에 넣기".
  // 후보 상한(6개)은 전체 기준이라, 6개를 다 채웠어도 그룹에 넣는 건 언제나 된다.
  async function handleAddPickedToGroup(itemIds) {
    if (!shownGroup || itemIds.length === 0) return;
    if (groupBusyRef.current) return;
    groupBusyRef.current = true;
    try {
      applyGroup(await addGroupItems(shownGroup.id, itemIds));
      toast.show(`"${shownGroup.name}" 그룹에 ${itemIds.length}개를 넣었어요`);
      setGroupAddOpen(false);
    } catch (err) {
      toast.show(err.message);
    } finally {
      groupBusyRef.current = false;
    }
  }

  // 넣을 창에서 "새 매물 등록하기". 여기서 등록한 후보는 보고 있는 그룹에도 함께 들어간다.
  function handleCreateFromGroupAdd() {
    setGroupAddOpen(false);
    setModalOpen(true);
  }

  // 그룹 메뉴의 "추가" - 체크한 후보를 그 그룹에 넣는다. 이미 들어 있는 후보는 빼고
  // 보낸다(서버도 중복은 409로 막는다).
  async function handleAddToGroup(groupId) {
    const itemIds = selectedBackendIds;
    if (itemIds.length === 0) {
      toast.show("그룹에 넣을 후보를 체크해주세요");
      return;
    }
    if (groupBusyRef.current) return;
    groupBusyRef.current = true;
    try {
      const current = await getGroup(groupId);
      const missing = itemIds.filter((id) => !current.item_ids.includes(id));
      if (missing.length === 0) {
        toast.show(`"${current.name}" 그룹에 이미 모두 들어 있어요`);
      } else {
        const group = await addGroupItems(groupId, missing);
        applyGroup(group);
        const skipped = itemIds.length - missing.length;
        toast.show(
          skipped > 0
            ? `"${group.name}" 그룹에 ${missing.length}개를 넣었어요 (이미 있던 ${skipped}개 제외)`
            : `"${group.name}" 그룹에 ${missing.length}개를 넣었어요`,
        );
      }
    } catch (err) {
      toast.show(err.message);
    } finally {
      groupBusyRef.current = false;
    }
  }

  // 그룹 삭제 - 그룹과 그 관계만 지운다. 후보는 전체 후보에 그대로 남는다.
  // 낙관적으로 먼저 화면에서 지우지 않고 성공한 뒤에 지운다(이 앱의 다른 삭제 동작과 동일).
  async function handleDeleteGroup(groupId) {
    try {
      await deleteGroup(groupId);
      setGroups((gs) => gs.filter((g) => g.id !== groupId));
      setActiveGroup((current) => (current?.id === groupId ? null : current));
      toast.show("그룹을 삭제했어요. 후보는 전체 후보에 그대로 있어요");
    } catch (err) {
      toast.show(err.message);
    }
  }

  // --- 공유 ---------------------------------------------------------
  // 링크를 만드는 건 로그인 사용자만(내 관심 매물을 스냅샷 뜨는 것이므로).
  // 링크를 "여는" 건(아래 handleImportShare) 게스트도 가능 - 공유는 받는
  // 쪽 입장에서 로그인 여부와 무관하게 봐야 의미가 있다.

  // 헤더 공유 버튼. 그룹을 보고 있으면 그 그룹 링크를, 전체 후보면 기존 매물 스냅샷 링크를 만든다.
  const shareBusyRef = useRef(false);
  async function handleShare() {
    if (!user) {
      toast.show("로그인 후 이용할 수 있어요");
      return;
    }
    if (shownGroup) {
      await handleShareGroup(shownGroup);
      return;
    }
    if (dashboardItems.length === 0) {
      toast.show("공유할 관심 매물이 없어요. 먼저 매물을 추가해주세요.");
      return;
    }
    let token;
    try {
      ({ token } = await createDashboardShare());
    } catch {
      toast.show("공유 링크를 만들지 못했어요. 잠시 후 다시 시도해주세요.");
      return;
    }
    await copyShareLink(`?share=${token}`, "공유 링크를 복사했어요");
  }

  // 그룹 공유 링크(Phase 5). 받은 사람은 로그인 없이 이 그룹의 지금 후보를 본다.
  // 누를 때마다 새 링크를 만들고(토큰은 서버에 hash로만 남아 다시 보여줄 수 없다),
  // 그룹 메뉴의 공유 아이콘(공유 중지)으로 이 그룹 링크를 한꺼번에 끊는다.
  async function handleShareGroup(group) {
    if (group.itemIds.length === 0) {
      toast.show("그룹에 후보가 없어요. 후보를 넣은 뒤 공유해주세요.");
      return;
    }
    if (shareBusyRef.current) return;
    shareBusyRef.current = true;
    let token;
    try {
      ({ token } = await createGroupShareLink(group.id));
    } catch (err) {
      toast.show(err.message);
      return;
    } finally {
      shareBusyRef.current = false;
    }
    setGroups((gs) => gs.map((g) =>
      g.id === group.id ? { ...g, share_link_count: (g.share_link_count ?? 0) + 1 } : g));
    await copyShareLink(
      `?groupShare=${token}`,
      `"${group.name}" 그룹 링크를 복사했어요. 받은 사람은 이 그룹의 최신 후보를 볼 수 있어요`,
    );
  }

  async function copyShareLink(query, message) {
    const url = `${window.location.origin}${window.location.pathname}${query}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show(message);
    } catch {
      // 클립보드 접근이 막힌 환경(HTTP·권한 거부 등) - 링크 자체는 이미
      // 만들어졌으니 직접 복사할 수 있게 토스트에 그대로 보여준다.
      toast.show(`공유 링크: ${url}`);
    }
  }

  // 그룹 메뉴의 공유 아이콘 - 이 그룹으로 만든 링크를 모두 끊는다. 이미 보낸 링크로는 더 이상 볼 수 없다.
  async function handleStopGroupShare(groupId) {
    try {
      await revokeGroupShareLinks(groupId);
      setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, share_link_count: 0 } : g)));
      toast.show("공유를 중지했어요. 보낸 링크로는 더 이상 볼 수 없어요");
    } catch (err) {
      toast.show(err.message);
    }
  }

  // 공유받은 매물을 지금 내 목록 뒤에 이어 붙인다(교체 아님 - 남이 보낸
  // 링크를 열었다고 내가 만들어둔 목록이 사라지면 안 되므로). 남은 슬롯보다
  // 많으면 들어가는 만큼만 추가하고 나머지는 안내한다.
  async function handleImportShare() {
    if (sharePreviewItems.length === 0) return;
    const remaining = MAX_DASHBOARD_ITEMS - dashboardItems.length;
    if (remaining <= 0) {
      toast.show(`관심 매물은 최대 ${MAX_DASHBOARD_ITEMS}개까지 추가할 수 있어요`);
      handleImportCancel();
      return;
    }
    const toImport = sharePreviewItems.slice(0, remaining);

    if (user) {
      try {
        // 공유받은 매물을 하나씩 순서대로 기다리지 않고 한꺼번에 보낸다
        // (2026-09 로딩 속도 개선 - 항목이 여러 개면 순차 대기 시간이 그대로
        // 더해져서 느리게 느껴짐). toImport는 이미 남은 슬롯 수만큼만
        // 잘라뒀으므로 최대 개수(6개) 제한을 넘길 위험은 없다.
        await Promise.all(
          toImport.map((item) =>
            createDashboardItem({
              size_id: item.size_id,
              list_price: item.list_price,
              floor: item.floor,
              dong: item.dong,
              ho: item.ho,
              direction: item.direction,
              interior_state: item.interior_state,
            }),
          ),
        );
      } catch {
        toast.show("공유받은 매물을 추가하지 못했어요. 잠시 후 다시 시도해주세요.");
        handleImportCancel();
        return;
      }
      try {
        const res = await getDashboardItems();
        const items = res.items.map((raw, index) =>
          fromBackendItem(raw, `item-${index + 1}`),
        );
        setDashboardItemSeq(items.length);
        setDashboardItems(items);
        serverOrderRef.current = res.items.map((raw) => raw.id);
      } catch {
        toast.show("추가는 됐지만 목록을 새로 불러오지 못했어요. 새로고침 해주세요.");
      }
    } else {
      // 게스트: 서버에 저장하지 않고 로컬 상태에만 이어 붙인다(기존 게스트
      // 매물 추가와 동일한 동작).
      let nextSeq = dashboardItemSeq;
      const added = toImport.map((item) => {
        nextSeq += 1;
        return { ...fromBackendItem(item, "item-" + nextSeq), backendId: null };
      });
      setDashboardItemSeq(nextSeq);
      setDashboardItems((items) => [...items, ...added]);
    }

    // 추가한 후보가 그룹 보기에 가려지지 않게 전체 후보로 돌아간다.
    setActiveGroup(null);
    revealDashboard();
    const skipped = sharePreviewItems.length - toImport.length;
    toast.show(
      skipped > 0
        ? `${toImport.length}개를 추가했어요 (최대 ${MAX_DASHBOARD_ITEMS}개라 ${skipped}개는 제외됨)`
        : `${toImport.length}개의 매물을 추가했어요`,
    );
    handleImportCancel();
  }

  // 미리보기 닫기(닫기·추가 완료 공통). Esc 처리 effect에서도 부르므로 state setter만 쓴다.
  function handleImportCancel() {
    setImportModalOpen(false);
    setSharePreviewItems([]);
    setSharePreviewGroupName(null);
    // 토큰은 여기서(미리보기를 닫은 뒤) 지운다. 이유는 clearShareTokenFromUrl 주석 참고.
    clearShareTokenFromUrl();
  }

  // 체크박스(비교 차트·AI 분석에 포함할지) 토글. 로그인 상태면 서버에도 저장해
  // 새로고침·재로그인 후에도 유지한다. PATCH에는 { checked }만 담는다 - 편집창용
  // toDetailsPayload처럼 전체 필드를 보내면 호가·동·호 같은 다른 정보를 덮어쓴다.
  // 저장이 끝나기 전에 같은 카드를 또 누르면 이전 값을 기준으로 두 번 저장하게
  // 되므로, 저장 중인 카드의 추가 토글은 무시한다.
  const togglingIdsRef = useRef(new Set());
  async function handleToggle(id) {
    const item = dashboardItems.find((it) => it.id === id);
    if (!item || togglingIdsRef.current.has(id)) return;
    const nextChecked = !item.checked;
    if (user && item.backendId) {
      togglingIdsRef.current.add(id);
      try {
        await updateDashboardItemDetails(item.backendId, { checked: nextChecked });
      } catch {
        toast.show("체크 상태를 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      } finally {
        togglingIdsRef.current.delete(id);
      }
    }
    setDashboardItems((items) =>
      items.map((it) => (it.id === id ? { ...it, checked: nextChecked } : it)),
    );
  }
  async function handleRemove(id) {
    const item = dashboardItems.find((it) => it.id === id);
    // 그룹을 보고 있을 때는 후보를 지우지 않고 이 그룹에서만 뺀다.
    if (shownGroup && item?.backendId != null) {
      try {
        applyGroup(await removeGroupItem(shownGroup.id, item.backendId));
        toast.show("그룹에서 뺐어요. 전체 후보에는 그대로 있어요");
      } catch (err) {
        toast.show(err.message);
      }
      return;
    }
    if (user && item?.backendId) {
      try {
        await deleteDashboardItem(item.backendId);
      } catch {
        toast.show("관심 매물을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      serverOrderRef.current = serverOrderRef.current.filter((id) => id !== item.backendId);
    }
    // 후보를 지우면 임장 기록도 서버에서 함께 지워진다(외래키 CASCADE). 캐시도 비운다.
    const removedKey = checklistKey(item);
    if (removedKey) {
      setItemChecklists((prev) => {
        const next = { ...prev };
        delete next[removedKey];
        return next;
      });
    }
    setDashboardItems((items) => items.filter((it) => it.id !== id));
  }
  function handleReorder(nextItems) {
    // 그룹 보기에서는 보이는 후보끼리만 자리를 바꾸고, 그룹 밖 후보는 제자리에 둔다.
    let ordered = nextItems;
    if (shownGroup) {
      const shownIds = new Set(nextItems.map((it) => it.id));
      const queue = [...nextItems];
      ordered = dashboardItems.map((it) => (shownIds.has(it.id) ? queue.shift() : it));
    }
    const orderedIds = ordered.map((it) => it.id);
    setDashboardItems((current) => orderItemsBy(current, orderedIds, "id"));
    if (user && ordered.every((it) => it.backendId != null)) {
      saveOrder(ordered.map((it) => it.backendId));
    }
  }

  // 드래그로 바꾼 순서를 서버에 저장한다(Phase 3 보완). 화면은 이미 바뀐 순서를 보여주고,
  // 저장이 끝날 때까지 다음 드래그를 막아 요청을 한 줄로 세운다. 응답이 오기 전에 계정이
  // 바뀌었으면 결과를 무시한다.
  async function saveOrder(itemIds) {
    const expected = serverOrderRef.current;
    if (itemIds.join(",") === expected.join(",")) return;
    const userId = user.id;
    setOrderSaving(true);
    try {
      await reorderDashboardItems(itemIds, expected, userId);
      if (currentUserIdRef.current === userId) serverOrderRef.current = itemIds;
    } catch (err) {
      if (currentUserIdRef.current === userId) {
        await reloadOrderAfterSaveFailure(userId, expected, err.status === 409);
      }
    } finally {
      setOrderSaving(false);
    }
  }

  // 순서 저장이 거절(409: 다른 곳에서 목록이 바뀜)되거나 실패하면 서버 목록을 다시 불러온다.
  // 다시 불러오기도 실패하면 마지막으로 서버에서 확인한 순서로만 되돌린다 - 그사이 바뀐
  // 체크·메모 같은 최신 내용은 그대로 둔다. 같은 요청을 다시 보내지는 않는다.
  async function reloadOrderAfterSaveFailure(userId, fallbackOrder, conflicted) {
    try {
      const res = await getDashboardItems();
      if (currentUserIdRef.current !== userId) return;
      serverOrderRef.current = res.items.map((raw) => raw.id);
      setDashboardItems((current) => {
        const localIds = new Map(current.map((it) => [it.backendId, it.id]));
        return res.items.map((raw) => fromBackendItem(raw, localIds.get(raw.id) ?? `item-server-${raw.id}`));
      });
      toast.show(conflicted
        ? "다른 곳에서 목록이 바뀌어 최신 순서로 다시 불러왔어요."
        : "순서를 저장하지 못해 저장된 순서로 다시 불러왔어요.");
    } catch {
      if (currentUserIdRef.current !== userId) return;
      setDashboardItems((current) => orderItemsBy(current, fallbackOrder, "backendId"));
      toast.show("순서를 저장하지 못했어요. 이전 순서로 되돌렸어요.");
    }
  }
  // 저장해둔 체크리스트를 먼저 받아온 뒤에 팝업을 연다.
  //
  // 순서가 중요하다 - 팝업을 먼저 열면 EditListingDialog가 그 시점의 빈 값으로
  // 화면을 초기화해버리고, 뒤늦게 도착한 값은 반영되지 않는다(초기화는 팝업이
  // 열리는 순간 한 번만 한다). 한 번 받아온 후보는 다시 부르지 않으므로
  // 기다림은 후보당 처음 한 번뿐이고, 불러오기에 실패해도 팝업은 열어서
  // 빈 체크리스트로 작성할 수 있게 둔다.
  async function handleEdit(id) {
    const item = dashboardItems.find((it) => it.id === id);
    const key = checklistKey(item);
    if (user && item?.backendId && key && itemChecklists[key] === undefined) {
      try {
        const record = await getInspection(item.backendId);
        if (currentUserIdRef.current !== user.id) return;
        setItemChecklists((prev) => ({ ...prev, [key]: fromInspectionRecord(record) }));
      } catch {
        toast.show("저장한 체크리스트를 불러오지 못했어요.");
      }
    }
    setEditingItemId(id);
  }

  // 매물 정보와 체크리스트를 저장 버튼 하나로 함께 저장한다. 매물 정보가
  // 실패하면 체크리스트는 보내지 않고 팝업을 열어둔 채 끝낸다 - 입력값이
  // 남아 있어 그대로 다시 시도할 수 있다.
  async function handleEditSave(id, data, checklist, rating) {
    const item = dashboardItems.find((it) => it.id === id);
    const key = checklistKey(item);
    if (user && item?.backendId) {
      try {
        await updateDashboardItemDetails(
          item.backendId,
          toDetailsPayload(data),
        );
      } catch (err) {
        // 동·호수가 겹치면 서버가 무엇이 문제인지 알려준다 - 일반 문구로 덮지 않는다.
        toast.show(err.message || "변경사항을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
      // 종합 평점이 없으면 아직 아무 항목도 체크하지 않은 것이라 보낼 게 없다.
      if (rating != null) {
        try {
          const saved = await saveInspection(
            item.backendId,
            // 모바일 임장 페이지에서 쓴 메모가 있으면 지우지 않고 그대로 돌려보낸다.
            toInspectionPayload(checklist, rating, itemChecklists[key]?.memo ?? ""),
          );
          setItemChecklists((prev) => ({ ...prev, [key]: fromInspectionRecord(saved) }));
        } catch {
          toast.show("체크리스트를 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
          return;
        }
      } else if (itemChecklists[key]) {
        // 체크를 모두 비운 경우. 저장을 건너뛰기만 하면 서버에 남은 옛 기록이 그대로라,
        // 다시 열었을 때 지운 줄 알았던 점수가 되살아난다. 그래서 기록을 지운다.
        // (임장 메모도 그 기록에 함께 들어 있어 같이 지워진다.)
        try {
          await deleteInspection(item.backendId);
          setItemChecklists((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        } catch {
          toast.show("체크리스트를 지우지 못했어요. 잠시 후 다시 시도해주세요.");
          return;
        }
      }
    } else if (key) {
      // 게스트는 서버에 저장할 수 없어 이 세션 동안만 값을 들고 있는다.
      setItemChecklists((prev) => ({
        ...prev,
        [key]: { values: checklist, rating, memo: "" },
      }));
    }
    setDashboardItems((items) =>
      items.map((it) => (it.id === id ? { ...it, ...data } : it)),
    );
    setEditingItemId(null);
  }

  async function handleAddSubmit(itemData) {
    setModalOpen(false);
    if (dashboardItems.length >= MAX_DASHBOARD_ITEMS) {
      // 정상 UI 흐름에서는 도달할 수 없지만(추가 슬롯이 사라짐), 로고로
      // 히어로를 다시 불러와 CTA로 진입하는 경로는 cap을 별도로 막지 않으므로
      // 여기서 최종 방어.
      toast.show(
        `관심 매물은 최대 ${MAX_DASHBOARD_ITEMS}개까지 추가할 수 있어요`,
      );
      return;
    }

    // 카드에 똑같이 보일 후보가 이미 있으면 담기 전에 묻는다. 같은 단지·평형이어도
    // "101동 1203호"와 "12층"처럼 구분되면 묻지 않고 그냥 담는다 - 화면에서 구분되는
    // 기준과 물어보는 기준을 같은 함수(unitText)로 맞춰, 둘이 어긋나지 않게 한다.
    const twin = dashboardItems.find(
      (it) =>
        it.sizeId != null &&
        it.sizeId === itemData.sizeId &&
        unitText(it) === unitText(itemData),
    );
    if (twin) {
      setDuplicatePrompt({ item: itemData, twinId: twin.id });
      return;
    }

    await addCandidate(itemData);
  }

  // 실제로 담는 부분. 새 후보의 화면용 id를 돌려준다 - 중복 확인에서 "다른 집이에요"를
  // 고르면 담은 뒤 바로 그 후보의 수정 창을 열어야 하기 때문이다.
  async function addCandidate(itemData) {
    // 로그인 상태면 서버에도 저장한다 - 실패하면 로컬에도 추가하지 않는다
    // (화면엔 보이는데 서버엔 없는 상태가 되는 걸 막기 위해).
    let backendId = null;
    if (user) {
      try {
        const created = await createDashboardItem(
          toCreateItemPayload(itemData),
        );
        backendId = created.id;
        // 서버도 새 후보를 내 목록 맨 뒤에 둔다.
        serverOrderRef.current = [...serverOrderRef.current, created.id];
        setDashboardUserId(user.id);
      } catch (err) {
        toast.show(err.message || "관심 매물을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
        return null;
      }
    }

    const nextSeq = dashboardItemSeq + 1;
    const localId = "item-" + nextSeq;
    setDashboardItemSeq(nextSeq);
    setDashboardItems((items) => [
      ...items,
      {
        id: localId,
        backendId,
        name: itemData.name,
        sizeLabel: itemData.sizeLabel,
        price: itemData.price || "",
        floor: itemData.floor || "",
        dong: itemData.dong || "",
        ho: itemData.ho || "",
        direction: itemData.direction || null,
        interior: itemData.interior || null,
        regulations: itemData.regulations || [],
        // 차트가 실거래 데이터를 불러올 때 쓰는 백엔드 식별자 (InterestModal에서
        // 실 검색으로 추가한 경우에만 값이 있음).
        complexId: itemData.complexId ?? null,
        sizeId: itemData.sizeId ?? null,
        checked: true,
      },
    ]);
    revealDashboard();
    // 그룹을 보고 있을 때 등록한 후보는 그 그룹에도 넣는다. 후보 자체는 전체 후보에 한 번만 등록된다.
    if (shownGroup && backendId != null) {
      try {
        applyGroup(await addGroupItems(shownGroup.id, [backendId]));
      } catch (err) {
        toast.show(`전체 후보에는 추가했지만 그룹에는 넣지 못했어요. ${err.message}`);
        return localId;
      }
    }
    toast.show(`${itemData.name} ${itemData.sizeLabel} 매물이 추가되었습니다`);
    return localId;
  }

  // "이미 담은 집이에요" - 새로 담지 않고 그 후보의 수정 창을 연다.
  function handleDuplicateSame() {
    const twinId = duplicatePrompt?.twinId;
    setDuplicatePrompt(null);
    if (twinId) setEditingItemId(twinId);
  }

  // "다른 집이에요" - 담고 나서 바로 수정 창을 열어 동·호수나 층을 넣게 한다.
  // 거기서 아무것도 안 넣고 닫아도 담긴 채로 남는다(막지 않는다).
  async function handleDuplicateDifferent() {
    const pending = duplicatePrompt?.item;
    setDuplicatePrompt(null);
    if (!pending) return;
    const addedId = await addCandidate(pending);
    if (addedId) setEditingItemId(addedId);
  }

  return (
    <div id="app" data-component="App">
      <div id="main-screen" data-component="MainScreen" inert={mainScreenInert}>
        <Header
          onLogoClick={reopenHero}
          onLoginClick={() => setAuthModalOpen(true)}
          user={user}
          onLogoutClick={handleLogout}
          onProfileClick={() => setProfileEditorUserId(user.id)}
          profileReady={Boolean(profile)}
          activeContentTab={activeContentTab}
          onContentTabChange={setActiveContentTab}
          // 히어로가 화면을 덮고 있는 동안(heroCleared=false)은 전환할
          // 콘텐츠가 안 보이는 상태이므로 탭도 같이 숨기고, 히어로가
          // 걷혀 있을 때만(dashboardRevealed && heroCleared) 노출한다
          // (2026-09 피드백 - 로고 클릭으로 히어로를 다시 열어도 탭이
          // 계속 떠 있던 문제).
          showContentTabs={dashboardRevealed && heroCleared}
          groupMenu={{
            open: groupBarOpen,
            groups,
            activeGroup: shownGroup,
            selectedCount: selectedBackendIds.length,
            onToggle: handleGroupBarToggle,
            onSelect: handleSelectGroup,
            onCreate: handleCreateGroup,
            onAddTo: handleAddToGroup,
            onRename: handleRenameGroup,
            onDelete: handleDeleteGroup,
            onStopShare: handleStopGroupShare,
            onUpdateScoring: handleUpdateScoring,
            // 그룹이 기준을 정하지 않았을 때 쓸 내 기본 기준(과 이용 목적)을 넘긴다.
            profile,
          }}
          onShare={handleShare}
        />
        <Workspace
          items={visibleItems}
          totalCount={dashboardItems.length}
          insightItems={dashboardUserId === user?.id ? visibleItems : []}
          userId={user?.id}
          profile={profile}
          onToggle={handleToggle}
          onEdit={handleEdit}
          onRemove={handleRemove}
          onReorder={handleReorder}
          dragDisabled={orderSaving}
          onAdd={() => setModalOpen(true)}
          group={shownGroup}
          onAddToGroup={() => setGroupAddOpen(true)}
          onExitGroup={handleExitGroup}
          heroCleared={heroCleared}
          showHeroCloseBtn={dashboardRevealed}
          onHeroClose={closeHeroAgain}
          activeContentTab={activeContentTab}
        />
      </div>

      {profileError && (
        <div className="profile-load-error" role="alert">
          <span>프로필을 불러오지 못했어요. {profileError}</span>
          <button type="button" className="auth-text-link" onClick={retryProfile}>다시 시도</button>
        </div>
      )}
      {onboardingOpen && (
        <ProfileOnboardingModal key={user.id} profile={profile} onSave={saveProfile} />
      )}
      {profileEditorOpen && (
        <ProfileOnboardingModal
          key={`profile-${user.id}`}
          mode="edit"
          profile={profile}
          email={user.email}
          onSave={saveProfile}
          onClose={() => setProfileEditorUserId((current) => current === user.id ? null : current)}
        />
      )}
      <AuthModal
        open={authModalOpen && !onboardingOpen}
        onClose={() => setAuthModalOpen(false)}
        onSignupComplete={() => toast.show("회원가입이 완료되었습니다")}
      />
      <InterestModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleAddSubmit}
      />

      <EditListingDialog
        open={editingItemId != null}
        item={editingItem}
        initialChecklist={itemChecklists[checklistKey(editingItem)]?.values}
        guest={!user}
        group={shownGroup}
        profile={profile}
        onSave={handleEditSave}
        onSaveWeights={handleSaveWeights}
        onCancel={() => setEditingItemId(null)}
        onRequestLogin={() => setAuthModalOpen(true)}
      />
      <ImportShareModal
        open={importModalOpen}
        items={sharePreviewItems}
        groupName={sharePreviewGroupName}
        onImport={handleImportShare}
        onCancel={handleImportCancel}
      />
      <GroupAddDialog
        open={groupAddOpen}
        groupName={shownGroup?.name ?? ""}
        candidates={groupAddCandidates}
        canCreateNew={dashboardItems.length < MAX_DASHBOARD_ITEMS}
        onAdd={handleAddPickedToGroup}
        onCreateNew={handleCreateFromGroupAdd}
        onCancel={() => setGroupAddOpen(false)}
      />
      <DuplicateUnitDialog
        open={duplicatePrompt != null}
        name={duplicatePrompt?.item.name ?? ""}
        sizeLabel={duplicatePrompt?.item.sizeLabel ?? ""}
        unit={duplicatePrompt ? unitText(duplicatePrompt.item) : ""}
        onSame={handleDuplicateSame}
        onDifferent={handleDuplicateDifferent}
        onCancel={() => setDuplicatePrompt(null)}
      />

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}
