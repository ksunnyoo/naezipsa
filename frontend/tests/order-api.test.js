import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reorderDashboardItems } from "@/lib/api";

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

it("순서 저장은 전체 순서와 드래그 전 순서만 PATCH /dashboard/items/order로 보낸다", async () => {
  fetchMock.mockResolvedValue(jsonResponse(200, { item_ids: [13, 11, 12] }));

  await expect(reorderDashboardItems([13, 11, 12], [11, 12, 13], "a")).resolves.toEqual({ item_ids: [13, 11, 12] });

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/dashboard\/items\/order$/);
  expect(init.method).toBe("PATCH");
  expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer token-a" });
  expect(JSON.parse(init.body)).toEqual({ item_ids: [13, 11, 12], expected_item_ids: [11, 12, 13] });
});

it("거절되면 서버 안내 문구와 status를 담아 던지고, 로그인 계정이 바뀌었으면 요청하지 않는다", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: { code: "CONFLICT", message: "다른 곳에서 목록이 바뀌었습니다." } }));

  await expect(reorderDashboardItems([12, 11], [11, 12], "a")).rejects.toMatchObject({
    message: "다른 곳에서 목록이 바뀌었습니다.",
    status: 409,
  });

  await expect(reorderDashboardItems([12, 11], [11, 12], "b")).rejects.toThrow("로그인 상태가 변경되었습니다.");
  expect(fetchMock).toHaveBeenCalledOnce();
});
