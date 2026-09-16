// 임장 체크리스트의 "?" — 점수가 어떻게 나왔는지 보여주고 그 자리에서 기준을 고친다.
//
// 저장 위치는 보고 있는 화면이 정한다(2026-09-16 결정).
//   그룹을 보는 중  -> 그 그룹의 기준
//   전체 후보 화면  -> 내 기본 기준(프로필)
// 여기서는 팝업이 어떤 값을 넘기는지까지만 본다. 실제 저장은 NaejipsaApp이 한다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EditListingDialog from "@/components/EditListingDialog";
import { CATEGORY_WEIGHTS } from "@/lib/checklist";

const ITEM = {
  id: "item-1", name: "단지1", sizeLabel: "84㎡",
  price: "", floor: "", dong: "", ho: "", direction: null, interior: null,
};
const BUY = CATEGORY_WEIGHTS.buy;

function openHelp(overrides = {}) {
  const onSaveWeights = vi.fn().mockResolvedValue(true);
  render(
    <EditListingDialog
      open
      item={ITEM}
      initialChecklist={undefined}
      initialRating={null}
      group={null}
      profile={{ service_purposes: ["buy"] }}
      onSave={vi.fn()}
      onSaveWeights={onSaveWeights}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "임장 체크리스트" }));
  fireEvent.click(screen.getByRole("button", { name: "점수 산출 방식 보기" }));
  return onSaveWeights;
}

afterEach(cleanup);

describe('임장 체크리스트의 "?"', () => {
  it("지금 쓰는 기준과 카테고리별 비중을 보여준다", () => {
    openHelp();

    expect(screen.getByText(/매매 기본값/)).toBeTruthy();
    expect(screen.getByLabelText("교통").value).toBe(String(BUY.transport_group));
    expect(screen.getByLabelText("단지").value).toBe(String(BUY.complex_group));
    expect(screen.getByLabelText("설비").value).toBe(String(BUY.facility_group));
  });

  it("그룹을 보는 중이면 그 그룹 기준이라고 알려준다", () => {
    const groupWeights = {
      transport_group: 50, education_life_group: 10, complex_group: 10,
      interior_condition_group: 20, facility_group: 10,
    };
    openHelp({ group: { id: 7, name: "전세 후보", scoring_weights: groupWeights } });

    expect(screen.getByText(/전세 후보 그룹 기준/)).toBeTruthy();
    expect(screen.getByLabelText("교통").value).toBe("50");
    // 저장 위치를 문구로 알려준다.
    expect(screen.getByText(/이 그룹의 기준으로 저장/)).toBeTruthy();
  });

  it("전체 후보 화면에서는 내 기본 기준으로 저장된다고 알려준다", () => {
    openHelp();
    expect(screen.getByText(/내 기본 기준으로 저장/)).toBeTruthy();
  });

  it("고친 값을 5개 카테고리 모두 담아 넘긴다", async () => {
    const onSaveWeights = openHelp();

    fireEvent.change(screen.getByLabelText("교통"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "점수 기준 저장" }));

    await waitFor(() => expect(onSaveWeights).toHaveBeenCalled());
    expect(onSaveWeights.mock.calls[0][0]).toEqual({
      transport_group: 45,
      education_life_group: BUY.education_life_group,
      complex_group: BUY.complex_group,
      interior_condition_group: BUY.interior_condition_group,
      facility_group: BUY.facility_group,
    });
  });

  it('"기본값으로"는 null을 넘겨 정해둔 기준을 지운다', async () => {
    const onSaveWeights = openHelp();

    fireEvent.click(screen.getByRole("button", { name: "기본값으로" }));

    await waitFor(() => expect(onSaveWeights).toHaveBeenCalledWith(null));
  });

  it("전부 0이면 저장할 수 없다(서버도 422로 막는다)", () => {
    openHelp();

    for (const label of ["교통", "교육·생활", "단지", "내부 상태", "설비"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    }

    expect(screen.getByRole("button", { name: "점수 기준 저장" }).disabled).toBe(true);
  });

  it("저장에 성공하면 패널이 닫힌다", async () => {
    const onSaveWeights = openHelp();
    fireEvent.click(screen.getByRole("button", { name: "기본값으로" }));

    await waitFor(() => expect(onSaveWeights).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText("교통")).toBeNull());
  });
});
