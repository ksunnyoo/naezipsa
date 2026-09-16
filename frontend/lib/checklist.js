// 매물 정보 수정 팝업의 "체크리스트 작성" 화면(EditListingDialog ->
// InspectionChecklist)에서 쓰는 항목 정의.
//
// 값 규칙(전체 공통): 숫자가 클수록 상태가 좋다(1=나쁨 ~ 3=좋음이 기본형).
// 유일한 예외는 harmful_facility(주변 유해시설)로, 0=없음(좋음)/1=있음(나쁨)이라
// 오히려 작을수록 좋다. 그래도 초기값을 0으로 미리 선택해두지 않는다 - 사용자가
// 실제로 확인하기 전까지는 "없음"이 아니라 "미확인"이어야 하기 때문이다. 모든
// 항목의 미입력 상태는 null이고, 이 null이 그대로 "미확인"을 의미한다
// (EMPTY_CHECKLIST가 전부 null로 시작하는 이유).
//
// 2026-09-16부터 백엔드에 저장한다. 이 스키마(각 item.key -> 숫자값|null)를
// 그대로 POST /properties/{id}/inspection 의 body에 싣고, GET으로 같은 모양을
// 다시 받아 화면을 채운다. 후보당 기록은 1건이라 저장할 때마다 덮어쓴다.
function scale3(labels) {
  return [
    { value: 1, label: labels[0] },
    { value: 2, label: labels[1] },
    { value: 3, label: labels[2] },
  ];
}

export const CHECKLIST_GROUPS = [
  {
    key: "transport_group",
    label: "교통",
    items: [
      { key: "transport", label: "대중교통 편리", options: scale3(["나쁨", "보통", "좋음"]) },
      { key: "commute_road", label: "출퇴근 도로 원활", options: scale3(["나쁨", "보통", "좋음"]) },
    ],
  },
  {
    key: "education_life_group",
    label: "교육·생활",
    items: [
      { key: "school", label: "학군", options: scale3(["나쁨", "보통", "좋음"]) },
      { key: "academy", label: "학원", options: scale3(["나쁨", "보통", "좋음"]) },
      { key: "convenience", label: "편의시설", options: scale3(["나쁨", "보통", "좋음"]) },
      { key: "noise", label: "소음", options: scale3(["시끄러움", "보통", "조용"]) },
      {
        key: "harmful_facility",
        label: "주변 유해시설",
        // 유일한 예외 - 0/1이고 작을수록(0=없음) 좋다. 위 scale3()과 달리
        // 초기 선택도 없다(다른 항목과 동일하게 null에서 시작).
        options: [
          { value: 1, label: "있음" },
          { value: 0, label: "없음" },
        ],
      },
    ],
  },
  {
    key: "complex_group",
    label: "단지",
    items: [
      { key: "parking", label: "주차 환경", options: scale3(["나쁨", "보통", "좋음"]) },
      { key: "sunlight", label: "일조권", options: scale3(["나쁨", "보통", "좋음"]) },
      { key: "natural_light", label: "채광", options: scale3(["나쁨", "보통", "좋음"]) },
    ],
  },
  {
    key: "interior_condition_group",
    label: "내부 상태",
    items: [
      { key: "leak_mold", label: "누수 및 곰팡이", options: scale3(["있음", "의심", "없음"]) },
      { key: "wallpaper", label: "벽지", options: scale3(["교체 필요", "보통", "양호"]) },
      { key: "water_pressure", label: "수압", options: scale3(["약함", "보통", "좋음"]) },
      { key: "toilet_drain", label: "변기 물빠짐", options: scale3(["나쁨", "보통", "좋음"]) },
      { key: "drain_smell", label: "배수구 악취", options: scale3(["심함", "약간", "없음"]) },
    ],
  },
  {
    key: "facility_group",
    label: "설비",
    items: [
      { key: "window_condition", label: "샷시", options: scale3(["교체 필요", "보통", "양호"]) },
      { key: "heating", label: "난방", options: scale3(["문제 있음", "보통", "양호"]) },
      { key: "floor_noise", label: "층간 소음", options: scale3(["심함", "보통", "거의 없음"]) },
    ],
  },
];

// 모든 항목이 null(미확인)인 초기 상태 객체. EditListingDialog가 팝업을 열
// 때마다 이 값으로 되돌린다(아직 저장 API가 없어 이전 입력은 유지되지 않음).
export const EMPTY_CHECKLIST = Object.fromEntries(
  CHECKLIST_GROUPS.flatMap((group) => group.items.map((item) => [item.key, null])),
);

// --- 서버 기록 <-> 화면 값 변환 -------------------------------------------

// GET/POST 응답(임장 기록) -> 화면이 쓰는 모양.
// 응답에는 id·시각도 들어 있으므로 18개 항목만 골라낸다. memo는 화면에 입력칸이
// 없지만, 모바일 임장 페이지에서 쓴 메모를 덮어쓰지 않으려고 들고 다닌다.
export function fromInspectionRecord(record) {
  if (!record) return null;
  const values = {};
  for (const key of Object.keys(EMPTY_CHECKLIST)) {
    values[key] = record[key] ?? null;
  }
  return {
    values,
    rating: record.overall_rating ?? null,
    memo: record.memo ?? "",
  };
}

// 화면 값 -> 저장 body. 서버가 정의되지 않은 키를 422로 막으므로 18개 항목과
// overall_rating·memo만 정확히 담는다(화면 전용 키가 섞여 들어가지 않게).
export function toInspectionPayload(values, rating, memo = "") {
  const payload = {};
  for (const key of Object.keys(EMPTY_CHECKLIST)) {
    payload[key] = values?.[key] ?? null;
  }
  payload.overall_rating = rating;
  payload.memo = memo;
  return payload;
}

// --- 종합 평점 자동 계산 (2026-09-16 결정) --------------------------------
//
// 저장 API는 종합 평점(1~5)을 필수로 받는데 체크리스트에는 그 입력칸이 없었다.
// 그래서 체크한 항목으로 점수를 계산해 미리 채워주고, 사용자가 동의하지
// 않으면 직접 고칠 수 있게 한다(EditListingDialog).
//
// 왜 카테고리별로 먼저 평균을 내는가: 묶음마다 항목 수가 다르다(교통 2개,
// 교육·생활 5개...). 18개를 그냥 더하면 항목이 많은 묶음이 자동으로 더 세진다.
// 묶음 안에서 평균을 낸 뒤 가중치를 곱해야 의도한 비중이 나온다.
//
// 가중치를 전세/매매로 가르는 이유: 타깃(30대 신혼·결혼 예정 실거주자)에서
// 실제로 갈리는 축이 그거다. 매매는 못 고치는 것(위치·단지·학군)이 나중
// 가치를 정하고, 전세는 몇 년 뒤 나가니까 사는 동안 겪는 것(내부 상태·설비)이
// 중요하다. 교통은 어느 쪽이든 1위라 사실상 고정이다.
export const CATEGORY_WEIGHTS = {
  jeonse: {
    transport_group: 30,
    interior_condition_group: 30,
    facility_group: 15,
    complex_group: 15,
    education_life_group: 10,
  },
  buy: {
    transport_group: 30,
    complex_group: 25,
    education_life_group: 20,
    interior_condition_group: 15,
    facility_group: 10,
  },
};

// 프로필의 이용 목적(service_purposes)으로 가중치 한 벌을 고른다. 전세만
// 골랐으면 전세, 매매나 투자를 골랐으면 매매(둘 다 "나중 가치"를 같은 방향으로
// 본다), 둘 다이거나 아무것도 없으면 두 벌의 중간값을 쓴다.
export function weightsForPurposes(servicePurposes) {
  const purposes = servicePurposes || [];
  const wantsJeonse = purposes.includes("jeonse");
  const wantsBuy = purposes.includes("buy") || purposes.includes("invest");
  if (wantsJeonse && !wantsBuy) return CATEGORY_WEIGHTS.jeonse;
  if (wantsBuy && !wantsJeonse) return CATEGORY_WEIGHTS.buy;
  return Object.fromEntries(
    Object.keys(CATEGORY_WEIGHTS.buy).map((key) => [
      key,
      (CATEGORY_WEIGHTS.jeonse[key] + CATEGORY_WEIGHTS.buy[key]) / 2,
    ]),
  );
}

// 유해시설만 0=없음(좋음)/1=있음(나쁨)이라 다른 17개와 자가 반대다. 그대로
// 평균에 넣으면 값이 망가지므로 1~3 자로 옮긴다(없음=3, 있음=1).
function itemScore(key, value) {
  if (value == null) return null;
  if (key === "harmful_facility") return value === 0 ? 3 : 1;
  return value;
}

// 체크한 항목으로 종합 평점을 계산한다.
// 반환: { score: 소수점 한 자리(화면 표시용), rating: 정수 1~5(저장용) }
//       아직 아무 항목도 고르지 않았으면 null.
//
// 한 항목도 고르지 않은 묶음은 계산에서 빼고 나머지 가중치로만 계산한다
// (그 묶음의 비중이 남은 묶음에 비례해 나눠진다). 미확인을 "보통"으로 치지
// 않는 이유: 확인하지 않은 걸 점수로 쳐주면 실제 확인한 항목이 묻힌다.
export function computeOverallScore(values, weights) {
  let weightSum = 0;
  let weighted = 0;
  for (const group of CHECKLIST_GROUPS) {
    const scores = group.items
      .map((item) => itemScore(item.key, values?.[item.key]))
      .filter((score) => score != null);
    if (scores.length === 0) continue;
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const weight = weights[group.key] ?? 0;
    weighted += average * weight;
    weightSum += weight;
  }
  if (weightSum === 0) return null;
  const onThree = weighted / weightSum; // 1~3
  const onFive = ((onThree - 1) / 2) * 4 + 1; // 1~5
  return {
    // 정수로만 보여주면 가중치를 바꿔도 반올림에 묻혀 티가 안 난다.
    score: Math.round(onFive * 10) / 10,
    // DB는 1~5 정수만 받는다(ck_inspections_rating).
    rating: Math.min(5, Math.max(1, Math.round(onFive))),
  };
}
