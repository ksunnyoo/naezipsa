// 임장 체크리스트 종합 평점 계산과 저장 형태 변환(lib/checklist.js).
// 화면을 그리지 않는 순수 함수만 다룬다.
import { describe, expect, it } from "vitest";

import {
  CATEGORY_WEIGHTS,
  EMPTY_CHECKLIST,
  computeOverallScore,
  fromInspectionRecord,
  toInspectionPayload,
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

  it("전부 좋음이면 5점, 전부 나쁨이면 1점", () => {
    expect(computeOverallScore(allItems(3, 0), BUY)).toEqual({ score: 5, rating: 5 });
    expect(computeOverallScore(allItems(1, 1), BUY)).toEqual({ score: 1, rating: 1 });
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
    expect(computeOverallScore(onlyTransport, BUY)).toEqual({ score: 5, rating: 5 });
  });

  it("한 묶음 안에서는 고른 항목끼리만 평균을 낸다", () => {
    const half = { ...EMPTY_CHECKLIST, transport: 3, commute_road: 1 };
    expect(computeOverallScore(half, BUY).score).toBe(3); // (3+1)/2 = 2 -> 1~5로 3점
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

  it("화면용 점수는 소수점 한 자리, 저장용 평점은 1~5 정수다", () => {
    const values = { ...EMPTY_CHECKLIST, transport: 3, commute_road: 2 };
    const result = computeOverallScore(values, BUY);
    expect(result.score).toBe(Math.round(result.score * 10) / 10);
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
