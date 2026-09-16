import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  addGroupItems,
  createGroup,
  createGroupShareLink,
  deleteGroup,
  getSharedGroup,
  removeGroupItem,
  revokeGroupShareLinks,
} from "@/lib/api";

vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: { access_token: "token-a", user: { id: "a" } } } }),
} } }));

function jsonResponse(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("그룹 만들기는 이름과 후보 id를 /groups에 로그인 토큰과 함께 보낸다", async () => {
  fetchMock.mockResolvedValue(jsonResponse(201, { id: 8, item_ids: [11, 12] }));

  await expect(createGroup("이사 후보", [11, 12])).resolves.toEqual({ id: 8, item_ids: [11, 12] });

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/groups$/);
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ Authorization: "Bearer token-a", "Content-Type": "application/json" });
  expect(JSON.parse(init.body)).toEqual({ name: "이사 후보", item_ids: [11, 12] });
});

it("그룹에서 빼기·그룹 삭제는 관계 경로만 호출하고 후보 삭제 경로를 쓰지 않는다", async () => {
  fetchMock.mockResolvedValue(jsonResponse(200, {}));

  await removeGroupItem(7, 12);
  await deleteGroup(7);

  expect(fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*\/api\/v1/, ""), init.method])).toEqual([
    ["/groups/7/items/12", "DELETE"],
    ["/groups/7", "DELETE"],
  ]);
  expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
});

it("서버의 한국어 안내를 그대로 던지고, 네트워크 실패는 기본 안내로 바꾼다", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: { code: "CONFLICT", message: "이미 이 그룹에 있는 후보가 포함되어 있습니다." } }));
  await expect(addGroupItems(7, [12])).rejects.toThrow("이미 이 그룹에 있는 후보가 포함되어 있습니다.");

  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(addGroupItems(7, [12])).rejects.toThrow("그룹을 처리하지 못했어요. 잠시 후 다시 시도해주세요.");
});

it("그룹 공유 링크 만들기·공유 중지는 로그인 토큰과 함께 그룹 경로를 호출한다", async () => {
  fetchMock.mockResolvedValue(jsonResponse(201, { id: 1, token: "group-token", created_at: "2026-09-16T00:00:00Z" }));

  await expect(createGroupShareLink(7)).resolves.toMatchObject({ token: "group-token" });
  await revokeGroupShareLinks(7);

  expect(fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*\/api\/v1/, ""), init.method, init.headers])).toEqual([
    ["/groups/7/share-links", "POST", { Authorization: "Bearer token-a" }],
    ["/groups/7/share-links", "DELETE", { Authorization: "Bearer token-a" }],
  ]);
});

it("그룹 공유 링크 열람은 로그인 토큰 없이 캐시를 쓰지 않고 부르고, 실패하면 status를 싣는다", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { name: "학군 후보", items: [], count: 0 }));

  await expect(getSharedGroup("a/b c")).resolves.toEqual({ name: "학군 후보", items: [], count: 0 });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url.replace(/^.*\/api\/v1/, "")).toBe("/shared/groups/a%2Fb%20c");
  expect(init).toEqual({ cache: "no-store" });

  fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: { code: "NOT_FOUND" } }));
  await expect(getSharedGroup("gone")).rejects.toMatchObject({ status: 404 });
});
