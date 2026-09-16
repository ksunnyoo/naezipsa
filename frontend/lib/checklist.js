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
// 지금은 화면(체크리스트 입력 UI)만 만들고 백엔드 저장은 아직 연결하지
// 않았다 - EditListingDialog가 이 키들을 기준으로 로컬 state만 들고 있다가,
// 나중에 저장 API가 생기면 이 스키마(각 item.key -> 숫자값|null) 그대로
// body에 실어 보내면 된다.
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
