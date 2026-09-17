// 후보 카드에서 집을 구분해주는 줄(unitText).
//
// 같은 단지·평형을 여러 개 담을 수 있어서(같은 라인의 다른 층, 같은 층의 다른 동)
// 이 줄이 사실상 유일한 구분 수단이다. 등록할 때 동·호수를 모르는 경우가 많으므로
// 층이라도 있으면 그걸 쓴다.
import { describe, expect, it } from "vitest";
import { unitText } from "@/lib/data";

describe("unitText", () => {
  it("동과 호수를 다 알면 둘 다 보여준다", () => {
    expect(unitText({ dong: "101", ho: "1203" })).toBe("101동 1203호");
  });

  it("호수만 알면 호수만 보여준다", () => {
    expect(unitText({ dong: "", ho: "1203" })).toBe("1203호");
  });

  it("호수를 모르면 층이 대신 구분해준다", () => {
    // 매물을 보고 담는 시점에는 "12층대"까지만 아는 일이 흔하다.
    expect(unitText({ dong: "101", ho: "", floor: "12" })).toBe("101동 12층");
    expect(unitText({ dong: "", ho: "", floor: "12" })).toBe("12층");
  });

  it("호수를 알면 층은 덧붙이지 않는다", () => {
    // 1203호가 이미 12층을 품고 있어 "1203호 12층"은 군더더기다.
    expect(unitText({ dong: "101", ho: "1203", floor: "12" })).toBe("101동 1203호");
  });

  it("아무것도 없으면 미입력이라고 알려준다", () => {
    expect(unitText({})).toBe("위치 미입력");
    expect(unitText({ dong: "", ho: "", floor: "" })).toBe("위치 미입력");
  });

  it("숫자로 들어와도 처리한다(서버 응답은 층이 숫자다)", () => {
    expect(unitText({ dong: 101, ho: 1203 })).toBe("101동 1203호");
    expect(unitText({ floor: 12 })).toBe("12층");
  });
});
