// 임장 체크리스트 종합 평점 계산과 저장 형태 변환(lib/checklist.js).
// 화면을 그리지 않는 순수 함수만 다룬다.
import { describe, expect, it } from "vitest";

import {
  CATEGORY_WEIGHTS,
  EMPTY_CHECKLIST,
  WEIGHT_CATEGORIES,
  computeOverallScore,
  editableWeights,
  fromInspectionRecord,
  toInspectionPayload,
  weightShares,
  weightsForContext,
  weightsForPurposes,
} from "@/lib/checklist";

const BUY = CATEGORY_WEIGHTS.buy;
const JEONSE = CATEGORY_WEIGHTS.jeonse;

// 모든 항목을 같은 값으로 채운다(유해시설은 0/1이라 따로 넘긴다).
function allItems(value, harmful) {
  const values = {};
  for (const key of Object.keys(EMPTY_CHECKLIST)) values[key] = value;
  values.harmful_facility = harmful;
  return values;
}

describe("computeOverallScore", () => {
  it("아무 항목도 고르지 않으면 계산하지 않는다", () => {
    expect(computeOverallScore(EMPTY_CHECKLIST, BUY)).toBeNull();
    expect(computeOverallScore(undefined, BUY)).toBeNull();
  });

  it("전부 좋음이면 100점, 전부 나쁨이면 0점", () => {
    expect(computeOverallScore(allItems(3, 0), BUY))
      .toEqual({ score: 100, rating: 5, checked: 18, total: 18 });
    // 화면 점수는 0점이어도 저장은 1~5 정수라 최소 1점으로 옮긴다.
    expect(computeOverallScore(allItems(1, 1), BUY))
      .toEqual({ score: 0, rating: 1, checked: 18, total: 18 });
  });

  it("유해시설은 없음(0)이 있음(1)보다 좋은 쪽으로 계산된다", () => {
    const none = computeOverallScore({ ...EMPTY_CHECKLIST, harmful_facility: 0 }, BUY);
    const exists = computeOverallScore({ ...EMPTY_CHECKLIST, harmful_facility: 1 }, BUY);
    expect(none.score).toBeGreaterThan(exists.score);
    expect(none.rating).toBe(5); // 0 = 없음 -> 1~3 자에서 3(좋음)
    expect(exists.rating).toBe(1);
  });

  it("고르지 않은 항목은 계산에서 빠진다", () => {
    // 교통 묶음만 "좋음"으로 채우면, 나머지를 비워둬도 점수가 깎이지 않는다.
    const onlyTransport = { ...EMPTY_CHECKLIST, transport: 3, commute_road: 3 };
    expect(computeOverallScore(onlyTransport, BUY))
      .toEqual({ score: 100, rating: 5, checked: 2, total: 18 });
  });

  it("몇 개를 보고 낸 점수인지 함께 알려준다", () => {
    // 2개만 보고 낸 100점과 18개를 다 본 100점은 점수가 같다. 그대로 나란히 놓으면
    // 앞이 더 좋아 보이므로, 계산은 그대로 두고 본 개수를 함께 준다.
    const few = computeOverallScore({ ...EMPTY_CHECKLIST, transport: 3, commute_road: 3 }, BUY);
    const all = computeOverallScore(allItems(3, 0), BUY);

    expect(few.score).toBe(all.score);
    expect(few.checked).toBe(2);
    expect(all.checked).toBe(18);
    expect(few.total).toBe(18);
  });

  it("한 묶음 안에서는 고른 항목끼리만 평균을 낸다", () => {
    const half = { ...EMPTY_CHECKLIST, transport: 3, commute_road: 1 };
    expect(computeOverallScore(half, BUY).score).toBe(50); // (3+1)/2 = 2 -> 100점 만점에 50점
  });

  it("가중치를 어떻게 고쳐도 만점은 100으로 고정된다", () => {
    // 합이 100이 아닌 가중치(합 250)로도 전부 좋음이면 100점이다.
    const odd = {
      transport_group: 50, education_life_group: 50, complex_group: 50,
      interior_condition_group: 50, facility_group: 50,
    };
    expect(computeOverallScore(allItems(3, 0), odd).score).toBe(100);
    expect(computeOverallScore(allItems(1, 1), odd).score).toBe(0);
  });

  it("전세와 매매는 같은 체크에도 다른 점수를 준다", () => {
    // 내부 상태는 좋고 단지는 나쁜 집: 전세가 내부 상태를 더 크게 본다.
    const values = {
      ...EMPTY_CHECKLIST,
      leak_mold: 3, wallpaper: 3, water_pressure: 3, toilet_drain: 3, drain_smell: 3,
      parking: 1, sunlight: 1, natural_light: 1,
    };
    const jeonse = computeOverallScore(values, JEONSE);
    const buy = computeOverallScore(values, BUY);
    expect(jeonse.score).toBeGreaterThan(buy.score);
  });

  it("화면 점수는 0~100 정수, 저장용 평점은 1~5 정수다", () => {
    const values = { ...EMPTY_CHECKLIST, transport: 3, commute_road: 2 };
    const result = computeOverallScore(values, BUY);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.rating)).toBe(true);
    expect(result.rating).toBeGreaterThanOrEqual(1);
    expect(result.rating).toBeLessThanOrEqual(5);
  });
});

describe("weightsForPurposes", () => {
  it("전세만 고르면 전세 가중치, 매매나 투자를 고르면 매매 가중치", () => {
    expect(weightsForPurposes(["jeonse"])).toBe(JEONSE);
    expect(weightsForPurposes(["buy"])).toBe(BUY);
    expect(weightsForPurposes(["invest"])).toBe(BUY);
    expect(weightsForPurposes(["move", "buy"])).toBe(BUY);
  });

  it("둘 다이거나 고르지 않았으면 두 가중치의 중간값을 쓴다", () => {
    for (const purposes of [["jeonse", "buy"], [], null, undefined, ["move"]]) {
      const weights = weightsForPurposes(purposes);
      expect(weights.transport_group).toBe(30); // 교통은 양쪽 다 30이라 그대로
      expect(weights.interior_condition_group).toBe((30 + 15) / 2);
      expect(weights.complex_group).toBe((15 + 25) / 2);
    }
  });
});

describe("저장 형태 변환", () => {
  it("저장 body에는 18개 항목과 평점·메모만 담는다", () => {
    const payload = toInspectionPayload({ ...EMPTY_CHECKLIST, transport: 2, boardId: 9 }, 4, "메모");
    expect(Object.keys(payload).sort()).toEqual(
      [...Object.keys(EMPTY_CHECKLIST), "overall_rating", "memo"].sort(),
    );
    expect(payload).not.toHaveProperty("boardId"); // 화면 전용 키는 422가 되므로 빼야 한다
    expect(payload.transport).toBe(2);
    expect(payload.school).toBeNull(); // 미확인은 null로
    expect(payload.overall_rating).toBe(4);
    expect(payload.memo).toBe("메모");
  });

  it("메모를 넘기지 않으면 빈 문자열이다(서버가 null을 거부한다)", () => {
    expect(toInspectionPayload(EMPTY_CHECKLIST, 3).memo).toBe("");
  });

  it("서버 기록에서 항목·평점·메모를 갈라낸다", () => {
    const record = {
      id: 7, property_id: 3, created_at: "2026-09-16T05:00:00Z",
      updated_at: "2026-09-16T06:00:00Z",
      ...EMPTY_CHECKLIST, transport: 3, harmful_facility: 0,
      overall_rating: 4, memo: "채광 좋음",
    };
    const parsed = fromInspectionRecord(record);
    expect(Object.keys(parsed.values).sort()).toEqual(Object.keys(EMPTY_CHECKLIST).sort());
    expect(parsed.values.transport).toBe(3);
    expect(parsed.values.harmful_facility).toBe(0); // 0(없음)이 null로 뭉개지지 않는다
    expect(parsed.values.id).toBeUndefined();
    expect(parsed.rating).toBe(4);
    expect(parsed.memo).toBe("채광 좋음");
  });

  it("기록이 없으면 null이다(빈 체크리스트로 시작한다는 뜻)", () => {
    expect(fromInspectionRecord(null)).toBeNull();
  });
});

describe("어느 가중치로 점수를 낼지 (그룹 > 프로필)", () => {
  const CUSTOM = {
    transport_group: 50, education_life_group: 10, complex_group: 10,
    interior_condition_group: 20, facility_group: 10,
  };

  const MINE = {
    transport_group: 10, education_life_group: 40, complex_group: 20,
    interior_condition_group: 20, facility_group: 10,
  };

  it("그룹 기준 > 내 기본 기준 > 이용 목적 기본값 순이다", () => {
    const profile = { service_purposes: ["jeonse"], scoring_weights: MINE };
    // 1) 그룹이 정해뒀으면 그룹이 이긴다
    expect(weightsForContext({ scoring_weights: CUSTOM }, profile)).toBe(CUSTOM);
    // 2) 그룹이 없으면 내 기본 기준
    expect(weightsForContext(null, profile)).toBe(MINE);
    // 3) 내 기본도 없으면 이용 목적에서 고른 기본값
    expect(weightsForContext(null, { service_purposes: ["jeonse"] })).toBe(CATEGORY_WEIGHTS.jeonse);
    expect(weightsForContext({ scoring_weights: null }, { service_purposes: ["buy"] }))
      .toBe(CATEGORY_WEIGHTS.buy);
  });

  it("카테고리가 빠진 값은 믿지 않고 다음 순위로 넘어간다", () => {
    expect(weightsForContext({ scoring_weights: { transport_group: 30 } }, { service_purposes: ["buy"] }))
      .toBe(CATEGORY_WEIGHTS.buy);
    // 내 기본 기준이 깨져 있어도 마찬가지다.
    expect(weightsForContext(null, { service_purposes: ["buy"], scoring_weights: { complex_group: 50 } }))
      .toBe(CATEGORY_WEIGHTS.buy);
  });

  it("편집 시작값은 항상 정수다 - 서버가 0~100 정수만 받는다", () => {
    // 전세·매매를 둘 다 고르면 기본값이 두 벌의 중간이라 소수가 나올 수 있다.
    const middle = editableWeights(null, { service_purposes: ["jeonse", "buy"] });
    for (const { key } of WEIGHT_CATEGORIES) {
      expect(Number.isInteger(middle[key])).toBe(true);
    }
    expect(editableWeights({ scoring_weights: CUSTOM }, {})).toEqual(CUSTOM);
  });

  it("편집 화면의 카테고리는 체크리스트 묶음 5개와 같다", () => {
    expect(new Set(WEIGHT_CATEGORIES.map((c) => c.key)))
      .toEqual(new Set(Object.keys(CATEGORY_WEIGHTS.buy)));
    expect(WEIGHT_CATEGORIES.every((c) => c.label)).toBe(true);
  });
});

describe("이상한 값이 들어와도 점수가 무너지지 않는다", () => {
  // 화면(1~3 선택지)과 서버(정수 1~3 검증)가 막아주지만, 계산 함수 자체도 안전해야 한다.
  it("범위 밖 숫자는 1~3 안으로 붙든다", () => {
    expect(computeOverallScore({ ...EMPTY_CHECKLIST, transport: 9 }, BUY).score).toBe(100);
    expect(computeOverallScore({ ...EMPTY_CHECKLIST, transport: -5 }, BUY).score).toBe(0);
  });

  it("숫자 문자열은 숫자로 보고 계산한다", () => {
    // 예전에는 sum + "3"이 문자열 붙이기가 되어 점수가 통째로 망가졌다.
    expect(computeOverallScore({ ...EMPTY_CHECKLIST, transport: "3" }, BUY).score).toBe(100);
  });

  it("숫자가 아닌 값은 미확인과 똑같이 계산에서 뺀다", () => {
    expect(computeOverallScore({ ...EMPTY_CHECKLIST, transport: "좋음" }, BUY)).toBeNull();
  });
});

describe("weightShares", () => {
  it("적은 숫자가 아니라 전체에서 차지하는 몫을 알려준다", () => {
    const shares = weightShares({
      transport_group: 30, education_life_group: 10,
      complex_group: 0, interior_condition_group: 0, facility_group: 0,
    });
    expect(shares.transport_group).toBe(75);
    expect(shares.education_life_group).toBe(25);
  });

  it("합이 100이 아니어도 실제 몫으로 환산한다", () => {
    // 다섯 칸에 100씩 적으면 합은 500이지만 각자는 20%다 - 숫자만 보면 알 수 없는 부분.
    const all100 = Object.fromEntries(WEIGHT_CATEGORIES.map(({ key }) => [key, 100]));
    expect(weightShares(all100).transport_group).toBe(20);
  });

  it("전부 0이면 모두 0%다", () => {
    const zero = Object.fromEntries(WEIGHT_CATEGORIES.map(({ key }) => [key, 0]));
    expect(Object.values(weightShares(zero)).every((share) => share === 0)).toBe(true);
  });
});
