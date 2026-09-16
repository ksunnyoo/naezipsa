import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfile, updateMyProfile, createDashboardInsight } from "@/lib/api";

vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: { getSession: vi.fn() } } }));
beforeEach(() => {
  vi.resetAllMocks();
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "a" }, access_token: "test-token" } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ service_purposes: [] }) }));
});
afterEach(() => vi.unstubAllGlobals());

it("기존 GET/PATCH 경로와 Supabase auth header를 사용하고 skip을 []로 보낸다", async () => {
  await getMyProfile("a");
  expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/\/api\/v1\/users\/me\/profile$/), { headers: { Authorization: "Bearer test-token" } });
  await updateMyProfile({ service_purposes: [] }, "a");
  expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/\/users\/me\/profile$/), {
    method: "PATCH", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: '{"service_purposes":[]}',
  });
});

it.each([null, { user: { id: "b" }, access_token: "other-test-token" }])("익명이나 변경된 계정으로 이전 화면에서 쓰지 않는다: %j", async (session) => {
  supabase.auth.getSession.mockResolvedValue({ data: { session } });
  await expect(updateMyProfile({ service_purposes: [] }, "a")).rejects.toThrow("로그인 상태가 변경");
  await expect(createDashboardInsight([1], "a")).rejects.toThrow("로그인 상태가 변경");
  expect(fetch).not.toHaveBeenCalled();
});

it("기존 AI endpoint에 선택 ID만 보내고 빈 선택은 호출하지 않는다", async () => {
  await expect(createDashboardInsight([], "a")).rejects.toThrow("선택");
  expect(fetch).not.toHaveBeenCalled();
  await createDashboardInsight([3, 7], "a");
  expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/\/dashboard\/insight$/), {
    method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: '{"item_ids":[3,7]}',
  });
});

it("기존 error.message를 표시하고 JSON이 아닌 실패 응답도 처리한다", async () => {
  fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "AI 분석이 설정되지 않았습니다." } }) });
  await expect(createDashboardInsight([1], "a")).rejects.toThrow("AI 분석이 설정되지 않았습니다.");
  fetch.mockResolvedValueOnce({ ok: false, json: async () => { throw new Error("not JSON"); } });
  await expect(updateMyProfile({ service_purposes: [] }, "a")).rejects.toThrow("프로필을 처리하지 못했어요");
});
