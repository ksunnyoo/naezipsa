import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NaejipsaApp from "@/components/NaejipsaApp";
import {
  createDashboardItem,
  createDashboardShare,
  createGroupShareLink,
  getDashboardItems,
  getDashboardShare,
  getGroup,
  getGroups,
  getMyProfile,
  getSharedGroup,
  revokeGroupShareLinks,
} from "@/lib/api";

// Phase 5: 그룹을 보고 있을 때 공유하면 그룹 링크(?groupShare=), 전체 후보면 기존 매물 스냅샷(?share=).
// 그룹 링크는 로그인 없이 열리고, 열기만 해서는 아무것도 저장하지 않는다. 헤더·그룹 메뉴·미리보기
// 모달은 실제 컴포넌트로 그리고, 외부 데이터를 부르는 차트·인사이트·히어로와 무관한 모달만 대체한다.
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

const BACKEND_ITEMS = [
  { id: 11, size_id: 200, complex_name: "가단지", representative_area: 84.95, checked: true },
  { id: 12, size_id: 201, complex_name: "나단지", representative_area: 59.9, checked: true },
];
const SHARED_ITEM = {
  size_id: 300, complex_name: "라단지", representative_area: 84.9,
  dong: "101", ho: "1203", list_price: 1320000000, floor: 12,
};

let serverGroups;
let clipboard;

function group(id, name, itemIds, shareLinkCount = 0) {
  return { id, name, item_ids: itemIds, item_count: itemIds.length, share_link_count: shareLinkCount, items: [] };
}

function cardNames() {
  return [...document.querySelectorAll(".interest-card-name")].map((node) => node.textContent);
}

async function renderLoggedIn() {
  auth.session = { user: { id: "a" } };
  render(<NaejipsaApp />);
  await waitFor(() => expect(cardNames()).toEqual(["가단지", "나단지"]));
}

async function openGroupMenu() {
  if (!screen.queryByRole("button", { name: /^새 그룹 만들기/ })) {
    fireEvent.click(screen.getByRole("button", { name: "그룹" }));
  }
  await screen.findByRole("button", { name: /^새 그룹 만들기/ });
}

async function viewGroup(label, expectedCards) {
  await openGroupMenu();
  fireEvent.click(await screen.findByRole("button", { name: label }));
  await waitFor(() => expect(cardNames()).toEqual(expectedCards));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  clipboard = { writeText: vi.fn(async () => {}) };
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  window.history.replaceState({}, "", "/");
  auth.session = null;
  serverGroups = [group(7, "학군 후보", [12])];
  getMyProfile.mockResolvedValue({ service_purposes: [] });
  getDashboardItems.mockResolvedValue({ items: BACKEND_ITEMS });
  getGroups.mockImplementation(async () => ({ groups: serverGroups, count: serverGroups.length, max_count: 8 }));
  getGroup.mockImplementation(async (id) => serverGroups.find((g) => g.id === id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("그룹을 보는 중에 공유하면 그 그룹 링크를 만들어 ?groupShare= 주소를 복사하고, 메뉴에 공유 중지가 생긴다", async () => {
  createGroupShareLink.mockResolvedValue({ id: 1, token: "group-token", created_at: "2026-09-16T00:00:00Z" });
  await renderLoggedIn();
  await viewGroup("학군 후보 (후보 1개)", ["나단지"]);
  expect(screen.queryByRole("button", { name: '"학군 후보" 그룹 공유 중지' })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "공유하기" }));

  await waitFor(() =>
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/?groupShare=group-token`));
  expect(createGroupShareLink).toHaveBeenCalledExactlyOnceWith(7);
  expect(createDashboardShare).not.toHaveBeenCalled();
  expect(await screen.findByText(/"학군 후보" 그룹 링크를 복사했어요/)).toBeTruthy();
  expect(screen.getByRole("button", { name: '"학군 후보" 그룹 공유 중지' })).toBeTruthy();
});

it("전체 후보에서 공유하면 기존처럼 매물 스냅샷 링크를 만든다", async () => {
  createDashboardShare.mockResolvedValue({ token: "snapshot-token" });
  await renderLoggedIn();

  fireEvent.click(screen.getByRole("button", { name: "공유하기" }));

  await waitFor(() =>
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(`${window.location.origin}/?share=snapshot-token`));
  expect(createGroupShareLink).not.toHaveBeenCalled();
});

it("후보가 없는 그룹은 링크를 만들지 않고 안내한다", async () => {
  serverGroups = [group(7, "빈 그룹", [])];
  await renderLoggedIn();
  await viewGroup("빈 그룹 (후보 0개)", []);

  fireEvent.click(screen.getByRole("button", { name: "공유하기" }));

  expect(await screen.findByText("그룹에 후보가 없어요. 후보를 넣은 뒤 공유해주세요.")).toBeTruthy();
  expect(createGroupShareLink).not.toHaveBeenCalled();
  expect(createDashboardShare).not.toHaveBeenCalled();
});

it("공유 중인 그룹의 공유 아이콘을 누르면 그 그룹 링크를 모두 끊고 아이콘이 사라진다", async () => {
  serverGroups = [group(7, "학군 후보", [12], 2), group(8, "공유 안 한 그룹", [11])];
  revokeGroupShareLinks.mockResolvedValue({ revoked_count: 2 });
  await renderLoggedIn();
  await openGroupMenu();
  expect(screen.queryByRole("button", { name: '"공유 안 한 그룹" 그룹 공유 중지' })).toBeNull();

  fireEvent.click(await screen.findByRole("button", { name: '"학군 후보" 그룹 공유 중지' }));

  await waitFor(() => expect(screen.queryByRole("button", { name: '"학군 후보" 그룹 공유 중지' })).toBeNull());
  expect(revokeGroupShareLinks).toHaveBeenCalledExactlyOnceWith(7);
  expect(await screen.findByText("공유를 중지했어요. 보낸 링크로는 더 이상 볼 수 없어요")).toBeTruthy();
});

it("그룹 링크를 열면 로그인 없이 그룹 이름과 동·호수 미리보기가 뜨고, 주소에서 토큰을 지운다", async () => {
  window.history.replaceState({}, "", "/?groupShare=abc");
  getSharedGroup.mockResolvedValue({ name: "학군 후보", count: 1, items: [SHARED_ITEM] });

  render(<NaejipsaApp />);

  const dialog = await screen.findByRole("dialog", { name: "공유받은 그룹" });
  await waitFor(() => expect(dialog.textContent).toContain('"학군 후보" 그룹의 매물 1개를 받았어요'));
  expect(dialog.textContent).toContain("101동 1203호 · 84.9㎡");
  expect(getSharedGroup).toHaveBeenCalledWith("abc");
  expect(getDashboardShare).not.toHaveBeenCalled();
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(createDashboardItem).not.toHaveBeenCalled();
});

it("없거나 공유가 중지된 그룹 링크면 안내만 하고 미리보기를 띄우지 않는다", async () => {
  window.history.replaceState({}, "", "/?groupShare=gone");
  getSharedGroup.mockRejectedValue(Object.assign(new Error("get shared group failed with status 404"), { status: 404 }));

  render(<NaejipsaApp />);

  expect(await screen.findByText("존재하지 않거나 공유가 중지된 그룹 링크예요.")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "공유받은 그룹" })).toBeNull();
  await waitFor(() => expect(window.location.search).toBe(""));
});

it("그룹 링크 미리보기에서 내 목록에 추가하면 동·호수까지 내 후보로 복사한다", async () => {
  window.history.replaceState({}, "", "/?groupShare=abc");
  getSharedGroup.mockResolvedValue({ name: "학군 후보", count: 1, items: [SHARED_ITEM] });
  createDashboardItem.mockResolvedValue({ id: 21 });
  await renderLoggedIn();
  const dialog = await screen.findByRole("dialog", { name: "공유받은 그룹" });
  await waitFor(() => expect(dialog.textContent).toContain("라단지"));
  getDashboardItems.mockResolvedValue({ items: [
    ...BACKEND_ITEMS,
    { id: 21, size_id: 300, complex_name: "라단지", representative_area: 84.9, dong: "101", ho: "1203", checked: true },
  ] });

  fireEvent.click(within(dialog).getByRole("button", { name: "내 목록에 추가" }));

  await waitFor(() => expect(cardNames()).toEqual(["가단지", "나단지", "라단지"]));
  expect(createDashboardItem).toHaveBeenCalledExactlyOnceWith({
    size_id: 300, list_price: 1320000000, floor: 12, dong: "101", ho: "1203",
    direction: undefined, interior_state: undefined,
  });
  expect(screen.queryByRole("dialog", { name: "공유받은 그룹" })).toBeNull();
});
