import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NaejipsaApp from "@/components/NaejipsaApp";
import {
  addGroupItems,
  createDashboardItem,
  createGroup,
  deleteDashboardItem,
  getDashboardItems,
  getGroup,
  getGroups,
  getMyProfile,
  removeGroupItem,
  renameGroup,
} from "@/lib/api";

// Phase 4: 그룹 동작은 모두 헤더의 그룹 메뉴에서 하고, 어떤 동작도 후보를 지우거나 다시 만들지 않는다.
// 헤더·그룹 메뉴·목록은 실제 컴포넌트로 그리고, 외부 데이터를 부르는 차트·인사이트·히어로와
// 이 파일과 무관한 모달만 대체한다. 서버 그룹 상태는 serverGroups로 흉내 낸다.
const auth = vi.hoisted(() => ({ callback: null, session: null }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: auth.session } }),
  onAuthStateChange: (callback) => { auth.callback = callback; return { data: { subscription: { unsubscribe: () => {} } } }; },
  signOut: async () => { auth.session = null; auth.callback("SIGNED_OUT", null); },
} } }));
vi.mock("@/lib/api", () => ({
  getMyProfile: vi.fn(), updateMyProfile: vi.fn(), getDashboardItems: vi.fn(),
  createDashboardItem: vi.fn(), updateDashboardItemDetails: vi.fn(), deleteDashboardItem: vi.fn(),
  getGroups: vi.fn(), getGroup: vi.fn(), createGroup: vi.fn(), renameGroup: vi.fn(), deleteGroup: vi.fn(),
  addGroupItems: vi.fn(), removeGroupItem: vi.fn(),
  createDashboardShare: vi.fn(), getDashboardShare: vi.fn(),
  createGroupShareLink: vi.fn(), revokeGroupShareLinks: vi.fn(), getSharedGroup: vi.fn(),
}));
vi.mock("@/components/Dashboard/DashboardCharts", () => ({ default: () => null }));
vi.mock("@/components/Insight/InsightPanel", () => ({ default: () => null }));
vi.mock("@/components/Hero/MainHeroOverlay", () => ({ default: () => null }));
vi.mock("@/components/Modal/InterestModal", () => ({ default: () => null }));
vi.mock("@/components/EditListingDialog", () => ({ default: () => null }));
vi.mock("@/components/Modal/AuthModal", () => ({ default: () => null }));
vi.mock("@/components/Modal/ImportShareModal", () => ({ default: () => null }));

const ALL = ["가단지", "나단지", "다단지"];
const BACKEND_ITEMS = [
  { id: 11, size_id: 200, complex_name: "가단지", representative_area: 84.95, checked: true },
  { id: 12, size_id: 201, complex_name: "나단지", representative_area: 59.9, checked: true },
  { id: 13, size_id: 202, complex_name: "다단지", representative_area: 114.2, checked: false },
];

let serverGroups;

function group(id, name, itemIds) {
  return { id, name, item_ids: itemIds, item_count: itemIds.length, items: [] };
}
function saveGroup(next) {
  serverGroups = serverGroups.some((g) => g.id === next.id)
    ? serverGroups.map((g) => (g.id === next.id ? next : g))
    : [...serverGroups, next];
  return next;
}

function cardNames() {
  return [...document.querySelectorAll(".interest-card-name")].map((node) => node.textContent);
}

function expectCandidatesUntouched() {
  expect(deleteDashboardItem).not.toHaveBeenCalled();
  expect(createDashboardItem).not.toHaveBeenCalled();
}

async function renderLoggedIn() {
  auth.session = { user: { id: "a" } };
  render(<NaejipsaApp />);
  await screen.findByText("가단지");
}

async function openGroupMenu() {
  if (!screen.queryByRole("button", { name: /^새 그룹 만들기/ })) {
    fireEvent.click(screen.getByRole("button", { name: "그룹" }));
  }
  await screen.findByRole("button", { name: /^새 그룹 만들기/ });
  await waitFor(() => expect(getGroups).toHaveBeenCalled());
}

async function viewSchoolGroup() {
  await openGroupMenu();
  fireEvent.click(await screen.findByRole("button", { name: "학군 후보 (후보 1개)" }));
  await waitFor(() => expect(cardNames()).toEqual(["나단지"]));
}

// 보고 있는 그룹을 한 번 더 누르면 전체 후보로 돌아간다.
async function backToAllCandidates() {
  await openGroupMenu();
  fireEvent.click(screen.getByRole("button", { pressed: true, name: /\(후보 \d+개\)$/ }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  auth.session = null;
  serverGroups = [group(7, "학군 후보", [12])];
  getMyProfile.mockResolvedValue({ service_purposes: [] });
  getDashboardItems.mockResolvedValue({ items: BACKEND_ITEMS });
  getGroups.mockImplementation(async () => ({ groups: serverGroups, count: serverGroups.length, max_count: 8 }));
  getGroup.mockImplementation(async (id) => serverGroups.find((g) => g.id === id));
  createGroup.mockImplementation(async (name, itemIds) =>
    saveGroup(group(Math.max(...serverGroups.map((g) => g.id)) + 1, name, itemIds)));
  renameGroup.mockImplementation(async (id, name) => {
    const current = serverGroups.find((g) => g.id === id);
    return saveGroup(group(id, name, current.item_ids));
  });
  addGroupItems.mockImplementation(async (id, itemIds) => {
    const current = serverGroups.find((g) => g.id === id);
    return saveGroup(group(id, current.name, [...current.item_ids, ...itemIds]));
  });
  removeGroupItem.mockImplementation(async (id, itemId) => {
    const current = serverGroups.find((g) => g.id === id);
    return saveGroup(group(id, current.name, current.item_ids.filter((x) => x !== itemId)));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("그룹 동작은 헤더 그룹 메뉴에만 있고, 메뉴에는 그룹 줄과 새 그룹 만들기만 있다", async () => {
  await renderLoggedIn();

  expect(screen.queryByRole("button", { name: /새 그룹 만들기/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /기존 그룹에 추가/ })).toBeNull();

  await openGroupMenu();
  expect(screen.getByRole("button", { name: "학군 후보 (후보 1개)" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "새 그룹 만들기 (체크한 후보 2개)" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^전체 후보/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /이 그룹으로 새 그룹 만들기/ })).toBeNull();
});

it("그룹을 누르면 목록만 좁히고 그 줄이 활성으로 표시되며, 한 번 더 누르면 전체 후보로 돌아간다", async () => {
  await renderLoggedIn();

  await viewSchoolGroup();

  const row = screen.getByRole("button", { name: "학군 후보 (후보 1개)" });
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect(row.closest(".group-row").classList.contains("is-active")).toBe(true);
  // 헤더 버튼에는 그룹 이름을 따로 붙이지 않는다.
  expect(screen.getByRole("button", { name: "그룹" }).textContent).toBe("");

  await backToAllCandidates();
  expect(cardNames()).toEqual(ALL);
  expect(screen.getByRole("button", { name: "학군 후보 (후보 1개)" }).getAttribute("aria-pressed")).toBe("false");
  expectCandidatesUntouched();
});

it("새 그룹 만들기는 이름을 묻지 않고 바로 만들고, 새 줄에서 이름을 바로 입력한다", async () => {
  await renderLoggedIn();

  await openGroupMenu();
  fireEvent.click(screen.getByRole("button", { name: "새 그룹 만들기 (체크한 후보 2개)" }));

  await waitFor(() => expect(createGroup).toHaveBeenCalledExactlyOnceWith("새 그룹", [11, 12]));
  expect(screen.queryByRole("dialog")).toBeNull();
  const input = await screen.findByRole("textbox", { name: '"새 그룹" 그룹 이름' });
  expect(input.value).toBe("새 그룹");
  // 만든 그룹으로 화면을 옮기지 않는다.
  expect(cardNames()).toEqual(ALL);

  fireEvent.change(input, { target: { value: "이사 후보" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await screen.findByRole("button", { name: "이사 후보 (후보 2개)" });
  expect(renameGroup).toHaveBeenCalledExactlyOnceWith(8, "이사 후보");
  expectCandidatesUntouched();
});

it("그룹을 보는 중에 만들면 그 그룹의 체크한 후보로 만들고, 이름이 겹치면 번호를 붙이며, Esc면 기본 이름을 유지한다", async () => {
  serverGroups = [...serverGroups, group(8, "새 그룹", [11])];
  await renderLoggedIn();
  await viewSchoolGroup();

  fireEvent.click(screen.getByRole("button", { name: "새 그룹 만들기 (체크한 후보 1개)" }));

  await waitFor(() => expect(createGroup).toHaveBeenCalledExactlyOnceWith("새 그룹 2", [12]));
  const input = await screen.findByRole("textbox", { name: '"새 그룹 2" 그룹 이름' });
  fireEvent.keyDown(input, { key: "Escape" });

  expect(screen.getByRole("button", { name: "새 그룹 2 (후보 1개)" })).toBeTruthy();
  expect(renameGroup).not.toHaveBeenCalled();
  expect(serverGroups.find((g) => g.id === 7).item_ids).toEqual([12]);
  expect(cardNames()).toEqual(["나단지"]);
  expectCandidatesUntouched();
});

it("연필을 누르면 모달 없이 그 자리에서 이름을 고치고, Enter로 저장·Esc로 취소한다", async () => {
  await renderLoggedIn();
  await openGroupMenu();

  fireEvent.click(screen.getByRole("button", { name: '"학군 후보" 그룹 이름 수정' }));
  const input = screen.getByRole("textbox", { name: '"학군 후보" 그룹 이름' });
  expect(input.value).toBe("학군 후보");
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.change(input, { target: { value: "  학군 1순위 " } });
  fireEvent.keyDown(input, { key: "Enter" });

  await screen.findByRole("button", { name: "학군 1순위 (후보 1개)" });
  expect(renameGroup).toHaveBeenCalledExactlyOnceWith(7, "학군 1순위");

  fireEvent.click(screen.getByRole("button", { name: '"학군 1순위" 그룹 이름 수정' }));
  const again = screen.getByRole("textbox", { name: '"학군 1순위" 그룹 이름' });
  fireEvent.change(again, { target: { value: "취소할 이름" } });
  fireEvent.keyDown(again, { key: "Escape" });

  expect(screen.queryByRole("textbox", { name: '"학군 1순위" 그룹 이름' })).toBeNull();
  expect(screen.getByRole("button", { name: "학군 1순위 (후보 1개)" })).toBeTruthy();
  // Esc는 이름 편집만 취소하고 그룹 메뉴는 닫지 않는다.
  expect(screen.getByRole("button", { name: /^새 그룹 만들기/ })).toBeTruthy();
  expect(renameGroup).toHaveBeenCalledOnce();
});

it("메뉴의 추가는 체크한 후보 중 그 그룹에 아직 없는 후보만 넣고, 후보 수가 바로 갱신된다", async () => {
  await renderLoggedIn();

  await openGroupMenu();
  fireEvent.click(screen.getByRole("button", { name: '체크한 후보 2개를 "학군 후보" 그룹에 추가' }));

  await waitFor(() => expect(addGroupItems).toHaveBeenCalledWith(7, [11]));
  await screen.findByRole("button", { name: "학군 후보 (후보 2개)" });
  expect(cardNames()).toEqual(ALL);
  expectCandidatesUntouched();
});

it("체크한 후보가 없으면 추가를 누를 수 없고, 새 그룹은 빈 그룹으로 안내한다", async () => {
  getDashboardItems.mockResolvedValue({ items: BACKEND_ITEMS.map((item) => ({ ...item, checked: false })) });
  await renderLoggedIn();

  await openGroupMenu();

  expect(screen.getByRole("button", { name: '체크한 후보 0개를 "학군 후보" 그룹에 추가' }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "새 그룹 만들기 (빈 그룹)" })).toBeTruthy();
});

it("그룹을 보는 중에 카드를 빼면 그룹에서만 빠지고 후보는 전체 후보에 남는다", async () => {
  await renderLoggedIn();
  await viewSchoolGroup();

  fireEvent.click(screen.getByRole("button", { name: "목록에서 제거" }));

  await waitFor(() => expect(cardNames()).toEqual([]));
  expect(removeGroupItem).toHaveBeenCalledWith(7, 12);
  await backToAllCandidates();
  expect(cardNames()).toEqual(ALL);
  expectCandidatesUntouched();
});

// ── 그룹 화면과 전체 후보 화면 사이를 오가는 길 (2026-09-17) ──────────────────
// 전에는 "지금 그룹을 보고 있다"는 표시가 그룹 메뉴 안에만 있어서, 메뉴를 닫으면
// 목록이 줄어든 것만 보이고 이유를 알 수 없었다. 나가려면 메뉴를 다시 열어
// 같은 그룹을 한 번 더 눌러야 했고, 새로고침하면 그냥 풀렸다.

const exitChip = () =>
  screen.queryByRole("button", { name: '"학군 후보" 그룹에서 나가 전체 후보 보기' });

it("그룹을 보는 중에는 목록 맨 위 칩으로 알려주고, ✕로 전체 후보에 돌아온다", async () => {
  await renderLoggedIn();
  expect(exitChip()).toBeNull(); // 전체 후보 화면에는 칩이 없다

  await viewSchoolGroup();
  // 메뉴를 닫아도 어느 그룹을 보고 있는지 계속 보인다.
  fireEvent.keyDown(document, { key: "Escape" });
  expect(exitChip()).toBeTruthy();
  expect(document.querySelector(".group-chip-name").textContent).toBe("학군 후보");
  expect(document.querySelector(".group-chip-count").textContent).toBe("1개");

  fireEvent.click(exitChip());
  await waitFor(() => expect(cardNames()).toEqual(ALL));
  expect(exitChip()).toBeNull();
  expectCandidatesUntouched();
});

it("Esc로도 전체 후보로 돌아온다 - 단, 열려 있는 창이 먼저다", async () => {
  await renderLoggedIn();
  await viewSchoolGroup();

  // 그룹 메뉴가 열려 있으면 Esc는 메뉴부터 닫는다(그룹은 그대로).
  fireEvent.keyDown(document, { key: "Escape" });
  expect(cardNames()).toEqual(["나단지"]);

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(cardNames()).toEqual(ALL));
});

it("보던 그룹이 주소에 남아 새로고침해도 유지된다", async () => {
  await renderLoggedIn();
  await viewSchoolGroup();
  expect(new URL(window.location.href).searchParams.get("group")).toBe("7");

  // 새로고침 = 같은 주소에서 처음부터 다시 그리기.
  cleanup();
  render(<NaejipsaApp />);
  await waitFor(() => expect(cardNames()).toEqual(["나단지"]));
  expect(exitChip()).toBeTruthy();
});

it("주소의 그룹이 지워졌으면 조용히 전체 후보로 두고 주소도 지운다", async () => {
  window.history.replaceState({}, "", "/?group=999");
  await renderLoggedIn();

  await waitFor(() =>
    expect(new URL(window.location.href).searchParams.has("group")).toBe(false),
  );
  expect(cardNames()).toEqual(ALL);
});

it("그룹 화면에서 이미 담아둔 후보를 그 그룹에 넣을 수 있다", async () => {
  await renderLoggedIn();
  await viewSchoolGroup();
  fireEvent.keyDown(document, { key: "Escape" }); // 그룹 메뉴 닫기

  // 전체 후보 화면의 "매물 추가하기"가 그룹 화면에서는 "이 그룹에 넣기"가 된다.
  expect(screen.queryByRole("button", { name: /매물 추가하기/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /이 그룹에 넣기/ }));

  // 이미 그룹에 든 나단지는 고를 수 없고, 나머지만 나온다.
  const picker = screen.getByRole("dialog", { name: "이 그룹에 넣기" });
  expect([...picker.querySelectorAll(".group-add-name")].map((n) => n.textContent))
    .toEqual(["가단지", "다단지"]);

  fireEvent.click(screen.getByLabelText(/가단지/));
  fireEvent.click(screen.getByRole("button", { name: "1개 담기" }));

  await waitFor(() => expect(addGroupItems).toHaveBeenCalledWith(7, [11]));
  await waitFor(() => expect(cardNames()).toEqual(["가단지", "나단지"]));
  expectCandidatesUntouched();
});

it("후보를 6개 다 채우면 추가 칸을 숨기지 않고 이유를 보여준다", async () => {
  // 전에는 말없이 사라져서, 그룹에 3개만 보이는 화면에서 고장으로 보였다.
  getDashboardItems.mockResolvedValue({
    items: Array.from({ length: 6 }, (_, i) => ({
      id: 21 + i, size_id: 300 + i, complex_name: `단지${i}`,
      representative_area: 84.9, checked: true,
    })),
  });
  auth.session = { user: { id: "a" } };
  render(<NaejipsaApp />);
  await screen.findByText("단지0");

  const slot = screen.getByRole("button", { name: /후보는 6개까지예요/ });
  expect(slot.disabled).toBe(true);
  expect(screen.queryByRole("button", { name: /매물 추가하기/ })).toBeNull();
});
