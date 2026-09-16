// 데모용 데이터 배열 — 프로토타입의 COMPLEXES/DIRECTIONS/INTERIORS/REGULATIONS를
// 그대로 옮겨왔다. 실제 서비스에서는 이 자리가 국토부 실거래가 API 응답이나
// DB 조회 결과로 대체될 자리이므로, 지금은 하드코딩이지만 구조(필드 이름)는
// 그대로 유지하는 편이 나중에 교체하기 쉽다.

// regulations: 이 단지가 속한 규제 지정 현황(투기과열지구/조정대상지역/토지거래
// 허가구역, 중복 지정 가능 — 실제로는 서로 다른 법 조항에 근거한 별개 지정임).
// 지금은 국토부 API 연동 전이라 데모용으로 단지마다 하드코딩해뒀고, 실제로는
// 법정동코드 기준 참조 테이블과 매칭해서 자동으로 채워질 값(REGULATIONS 참고).
export const COMPLEXES = [
  {
    id: "doosan",
    name: "행당두산위브",
    region: "성동구 행당동 128",
    built: "2000년 준공",
    dealCount: 3,
    regulations: ["overheated", "adjustment"],
    sizes: [
      { label: "59㎡", price: "최근거래가 7.8억" },
      { label: "84㎡", price: "최근거래가 10.9억" },
      { label: "114㎡", price: "최근거래가 13.8억" },
    ],
  },
  {
    id: "daerim",
    name: "행당대림",
    region: "성동구 행당동 128",
    built: "2000년 준공",
    dealCount: 3,
    regulations: ["adjustment", "land-permit"],
    sizes: [
      { label: "59㎡", price: "최근거래가 8.2억" },
      { label: "84㎡", price: "최근거래가 11.4억" },
      { label: "114㎡", price: "최근거래가 14.6억" },
    ],
  },
  {
    id: "hanjin",
    name: "행당한진타운",
    region: "성동구 행당동 128",
    built: "2000년 준공",
    dealCount: 3,
    regulations: [],
    sizes: [
      { label: "59㎡", price: "최근거래가 7.5억" },
      { label: "84㎡", price: "최근거래가 10.6억" },
      { label: "114㎡", price: "최근거래가 13.4억" },
    ],
  },
];

export const DIRECTIONS = ["남동", "남서", "북동", "북서"];
export const INTERIORS = ["수리 없음", "부분 수리", "올수리"];

// 대시보드 카드 하단에 붙는 규제 지정 뱃지. key는 COMPLEXES[].regulations와
// 대시보드 아이템의 item.regulations 배열에 들어가는 값과 일치해야 함.
export const REGULATIONS = {
  overheated: { label: "투기과열지구", cls: "reg-badge--overheated" },
  adjustment: { label: "조정대상지역", cls: "reg-badge--adjustment" },
  "land-permit": { label: "토지거래 허가구역", cls: "reg-badge--land-permit" },
  // 해당하는 규제가 하나도 없는 매물에 대신 보여주는 뱃지. item.regulations를
  // key로 찾는 REGULATIONS[key] 방식이 아니라, InterestCard가 규제가 없을 때
  // 이 항목 하나를 직접 골라 쓴다.
  none: { label: "규제 해당 없음", cls: "reg-badge--none" },
};

// 관심 매물 리스트는 항상 이 개수만큼 고정 슬롯으로 렌더링된다(데이터가 많아지면
// 복잡해질 것 같아 최대 6개로 제한 — 채워진 카드 + 추가 트리거 1칸 + 나머지 빈
// 자리표시자).
export const MAX_DASHBOARD_ITEMS = 6;

// 만들 수 있는 그룹 수 상한. 백엔드 app/group/model.py의
// MAX_GROUPS_PER_USER와 값을 맞춰둔다(한 줄 4개 x 2줄).
export const MAX_DASHBOARD_GROUPS = 8;

// 검색 결과가 실 백엔드 API에서 온 경우 dealCount(평형 종류 수)가 아직 없을
// 수 있다(검색 API는 평형 데이터를 안 주므로) — 그 경우 가짜 숫자 대신
// "정보 준비중"을 보여준다.
export function dealCountLabel(dealCount) {
  return dealCount != null ? `평형 ${dealCount}개` : "평형 정보 준비중";
}

// 원 단위 금액을 "X.X억" 형태로 표시 (components/charts/PriceTrendChart.jsx의
// formatPriceLabel과 동일한 반올림 규칙 — 소수 둘째 자리에서 버림).
export function formatEokLabel(won) {
  const num = Number(won);
  if (!Number.isFinite(num)) return null;
  const eok = num / 100000000;
  const truncated = Math.floor(eok * 10) / 10;
  return `${truncated.toFixed(1)}억`;
}

export function dongHoText(item) {
  const d = (item.dong || "").trim();
  const h = (item.ho || "").trim();
  if (!d && !h) return "동/호수 미입력";
  return (d ? d + "동 " : "") + (h ? h + "호" : "");
}
