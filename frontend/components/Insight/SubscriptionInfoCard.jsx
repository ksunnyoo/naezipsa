"use client";

import { useEffect, useRef, useState } from "react";
import { getInsightItems, sourceLink } from "@/lib/insightApi";
import { ChevronDownIcon } from "../icons";

// 백엔드가 실제로 만들어내는 분류는 이 4가지뿐이다(도시형생활주택처럼 여기
// 안 걸리는 유형은 애초에 응답에 들어오지 않는다 - app/subscription/
// cheongyak_home.py, tests/test_subscription.py 참고). 새 분류가 추가되면
// 여기에도 같이 추가해야 필터에 나타난다.
const CATEGORIES = [
  { key: "priority-1", label: "1순위", className: "is-priority" },
  { key: "no-rank", label: "무순위/잔여세대", className: "is-no-rank" },
  { key: "special", label: "특별공급", className: "is-special" },
  { key: "officetel", label: "오피스텔", className: "is-officetel" },
];
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(category => [category.key, category]));
const STATUS_LABELS = { closed: "마감", open: "접수 중", upcoming: "접수 예정" };
// 분류/지역 선택 팝업이 아래로 펼쳐질 공간이 부족하면(.subscription-region-options의
// CSS max-height 240px + 트리거와의 간격 6px) 그만큼 뷰포트 아래쪽 여유가 없다는
// 뜻이고, 그 상태로 펼치면 팝업이 뷰포트 밖으로 밀려나 전체 화면에 스크롤이
// 생긴다(인사이트 영역 높이를 키운 뒤로 청약 카드가 낮아지면서 자주 발생). 트리거
// 버튼 기준 아래 공간이 부족하면 위로 펼치도록(is-drop-up) 판단한다.
const POPUP_CLEARANCE = 246;
function needsDropUp(triggerEl) {
  if (!triggerEl) return false;
  const { bottom } = triggerEl.getBoundingClientRect();
  return window.innerHeight - bottom < POPUP_CLEARANCE;
}

export default function SubscriptionInfoCard({ refreshKey = "", referenceSizeId }) {
  const [state, setState] = useState({ groups: [], loading: true, error: "", guest: false });
  const [attempt, setAttempt] = useState(0);
  const [excludeClosed, setExcludeClosed] = useState(false);
  // 여러 지역/분류를 동시에 선택할 수 있어야 해서 문자열 하나가 아니라
  // 배열로 관리한다. 빈 배열은 "전체"를 뜻한다.
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryDropUp, setCategoryDropUp] = useState(false);
  const categoryPicker = useRef(null);
  const [selectedRegions, setSelectedRegions] = useState([]);
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionDropUp, setRegionDropUp] = useState(false);
  const regionPicker = useRef(null);
  const regionNames = ["서울", "경기", "인천", "강원", "충북", "충남", "세종", "대전", "전북", "전남", "광주", "경북", "대구", "경남", "울산", "부산", "제주"];
  const categoryLabel = selectedCategories.length === 0
    ? "분류선택"
    : selectedCategories.length === 1
      ? CATEGORY_MAP[selectedCategories[0]]?.label
      : `${CATEGORY_MAP[selectedCategories[0]]?.label} 외 ${selectedCategories.length - 1}개`;
  const regionLabel = selectedRegions.length === 0
    ? "지역선택"
    : selectedRegions.length === 1
      ? selectedRegions[0]
      : `${selectedRegions[0]} 외 ${selectedRegions.length - 1}곳`;
  useEffect(() => {
    if (!categoryOpen) return;
    const close = event => { if (!categoryPicker.current?.contains(event.target)) setCategoryOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [categoryOpen]);
  useEffect(() => {
    if (!regionOpen) return;
    const close = event => { if (!regionPicker.current?.contains(event.target)) setRegionOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [regionOpen]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setState({ groups: [], loading: true, error: "" });
      if (!referenceSizeId) {
        setState({ groups: [], loading: false, error: "기준 매물의 지역 정보를 확인할 수 없습니다.", retryable: false });
        return;
      }
      try {
        const groups = await getInsightItems(`/subscription/nearby?size_id=${encodeURIComponent(referenceSizeId)}&limit_per_region=30&exclude_closed=${excludeClosed}`, controller.signal);
        if (!controller.signal.aborted) setState({ groups, loading: false, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setState({ groups: [], loading: false, error: error.message, retryable: error.retryable !== false });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, refreshKey, referenceSizeId, excludeClosed]);

  // 분류(1순위/무순위/특별공급/오피스텔)·지역별로 나뉘어 오는 응답을 하나의
  // 목록으로 펼친다 - 항목마다 자기 분류를 칩으로 보여주고, 전체를
  // 모집공고일 최신순으로 정렬한다(그룹으로 나눠 보여주지 않는다).
  const items = state.groups
    .flatMap(group => group.regions.flatMap(region => region.items))
    .filter(item => !excludeClosed || ["upcoming", "open"].includes(item.receipt_status))
    .filter(item => selectedCategories.length === 0 || selectedCategories.includes(item.category))
    .filter(item => selectedRegions.length === 0 || selectedRegions.includes(item.region))
    .sort((a, b) => (b.announced_at || "").localeCompare(a.announced_at || ""));

  return (
    <div className="insight-card" data-component="SubscriptionInfoCard">
      <div className="insight-card-header">
        <span className="insight-card-title">청약 정보</span>
        <div className="subscription-filters">
          <button type="button" className={`subscription-filter ${excludeClosed ? "is-active" : ""}`} aria-pressed={excludeClosed} onClick={() => setExcludeClosed(value => !value)}><span aria-hidden="true">✓</span> 마감제외</button>
          <span className="subscription-filter-divider" aria-hidden="true">|</span>
          <div className="subscription-region-picker" ref={categoryPicker} onKeyDown={event => { if (event.key === "Escape") { setCategoryOpen(false); categoryPicker.current?.querySelector("button")?.focus(); } }}>
            <button type="button" className={`subscription-filter subscription-region-trigger ${selectedCategories.length > 0 || categoryOpen ? "is-active" : ""}`} aria-expanded={categoryOpen} aria-controls="subscription-category-options" onClick={event => { if (!categoryOpen) setCategoryDropUp(needsDropUp(event.currentTarget)); setCategoryOpen(value => !value); }}>
              <span>{categoryLabel}</span>
              <span className={`subscription-region-chevron ${categoryOpen ? "is-open" : ""}`} aria-hidden="true"><ChevronDownIcon /></span>
            </button>
            {categoryOpen && <div id="subscription-category-options" className={"subscription-region-options" + (categoryDropUp ? " is-drop-up" : "")} role="group" aria-label="청약 분류 선택">
              <button type="button" className={`subscription-region-option subscription-region-option--all ${selectedCategories.length === 0 ? "is-active" : ""}`} onClick={() => setSelectedCategories([])}>전체 분류</button>
              {CATEGORIES.map(category => {
                const checked = selectedCategories.includes(category.key);
                return (
                  <label key={category.key} className={`subscription-region-option subscription-region-checkbox ${checked ? "is-active" : ""}`}>
                    <input
                      type="checkbox"
                      className="subscription-checkbox-input"
                      checked={checked}
                      onChange={() => setSelectedCategories(prev => (checked ? prev.filter(value => value !== category.key) : [...prev, category.key]))}
                    />
                    <span className={"subscription-checkbox-box" + (checked ? " is-checked" : "")}>
                      {checked && <img className="subscription-checkbox-icon" src="/check-icon.png" alt="" />}
                    </span>
                    <span>{category.label}</span>
                  </label>
                );
              })}
            </div>}
          </div>
          <span className="subscription-filter-divider" aria-hidden="true">|</span>
          <div className="subscription-region-picker" ref={regionPicker} onKeyDown={event => { if (event.key === "Escape") { setRegionOpen(false); regionPicker.current?.querySelector("button")?.focus(); } }}>
            <button type="button" className={`subscription-filter subscription-region-trigger ${selectedRegions.length > 0 || regionOpen ? "is-active" : ""}`} aria-expanded={regionOpen} aria-controls="subscription-region-options" onClick={event => { if (!regionOpen) setRegionDropUp(needsDropUp(event.currentTarget)); setRegionOpen(value => !value); }}>
              <span>{regionLabel}</span>
              <span className={`subscription-region-chevron ${regionOpen ? "is-open" : ""}`} aria-hidden="true"><ChevronDownIcon /></span>
            </button>
            {regionOpen && <div id="subscription-region-options" className={"subscription-region-options" + (regionDropUp ? " is-drop-up" : "")} role="group" aria-label="청약 지역 선택">
              <button type="button" className={`subscription-region-option subscription-region-option--all ${selectedRegions.length === 0 ? "is-active" : ""}`} onClick={() => setSelectedRegions([])}>전체 지역</button>
              {regionNames.map(region => {
                const checked = selectedRegions.includes(region);
                return (
                  <label key={region} className={`subscription-region-option subscription-region-checkbox ${checked ? "is-active" : ""}`}>
                    <input
                      type="checkbox"
                      className="subscription-checkbox-input"
                      checked={checked}
                      onChange={() => setSelectedRegions(prev => (checked ? prev.filter(value => value !== region) : [...prev, region]))}
                    />
                    <span className={"subscription-checkbox-box" + (checked ? " is-checked" : "")}>
                      {checked && <img className="subscription-checkbox-icon" src="/check-icon.png" alt="" />}
                    </span>
                    <span>{region}</span>
                  </label>
                );
              })}
            </div>}
          </div>
        </div>
      </div>
      {state.error && <p className="news-message news-error" role="alert">{state.error} {state.retryable && <button type="button" onClick={() => setAttempt(a => a + 1)}>다시 시도</button>}</p>}
      <div className="subscription-list" aria-live="polite">
        {state.loading ? <p className="news-message">청약 정보를 불러오는 중입니다.</p>
          : state.error ? <p className="news-message">현재 정보를 확인할 수 없습니다.</p>
            : items.length === 0 ? <p className="news-message">조건에 맞는 데이터가 없습니다.</p>
              : items.map(item => {
                const category = CATEGORY_MAP[item.category];
                return (
                  <a key={`${item.announcement_no}-${item.category}`} href={sourceLink(item.source_url)} target="_blank" rel="noopener noreferrer" className="subscription-row">
                    <div className="subscription-row-top">
                      <span className="subscription-row-name">{item.house_name}</span>
                      <div className="subscription-row-tags">
                        {category && <span className={`subscription-item-category ${category.className}`}>{category.label}</span>}
                        <span className={`subscription-status is-${item.receipt_status || "unknown"}`}>{STATUS_LABELS[item.receipt_status] || "일정 확인"}</span>
                      </div>
                    </div>
                    <span className="subscription-row-address">{item.address}</span>
                    <div className="subscription-row-meta">
                      <span className="subscription-meta-chip">모집공고일</span>
                      <span className="subscription-meta-text">{item.announced_at || "미제공"}</span>
                      <span className="subscription-meta-divider" aria-hidden="true">|</span>
                      <span className="subscription-meta-chip">접수</span>
                      <span className="subscription-meta-text">{item.receipt_start}{item.receipt_end !== item.receipt_start ? ` ~ ${item.receipt_end}` : ""}</span>
                    </div>
                  </a>
                );
              })}
      </div>
    </div>
  );
}
