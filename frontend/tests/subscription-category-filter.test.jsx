// 청약 분류 필터: 골라둔 분류가 다음 응답에 없을 때의 동작.
//
// 분류 목록은 응답에서 오므로, 그 유형 공고가 없는 날에는 골라둔 분류가 목록에서
// 사라진다. 그때 목록이 빈 채로 멈추면 사용자는 이유를 알 수 없다. 예전에는
// effect에서 선택 상태를 지워 해결했는데, 그리는 중에 걸러 쓰는 방식으로 바꿨다
// (effect 안 setState는 응답이 올 때마다 렌더를 한 번 더 돌린다).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SubscriptionInfoCard from "@/components/Insight/SubscriptionInfoCard";
import { getInsightItems } from "@/lib/insightApi";

vi.mock("@/lib/insightApi", () => ({
  getInsightItems: vi.fn(),
  sourceLink: value => value,
}));

function announcement(name, category) {
  return {
    announcement_no: name, house_name: name, address: "서울 어딘가",
    announced_at: "2026-09-10", receipt_start: "2026-09-20", receipt_end: "2026-09-22",
    receipt_status: "upcoming", category, region: "서울", source_url: "https://example.com",
  };
}

function group(category, label, items) {
  return { category, label, regions: [{ region: "서울", label: "[서울]", items }] };
}

const SPECIAL = group("special", "특별공급", [announcement("나아파트", "special")]);
const OFFICETEL = group("officetel", "오피스텔", [announcement("다아파트", "officetel")]);

beforeEach(() => {
  vi.resetAllMocks();
  getInsightItems.mockResolvedValue([SPECIAL, OFFICETEL]);
});
afterEach(cleanup);

describe("청약 분류 필터", () => {
  it("분류를 고르면 그 분류의 공고만 남는다", async () => {
    render(<SubscriptionInfoCard referenceSizeId={200} />);
    await screen.findByText("나아파트");

    fireEvent.click(screen.getByRole("button", { name: /분류선택/ }));
    fireEvent.click(screen.getByRole("button", { name: "오피스텔" }));

    await waitFor(() => expect(screen.queryByText("나아파트")).toBeNull());
    expect(screen.getByText("다아파트")).toBeTruthy();
  });

  it("골라둔 분류가 다음 응답에 없으면 그 선택은 무시하고 전체를 보여준다", async () => {
    const { rerender } = render(<SubscriptionInfoCard referenceSizeId={200} />);
    await screen.findByText("나아파트");
    fireEvent.click(screen.getByRole("button", { name: /분류선택/ }));
    fireEvent.click(screen.getByRole("button", { name: "오피스텔" }));
    await waitFor(() => expect(screen.queryByText("나아파트")).toBeNull());

    // 오피스텔 공고가 없는 날: 응답에서 그 분류가 빠진다.
    getInsightItems.mockResolvedValue([SPECIAL]);
    rerender(<SubscriptionInfoCard referenceSizeId={201} />);

    // 목록이 빈 채로 멈추지 않는다.
    expect(await screen.findByText("나아파트")).toBeTruthy();
    expect(screen.queryByText("조건에 맞는 데이터가 없습니다.")).toBeNull();
  });
});
