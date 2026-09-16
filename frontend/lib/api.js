import { supabase } from "@/lib/supabaseClient";

// 백엔드(FastAPI) 통신 헬퍼. 단지 검색(B-01, GET /search), 단지별 평형
// 목록(B-02, GET /complexes/{id}/sizes), 거래량 유동성(B-06,
// GET /items/{size_id}/liquidity), 전세-매매 갭(GET /items/jeonse-gap-recent),
// 매매/전세 시세 추이(B-05, GET /items/{size_id}/trend,
// GET /items/{size_id}/rent-trend), 거시 데이터 매매가격지수(B-10,
// GET /macro/indices), 생활권 내 단지 랭킹(B-09, GET /items/{size_id}/ranking)이
// 연결돼 있다.
//
// API_BASE_URL은 .env.local의 NEXT_PUBLIC_API_BASE_URL을 쓴다(로컬 기본값은
// http://127.0.0.1:8000/api/v1). NEXT_PUBLIC_ 접두어라
// 브라우저에도 노출되지만 그냥 API 주소일 뿐이라 문제 없음.
// localhost가 아니라 127.0.0.1인 이유: Windows에서 localhost는 IPv6(::1)부터 시도하는데
// 개발 서버(uvicorn)는 127.0.0.1에만 떠 있어, 새 연결마다 약 0.2초씩 늦어진다(2026-09-16 측정).
//
// 2026-09: 로그인 사용자별 관심 매물 저장(A-03~A-08, GET/POST/PATCH/DELETE
// /dashboard/items)도 여기 연결돼 있다. 이 그룹만 로그인이 필수라
// authHeaders()로 Supabase 세션 토큰을 Authorization 헤더에 실어 보낸다.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api/v1";

// 로그인 상태면 현재 Supabase 세션의 access token을 Authorization 헤더로
// 실어 보낸다. 비로그인 상태면 빈 객체 - /dashboard 계열은 이 헤더 없이
// 호출하면 401이 나므로, 호출 자체를 로그인 상태에서만 하도록 호출부
// (components/NaejipsaApp.jsx)에서 user 유무로 막아둔다.
async function authHeaders(expectedUserId) {
  const { data } = await supabase.auth.getSession();
  if (expectedUserId !== undefined &&
      (!expectedUserId || data.session?.user?.id !== expectedUserId)) {
    throw new Error("로그인 상태가 변경되었습니다. 다시 로그인해 주세요.");
  }
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 단지명/법정동명 키워드로 단지 검색 (B-01).
// 반환 형태(백엔드 응답 그대로): [{ complex_id, complex_name, legal_dong_name, address, build_year }]
export async function searchComplexes(keyword) {
  const res = await fetch(
    `${API_BASE_URL}/search?keyword=${encodeURIComponent(keyword)}`
  );
  if (!res.ok) {
    throw new Error(`search failed with status ${res.status}`);
  }
  return res.json();
}

// 단지 상세페이지에 진입했을 때 이 단지에 실제로 존재하는 평형 목록 (B-02).
// 반환 형태(백엔드 응답 그대로): [{ size_id, representative_area, pyeong, recent_median_price, trade_count_3y }]
export async function getComplexSizes(complexId) {
  const res = await fetch(`${API_BASE_URL}/complexes/${complexId}/sizes`);
  if (!res.ok) {
    throw new Error(`get sizes failed with status ${res.status}`);
  }
  return res.json();
}

// 단지의 투기과열지구/조정대상지역 지정 여부 (B-12). 대상 아니어도 에러가
// 아니라 두 값 다 false로 온다. 로그인 불필요(공개 정보).
// 반환 형태(백엔드 응답 그대로): { complex_id, is_speculation_overheated, is_adjustment_target }
export async function getComplexRegulationStatus(complexId) {
  const res = await fetch(`${API_BASE_URL}/complexes/${complexId}/regulation-status`);
  if (!res.ok) {
    throw new Error(`get regulation status failed with status ${res.status}`);
  }
  return res.json();
}

// 평형(size_id)의 거래량 유동성 (B-06). period는 3/12/36(개월) 중 하나.
// 반환 형태(백엔드 응답 그대로): { size_id, period_months, sale_count, jeonse_count }
export async function getLiquidity(sizeId, periodMonths) {
  const res = await fetch(
    `${API_BASE_URL}/items/${sizeId}/liquidity?period=${periodMonths}`
  );
  if (!res.ok) {
    throw new Error(`get liquidity failed with status ${res.status}`);
  }
  return res.json();
}

// 여러 평형의 전세-매매 갭을 한 번에 조회. sizeIds는 숫자 배열.
// ⚠️ 백엔드 /items/jeonse-gap(B-08, 팀 확정 3단계 기간완화 로직)과는 다른
// 엔드포인트다 — 이 /jeonse-gap-recent는 매매/전세 각각 "최근 실거래
// 10건의 중앙값"만 단순 비교한다(2026-09 프론트 요구사항). 반환 형태(백엔드
// 응답 그대로): { items: [{ size_id, sample_insufficient, sale_median?,
// jeonse_median?, gap_amount?, gap_ratio?, message? }] }
export async function getJeonseGapRecent(sizeIds) {
  const res = await fetch(
    `${API_BASE_URL}/items/jeonse-gap-recent?ids=${sizeIds.join(",")}`
  );
  if (!res.ok) {
    throw new Error(`get jeonse-gap-recent failed with status ${res.status}`);
  }
  return res.json();
}

// 평형(size_id)의 매매 시세 추이 (B-05). months는 조회 개월 수.
// 반환 형태(백엔드 응답 그대로): { size_id, monthly_median_prices: [{ year_month, median_price }], trend_direction }
export async function getPriceTrend(sizeId, months) {
  const res = await fetch(`${API_BASE_URL}/items/${sizeId}/trend?months=${months}`);
  if (!res.ok) {
    throw new Error(`get price trend failed with status ${res.status}`);
  }
  return res.json();
}

// 평형(size_id)의 전세 시세 추이. months는 조회 개월 수.
// 반환 형태(백엔드 응답 그대로): { size_id, monthly_median_prices: [{ year_month, median_price }] }
export async function getRentTrend(sizeId, months) {
  const res = await fetch(`${API_BASE_URL}/items/${sizeId}/rent-trend?months=${months}`);
  if (!res.ok) {
    throw new Error(`get rent trend failed with status ${res.status}`);
  }
  return res.json();
}

// 평형(size_id)의 개별 실거래가 포인트 + 기간 내 평균가(실거래 분포도 차트 전용).
// months는 3/12/36, type은 "sale"(매매) | "jeonse"(전세).
// 반환 형태(백엔드 응답 그대로): { size_id, months, type, count, average_price,
// points: [{ deal_amount, deal_year, deal_month, floor }] }
export async function getTradePoints(sizeId, months, type) {
  const res = await fetch(
    `${API_BASE_URL}/items/${sizeId}/trade-points?months=${months}&type=${type}`
  );
  if (!res.ok) {
    throw new Error(`get trade points failed with status ${res.status}`);
  }
  return res.json();
}

// 거시 데이터: 매매가격지수 + 매매수급동향지수 (B-10). 매물 단위가 아니라
// 전국 단위 지표라 sizeId 없이 기간(개월 수)만 받는다. 가격지수는 월단위라
// months를 그대로 "최근 N개월" 자르기 기준으로 쓴다(백엔드 주석 참고).
// 반환 형태(백엔드 응답 그대로): { region, months, price_index: [{ period,
// value }], price_index_error, supply_demand, supply_demand_error, ... }
export async function getMacroIndices(months) {
  const res = await fetch(`${API_BASE_URL}/macro/indices?months=${months}`);
  if (!res.ok) {
    throw new Error(`get macro indices failed with status ${res.status}`);
  }
  return res.json();
}

// 평형(size_id)의 생활권 내 단지 랭킹 (B-09). 같은 구(sgg_cd) + 비슷한
// 평형(±5㎡) 단지들과 평단가(price_per_pyeong)를 비교해 순위를 매긴
// 결과를 그대로 준다 — "아이템과 동일한 구에 속하는 아파트의 수/평단가
// 비교" 요구사항(2026-09)에 이미 백엔드가 구해둔 값을 그대로 쓴다.
// 반환 형태(백엔드 응답 그대로, 데이터 부족 시 my_rank 등이 없고
// error만 옴): { size_id, area_scope, my_rank?, total?,
// my_price_per_pyeong?, top_complex?, top_price_per_pyeong?,
// all_price_per_pyeong?, error? }
export async function getAreaRanking(sizeId) {
  const res = await fetch(`${API_BASE_URL}/items/${sizeId}/ranking`);
  if (!res.ok) {
    throw new Error(`get area ranking failed with status ${res.status}`);
  }
  return res.json();
}
// --- A-03~A-08: 로그인 사용자의 관심 매물(후보) CRUD -----------------------
// 백엔드 app/dashboard/router.py 참고. 전부 로그인 필수(Authorization 헤더).

// A-04: 내 후보 목록. 단지명·평형·시세 지표까지 함께 온다.
// 반환 형태(백엔드 응답 그대로): { items: [...], count, max_count }
export async function getDashboardItems() {
  const res = await fetch(`${API_BASE_URL}/dashboard/items`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`get dashboard items failed with status ${res.status}`);
  }
  return res.json();
}

// A-03: 후보 등록. size_id만 필수, 나머지 매물 정보는 선택.
export async function createDashboardItem(payload) {
  const res = await fetch(`${API_BASE_URL}/dashboard/items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`create dashboard item failed with status ${res.status}`);
  }
  return res.json();
}

// A-06: 선택 매물정보 수정(호가/층/동/호/향/인테리어). 보낸 필드만 바뀌고,
// null을 보내면 그 필드는 지워진다.
export async function updateDashboardItemDetails(itemId, payload) {
  const res = await fetch(
    `${API_BASE_URL}/dashboard/items/${itemId}/details`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(`update dashboard item failed with status ${res.status}`);
  }
  return res.json();
}

// A-08: 후보 삭제.
export async function deleteDashboardItem(itemId) {
  const res = await fetch(`${API_BASE_URL}/dashboard/items/${itemId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`delete dashboard item failed with status ${res.status}`);
  }
  return res.json();
}

// 정렬 저장(Phase 3 보완): 내 전체 후보의 표시 순서를 한 번에 저장한다.
// expectedItemIds는 드래그를 시작하기 전에 마지막으로 서버에서 확인한 순서다 - 다른 탭·기기에서
// 목록이 바뀌었으면 서버가 저장하지 않고 409를 준다. userId로 요청 시점의 로그인 계정을
// 확인한다(계정이 바뀌었으면 보내지 않는다). 실패하면 서버 안내 문구와 status를 담아 던진다.
// 반환 형태: { item_ids: [...] }
export async function reorderDashboardItems(itemIds, expectedItemIds, userId) {
  const res = await fetch(`${API_BASE_URL}/dashboard/items/order`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders(userId ?? null)) },
    body: JSON.stringify({ item_ids: itemIds, expected_item_ids: expectedItemIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(body?.error?.message || "순서를 저장하지 못했어요.");
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// 기존 세션과 프로필 API를 재사용한다. 계정 전환 중 이전 화면의 쓰기는 막는다.
async function profileResponse(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || "프로필을 처리하지 못했어요. 다시 시도해 주세요.");
  }
  return res.json();
}

export async function getMyProfile(userId) {
  const res = await fetch(`${API_BASE_URL}/users/me/profile`, {
    headers: await authHeaders(userId ?? null),
  });
  return profileResponse(res);
}

export async function updateMyProfile(payload, userId) {
  const res = await fetch(`${API_BASE_URL}/users/me/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders(userId ?? null)) },
    body: JSON.stringify(payload),
  });
  return profileResponse(res);
}

export async function createDashboardInsight(itemIds, userId) {
  // 기존 API에서 빈 목록은 전체 후보를 뜻하므로 선택이 없으면 호출하지 않는다.
  if (!itemIds.length) throw new Error("분석할 관심 매물을 선택해 주세요.");
  const res = await fetch(`${API_BASE_URL}/dashboard/insight`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(userId ?? null)) },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || "AI 분석을 불러오지 못했어요. 다시 시도해 주세요.");
  }
  return res.json();
}

// --- Phase 4: 후보 그룹 -----------------------------------------------------
// 백엔드 app/group/router.py 참고. 전부 로그인 필수(Authorization 헤더).
// 그룹은 기존 후보를 가리키기만 하므로 어떤 호출도 후보(dashboard_items)를 지우거나
// 새로 만들지 않는다. 실패하면 서버의 한국어 안내(error.message)를 그대로 던진다.
const GROUP_FALLBACK_MESSAGE = "그룹을 처리하지 못했어요. 잠시 후 다시 시도해주세요.";

async function groupRequest(path, { method = "GET", body } = {}) {
  const headers = await authHeaders();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/groups${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(GROUP_FALLBACK_MESSAGE);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error?.message || GROUP_FALLBACK_MESSAGE);
  }
  return res.json();
}

// 내 그룹 목록. 반환 형태: { groups: [{ id, name, item_count, share_link_count, created_at, updated_at }], count, max_count }
// share_link_count는 지금 살아 있는 공유 링크 수(0이면 공유하지 않는 그룹).
export function getGroups() {
  return groupRequest("");
}

// 그룹 상세. 반환 형태: { id, name, item_count, item_ids: [후보 id], items: [후보 목록과 같은 모양] }
export function getGroup(groupId) {
  return groupRequest(`/${groupId}`);
}

// 그룹 만들기. itemIds가 비어 있으면 빈 그룹이다. 다른 그룹의 item_ids를 넘기면
// "이 그룹으로 새 그룹 만들기"가 된다(원래 그룹은 그대로). 반환 형태는 getGroup과 같다.
export function createGroup(name, itemIds = []) {
  return groupRequest("", { method: "POST", body: { name, item_ids: itemIds } });
}

export function renameGroup(groupId, name) {
  return groupRequest(`/${groupId}`, { method: "PATCH", body: { name } });
}

// 그룹 삭제. 그룹에 들어 있던 후보는 그대로 남는다.
export function deleteGroup(groupId) {
  return groupRequest(`/${groupId}`, { method: "DELETE" });
}

// 기존 그룹에 후보 추가. 이미 그 그룹에 있는 후보가 섞이면 하나도 넣지 않고 409.
export function addGroupItems(groupId, itemIds) {
  return groupRequest(`/${groupId}/items`, { method: "POST", body: { item_ids: itemIds } });
}

// 그룹에서 빼기. 후보는 그대로 남는다.
export function removeGroupItem(groupId, itemId) {
  return groupRequest(`/${groupId}/items/${itemId}`, { method: "DELETE" });
}

// --- 그룹 공유 링크 (Phase 5) ---------------------------------------------------
// 백엔드 app/group/router.py 참고. 링크는 그룹 주인만 만들고 끊는다. 받은 사람은 로그인 없이
// 그 그룹의 지금 후보를 본다(getSharedGroup). 링크를 열기만 해서는 아무것도 저장되지 않는다.

// 공유 링크 만들기. 반환 형태: { id, token, created_at } - token은 이 응답에서만 받을 수 있다.
export function createGroupShareLink(groupId) {
  return groupRequest(`/${groupId}/share-links`, { method: "POST" });
}

// 공유 중지 - 이 그룹으로 만든 링크를 모두 끊는다. 반환 형태: { revoked_count }
export function revokeGroupShareLinks(groupId) {
  return groupRequest(`/${groupId}/share-links`, { method: "DELETE" });
}

// 그룹 공유 링크 열람 - 로그인 불필요(authHeaders 안 붙임). 공유를 중지하면 바로 안 보여야 하므로
// 브라우저 캐시를 쓰지 않는다. 반환 형태: { name, items: [{ size_id, dong, ho, complex_name, metrics, ... }], count }
export async function getSharedGroup(token) {
  const res = await fetch(`${API_BASE_URL}/shared/groups/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) {
    const error = new Error(`get shared group failed with status ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// --- 공유 -------------------------------------------------------------------
// 백엔드 app/dashboard/router.py의 /dashboard/shares 참고. "만들기"만 로그인 필수고,
// "열람"(getDashboardShare)은 링크만 있으면 누구나 볼 수 있어야 하므로
// authHeaders를 붙이지 않는다.

// 지금 관심 매물로 공유 링크(토큰)를 만든다. 반환 형태: { token }
export async function createDashboardShare() {
  const res = await fetch(`${API_BASE_URL}/dashboard/shares`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`create dashboard share failed with status ${res.status}`);
  }
  return res.json();
}

// 공유 링크 미리보기 - 로그인 불필요(authHeaders 안 붙임). 반환 형태:
// { items: [{size_id, ..., complex_name, metrics, ...}], count }
export async function getDashboardShare(token) {
  const res = await fetch(`${API_BASE_URL}/dashboard/shares/${token}`);
  if (!res.ok) {
    throw new Error(`get dashboard share failed with status ${res.status}`);
  }
  return res.json();
}

// AI-01: 등록된 매물(관심 매물)에 대한 AI 종합 분석 (POST /dashboard/insight).
// itemIds를 안 넘기면 로그인 사용자의 관심 매물 전체를 대상으로 한다.
// 반환 형태: { summary, items: [{id, strengths, weaknesses}], generated_at }
//
// 다른 함수들과 달리 실패 사유를 UI에 그대로 보여줘야 해서(설정 안 됨/후보
// 없음/외부 LLM 일시 장애를 서로 다른 문구로 안내) 응답 body의 detail을
// 파싱해 에러 메시지에 싣는다. 백엔드가 항상 FastAPI 기본 에러 형식
// ({"detail": "..."})으로 응답하므로(app/insight/router.py) 이 값을 우선
// 쓰고, 파싱 실패 시에만 상태 코드 기반 문구로 대체한다.
export async function createInsight(itemIds) {
  const res = await fetch(`${API_BASE_URL}/dashboard/insight`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(itemIds && itemIds.length ? { item_ids: itemIds } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const error = new Error(
      body?.detail || `create insight failed with status ${res.status}`
    );
    error.status = res.status;
    throw error;
  }
  return res.json();
}
