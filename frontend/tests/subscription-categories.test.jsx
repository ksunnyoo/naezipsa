// 청약 분류 필터가 백엔드 응답을 따라가는지 확인한다.
//
// 예전에는 분류 4가지를 프론트에 하드코딩해서, 백엔드에 분류가 늘어도
// 필터에 나타나지 않고 항목의 분류 칩도 사라졌다. 이제는 응답의
// data[].category/label을 그대로 읽는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SubscriptionInfoCard from "@/components/Insight/SubscriptionInfoCard";
import { getInsightItems } from "@/lib/insightApi";

vi.mock("@/lib/insightApi", () => ({
  getInsightItems: vi.fn(),
  sourceLink: value => value,
}));

function announcement(name, category, region = "서울") {
  return {
    announcement_no: name, house_name: name, address: `${region} 어딘가`,
    announced_at: "2026-09-10", receipt_start: "2026-09-20", receipt_end: "2026-09-22",
    receipt_status: "upcoming", category, region, source_url: "https://example.com",
  };
}

function group(category, label, items) {
  return { category, label, regions: [{ region: "서울", label: "[서울]", items }] };
}

// 기존 4가지 중 둘 + 백엔드에만 새로 생긴 분류 하나.
const GROUPS = [
  group("priority-1", "1순위", [announcement("가아파트", "priority-1")]),
  group("special", "특별공급", [announcement("나아파트", "special")]),
  group("special-newlywed", "신혼부부 특별공급", [announcement("다아파트", "special-newlywed")]),
];

function openCategoryPicker() {
  fireEvent.click(screen.getByRole("button", { name: /분류선택|외 \d+개|1순위|특별공급/ }));
  return screen.getByRole("group", { name: "청약 분류 선택" });
}

beforeEach(() => {
  vi.resetAllMocks();
  getInsightItems.mockResolvedValue(GROUPS);
});
afterEach(cleanup);

describe("청약 분류 필터", () => {
  it("백엔드에 새로 생긴 분류가 프론트 수정 없이 필터에 나타난다", async () => {
    render(<SubscriptionInfoCard referenceSizeId={200} />);
    await screen.findByText("가아파트");

    const picker = openCategoryPicker();
    expect(picker.textContent).toContain("1순위");
    expect(picker.textContent).toContain("특별공급");
    // 하드코딩 목록에는 없던 분류다.
    expect(picker.textContent).toContain("신혼부부 특별공급");
  });

  it("모르는 분류도 칩으로 보여준다(칩이 사라지지 않는다)", async () => {
    render(<SubscriptionInfoCard referenceSizeId={200} />);
    await screen.findByText("다아파트");

    const chips = [...document.querySelectorAll(".subscription-item-category")]
      .map(node => node.textContent);
    expect(chips).toContain("신혼부부 특별공급");
  });

  it("알려진 분류는 기존 색을, 모르는 분류는 기본 색을 쓴다", async () => {
    render(<SubscriptionInfoCard referenceSizeId={200} />);
    await screen.findByText("가아파트");

    const byLabel = Object.fromEntries(
      [...document.querySelectorAll(".subscription-item-category")]
        .map(node => [node.textContent, node.className]),
    );
    expect(byLabel["1순위"]).toContain("is-priority");
    expect(byLabel["특별공급"]).toContain("is-special");
    expect(byLabel["신혼부부 특별공급"]).toContain("is-other");
  });

  it("새 분류로 걸러내면 그 분류의 공고만 남는다", async () => {
    render(<SubscriptionInfoCard referenceSizeId={200} />);
    await screen.findByText("가아파트");

    openCategoryPicker();
    fireEvent.click(screen.getByLabelText("신혼부부 특별공급"));

    await waitFor(() => expect(screen.queryByText("가아파트")).toBeNull());
    expect(screen.getByText("다아파트")).toBeTruthy();
  });

  it("골라둔 분류가 다음 응답에서 사라지면 그 선택은 무시한다", async () => {
    const { rerender } = render(<SubscriptionInfoCard referenceSizeId={200} />);
    await screen.findByText("가아파트");
    openCategoryPicker();
    fireEvent.click(screen.getByLabelText("신혼부부 특별공급"));
    await waitFor(() => expect(screen.queryByText("가아파트")).toBeNull());

    // 그 유형 공고가 없는 날: 응답에서 분류가 빠진다.
    getInsightItems.mockResolvedValue([GROUPS[0], GROUPS[1]]);
    rerender(<SubscriptionInfoCard referenceSizeId={201} />);

    // 목록이 빈 채로 멈추지 않고 전체가 보인다.
    expect(await screen.findByText("가아파트")).toBeTruthy();
    expect(screen.getByText("나아파트")).toBeTruthy();
  });
});
