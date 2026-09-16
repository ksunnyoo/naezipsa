import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InsightPanel from "@/components/Insight/InsightPanel";
import { createDashboardInsight } from "@/lib/api";

// Phase 2 AI 분석 회귀 검사. 화면 문구·배치는 PR #15(진수님)의 인사이트 카드 UI를 따른다.
vi.mock("@/lib/api", () => ({ createDashboardInsight: vi.fn() }));
vi.mock("@/components/Insight/NewsCard", () => ({
  default: () => <div>뉴스 카드</div>,
}));
vi.mock("@/components/Insight/SubscriptionInfoCard", () => ({
  default: () => <div>청약 카드</div>,
}));

const ANALYZE = "AI 분석 시작하기";
const ITEMS = [
  { id: "local-a", backendId: 11, checked: true, name: "첫 번째 단지", sizeLabel: "84㎡", price: 5 },
  { id: "local-b", backendId: 13, checked: true, name: "두 번째 단지", sizeLabel: "59㎡", price: 4 },
  { id: "local-c", backendId: 14, checked: false, name: "선택하지 않은 단지" },
  { id: "local-only", backendId: null, checked: true, name: "저장하지 않은 단지" },
];
const BASE_PROPS = { items: ITEMS, userId: "user-a", profile: null };

function response(summary = "두 후보의 비교 요약") {
  return {
    summary,
    items: [
      { id: 11, strengths: ["첫 후보의 강점"], weaknesses: ["첫 후보의 약점"] },
      { id: 13, strengths: [], weaknesses: [] },
      { id: 999, strengths: ["선택하지 않은 후보의 결과"], weaknesses: [] },
    ],
    generated_at: "2026-09-14T00:00:00Z",
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const CONTEXT_CHANGES = [
  ["사용자", (props) => ({ ...props, userId: "user-b" })],
  ["선택한 후보", (props) => ({
    ...props, items: props.items.map((item) => item.backendId === 13 ? { ...item, checked: false } : item),
  })],
  ["후보 상세", (props) => ({
    ...props, items: props.items.map((item) => item.backendId === 11 ? { ...item, price: 6 } : item),
  })],
  ["프로필 목적", (props) => ({ ...props, profile: { service_purposes: ["buy"] } })],
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  createDashboardInsight.mockResolvedValue(response());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AI 분석 실행 조건과 응답 표시", () => {
  it("익명 사용자는 선택한 후보가 있어도 분석을 호출하지 못한다", () => {
    render(<InsightPanel {...BASE_PROPS} userId={null} />);

    const button = screen.getByRole("button", { name: ANALYZE });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(createDashboardInsight).not.toHaveBeenCalled();
    expect(screen.getByText("로그인하면 저장한 관심 매물의 AI 인사이트를 확인할 수 있어요.")).toBeDefined();
  });

  it.each([
    ["선택 없음", ITEMS.map((item) => ({ ...item, checked: false }))],
    ["저장 전 후보만 선택", [ITEMS[3]]],
  ])("%s이면 분석 호출을 막는다", (_label, items) => {
    render(<InsightPanel {...BASE_PROPS} items={items} />);

    const button = screen.getByRole("button", { name: ANALYZE });
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(createDashboardInsight).not.toHaveBeenCalled();
    expect(screen.getByText("분석할 관심 매물을 선택해 주세요.")).toBeDefined();
  });

  it.each([
    ["프로필 없음", null],
    ["건너뛰기 완료", { service_purposes: [] }],
    ["목적 입력 완료", { service_purposes: ["buy", "move"] }],
  ])("%s 상태에서도 클릭했을 때만 선택한 backendId를 전달한다", async (_label, profile) => {
    render(<InsightPanel {...BASE_PROPS} profile={profile} />);
    expect(createDashboardInsight).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: ANALYZE }));

    expect(createDashboardInsight).toHaveBeenCalledExactlyOnceWith([11, 13], "user-a");
    expect(await screen.findByText("두 후보의 비교 요약")).toBeDefined();
  });

  it("요약과 선택한 후보별 장단점을 표시하고, 선택하지 않은 후보의 결과는 숨긴다", async () => {
    render(<InsightPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: ANALYZE }));

    expect(await screen.findByText("두 후보의 비교 요약")).toBeDefined();
    expect(screen.getByText("첫 번째 단지 · 84㎡")).toBeDefined();
    expect(screen.getByText("두 번째 단지 · 59㎡")).toBeDefined();
    expect(screen.getByText("첫 후보의 강점")).toBeDefined();
    expect(screen.getByText("첫 후보의 약점")).toBeDefined();
    expect(screen.queryByText("선택하지 않은 후보의 결과")).toBeNull();
    expect(screen.getByRole("button", { name: "다시 분석" })).toBeDefined();
    expect(screen.getByText("뉴스 카드")).toBeDefined();
    expect(screen.getByText("청약 카드")).toBeDefined();
  });

  it("실패를 표시하고 다시 시도로 성공한 결과를 보여준다", async () => {
    createDashboardInsight.mockRejectedValueOnce(new Error("AI 서버에 연결하지 못했어요."));
    render(<InsightPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: ANALYZE }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("AI 서버에 연결하지 못했어요.");
    expect(screen.queryByText("두 후보의 비교 요약")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("두 후보의 비교 요약")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createDashboardInsight).toHaveBeenCalledTimes(2);
  });

  it("분석 중 여러 번 클릭해도 중복 요청을 보내지 않는다", async () => {
    const pending = deferred();
    createDashboardInsight.mockReturnValueOnce(pending.promise);
    render(<InsightPanel {...BASE_PROPS} />);
    const button = screen.getByRole("button", { name: ANALYZE });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(createDashboardInsight).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("status")).toBeDefined();
    await act(async () => { pending.resolve(response()); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("계정·후보·프로필 변경 시 분석 결과 격리", () => {
  it.each(CONTEXT_CHANGES)("%s 변경 시 완료된 기존 결과를 지우고 자동 호출하지 않는다", async (_label, change) => {
    const { rerender } = render(<InsightPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: ANALYZE }));
    await screen.findByText("두 후보의 비교 요약");

    rerender(<InsightPanel {...change(BASE_PROPS)} />);

    expect(screen.queryByText("두 후보의 비교 요약")).toBeNull();
    expect(screen.getByRole("button", { name: ANALYZE })).toBeDefined();
    expect(createDashboardInsight).toHaveBeenCalledTimes(1);
  });

  it.each(CONTEXT_CHANGES)("%s 변경 후 늦게 도착한 이전 응답이 새 분석을 덮어쓰지 않는다", async (_label, change) => {
    const oldRequest = deferred();
    const newRequest = deferred();
    createDashboardInsight.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const { rerender } = render(<InsightPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: ANALYZE }));

    rerender(<InsightPanel {...change(BASE_PROPS)} />);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ANALYZE }));
    await act(async () => { newRequest.resolve(response("새 조건의 분석 결과")); });
    expect(screen.getByText("새 조건의 분석 결과")).toBeDefined();

    await act(async () => { oldRequest.resolve(response("이전 조건의 오래된 결과")); });

    expect(screen.queryByText("이전 조건의 오래된 결과")).toBeNull();
    expect(screen.getByText("새 조건의 분석 결과")).toBeDefined();
    expect(createDashboardInsight).toHaveBeenCalledTimes(2);
  });

  it("계정 전환 후 이전 요청의 늦은 실패도 새 화면에 표시하지 않는다", async () => {
    const pending = deferred();
    createDashboardInsight.mockReturnValueOnce(pending.promise);
    const { rerender } = render(<InsightPanel {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: ANALYZE }));

    rerender(<InsightPanel {...BASE_PROPS} userId="user-b" />);
    await act(async () => { pending.reject(new Error("이전 계정 요청의 오류")); });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: ANALYZE }).disabled).toBe(false);
  });
});
