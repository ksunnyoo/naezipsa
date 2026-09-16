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
import Toast from "./Toast";
import useToast from "@/hooks/useToast";
import { MAX_DASHBOARD_GROUPS, MAX_DASHBOARD_ITEMS } from "@/lib/data";
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
} from "@/lib/api";
import {
  toCreateItemPayload,
  toDetailsPayload,
  fromBackendItem,
} from "@/lib/dashboardItems";

// 새 그룹 기본 이름: "새 그룹", 이미 있으면 "새 그룹 2", "새 그룹 3" ...
// 이름을 먼저 묻지 않고 만든 뒤 그룹 메뉴에서 바로 고친다.
function nextGroupName(groups) {
  const names = new Set(groups.map((group) => group.name));
  if (!names.has("새 그룹")) return "새 그룹";
  let n = 2;
  while (names.has(`새 그룹 ${n}`)) n += 1;
  return `새 그룹 ${n}`;
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
  // itemChecklists: 매물 수정 팝업의 체크리스트 작성 결과를 매물 id별로
  // 들고 있는 임시 캐시. 백엔드 저장 API가 아직 없어서 새로고침하면
  // 사라지지만, 팝업을 닫았다 같은 매물로 다시 열어도(저장을 눌렀다면)
  // 값이 유지되도록 EditListingDialog가 아니라 여기(NaejipsaApp)에서
  // 들고 있는다 - EditListingDialog는 열릴 때마다 언마운트되지 않지만
  // showChecklist/checklist state를 매번 초기화하므로, 그 초기화 값의
  // 출처를 여기 캐시로 바꿔주는 구조.
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

  // 공유 - URL의 ?share=<token>(매물 스냅샷)이나 ?groupShare=<token>(그룹 링크)을 열었을 때 보여줄
  // 미리보기 상태. sharePreviewGroupName은 그룹 링크일 때만 그룹 이름이 들어간다.
  const [sharePreviewItems, setSharePreviewItems] = useState([]);
  const [sharePreviewGroupName, setSharePreviewGroupName] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

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
      })
      .finally(() => {
        // 새로고침해도 다시 뜨지 않도록 쿼리스트링에서 지운다.
        const url = new URL(window.location.href);
        url.searchParams.delete("share");
        url.searchParams.delete("groupShare");
        window.history.replaceState({}, "", url);
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
    importModalOpen;

  // 그룹을 보고 있으면 그 그룹에 든 후보만 보여준다(순서는 전체 후보에서 정한 순서).
  // 후보 자체는 dashboardItems에 그대로 있다.
  const shownGroup = activeGroup && activeGroup.userId === user?.id ? activeGroup : null;
  const visibleItems = shownGroup
    ? dashboardItems.filter(
        (it) => it.backendId != null && shownGroup.itemIds.includes(it.backendId),
      )
    : dashboardItems;
  // 그룹 만들기·기존 그룹에 추가의 "선택"은 카드 체크 상태를 그대로 쓴다(서버에 저장된 후보만).
  const selectedBackendIds = visibleItems
    .filter((it) => it.checked && it.backendId != null)
    .map((it) => it.backendId);

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
      if (modalOpen) setModalOpen(false);
      if (authModalOpen) setAuthModalOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editingItemId, modalOpen, authModalOpen, groupBarOpen, importModalOpen]);

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
    setActiveGroup({ id: group.id, name: group.name, itemIds: group.item_ids, userId: user.id });
  }

  // 서버가 돌려준 그룹 상세로 GroupBar 목록과 보고 있는 그룹을 함께 갱신한다.
  function applyGroup(group) {
    setGroups((gs) => gs.map((g) => (g.id === group.id ? group : g)));
    setActiveGroup((current) =>
      current?.id === group.id ? { ...current, name: group.name, itemIds: group.item_ids } : current,
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
  function handleEdit(id) {
    setEditingItemId(id);
  }
  async function handleEditSave(id, data) {
    const item = dashboardItems.find((it) => it.id === id);
    if (user && item?.backendId) {
      try {
        await updateDashboardItemDetails(
          item.backendId,
          toDetailsPayload(data),
        );
      } catch {
        toast.show("변경사항을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
    }
    setDashboardItems((items) =>
      items.map((it) => (it.id === id ? { ...it, ...data } : it)),
    );
    setEditingItemId(null);
  }
  // 체크리스트는 아직 백엔드에 저장하지 않는다(진수 확인: 일단 임시
  // 유지만) - 저장 버튼을 눌렀을 때만 이 세션 동안의 캐시에 반영해서,
  // 같은 매물을 다시 열었을 때 이어서 볼 수 있게만 해준다. 취소를
  // 누르면(이 함수가 호출되지 않으면) 작성 중이던 내용은 버려진다.
  function handleChecklistSave(id, checklist) {
    setItemChecklists((prev) => ({ ...prev, [id]: checklist }));
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
      } catch {
        toast.show("관심 매물을 저장하지 못했어요. 잠시 후 다시 시도해주세요.");
        return;
      }
    }

    const nextSeq = dashboardItemSeq + 1;
    setDashboardItemSeq(nextSeq);
    setDashboardItems((items) => [
      ...items,
      {
        id: "item-" + nextSeq,
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
        return;
      }
    }
    toast.show(`${itemData.name} ${itemData.sizeLabel} 매물이 추가되었습니다`);
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
        initialChecklist={
          editingItemId != null ? itemChecklists[editingItemId] : undefined
        }
        onSave={handleEditSave}
        onChecklistSave={handleChecklistSave}
        onCancel={() => setEditingItemId(null)}
      />
      <ImportShareModal
        open={importModalOpen}
        items={sharePreviewItems}
        groupName={sharePreviewGroupName}
        onImport={handleImportShare}
        onCancel={handleImportCancel}
      />

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}
