"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getInsightItems, sourceLink } from "@/lib/insightApi";
import { ChevronDownIcon } from "../icons";

// 분류 목록은 백엔드 응답에서 읽는다. 응답이 유형별로 나뉘어 오고 각 그룹이
// 자기 `category`와 한글 `label`을 같이 주기 때문에(app/subscription/regions.py의
// CATEGORIES, README "그룹 응답 구조" 참고), 프론트가 목록을 따로 들고 있을
// 이유가 없다.
//
// 예전에는 여기에 4가지를 하드코딩해서, 백엔드에 분류가 늘어도 필터에 나타나지
// 않고 항목의 칩도 사라졌다. 이제 새 분류가 생기면 프론트를 고치지 않아도
// 자동으로 필터와 칩에 나타난다(2026-09-16).
//
// 색깔만 알려진 분류에 맞춰 둔다. 모르는 분류는 기본 색(is-other)을 쓴다.
// (병합 메모: 원래 feat 브랜치는 "priority-1" 키를 썼는데, 백엔드
// normalize_category가 응답을 내려줄 때 이미 "general"로 정규화해서 보내서
// 실제로는 한 번도 안 걸리는 키였다 - "general"로 맞춰서 일반공급 칩도 제 색이
// 나오게 고쳤다.)
const CATEGORY_CLASS = {
  general: "is-general",
  "no-rank": "is-no-rank",
  special: "is-special",
  officetel: "is-officetel",
};
const DEFAULT_CATEGORY_CLASS = "is-other";
// "일반공급"은 청약홈에서 1순위/2순위로 나뉘어 접수하지만 백엔드는 이 둘을
// 구분하지 않고 "general" 하나로 묶어 보낸다 - 필터에서만 두 옵션으로 쪼개서
// 보여준다(둘 중 하나를 고르면 실제로는 general 항목이 전부 나온다).
const GENERAL_CATEGORY_OPTIONS = [
  { key: "general-1", label: "일반-1순위", className: "is-general-priority-1", displayLabel: "1순위" },
  { key: "general-2", label: "일반-2순위", className: "is-general-priority-2", displayLabel: "2순위" },
];
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
  // 지금 응답에 들어 있는 분류만 고를 수 있다. 골라 둔 분류가 다음 응답에서
  // 사라지면(그 유형 공고가 없는 날) 그 선택은 무시한다 - 그대로 두면 목록이
  // 비어 보이는데 화면에는 왜 비었는지 드러나지 않는다.
  const categories = state.groups
    .filter(group => group.category)
    .map(group => ({
      key: group.category,
      label: group.label || group.category,
      className: CATEGORY_CLASS[group.category] || DEFAULT_CATEGORY_CLASS,
    }));
  // "일반공급"이 이번 응답에 있으면 필터 옵션에서는 그 자리를 1순위/2순위
  // 두 옵션으로 바꿔치기한다(위 GENERAL_CATEGORY_OPTIONS 주석 참고).
  const hasGeneral = categories.some(category => category.key === "general");
  const categoryOptions = hasGeneral
    ? [...GENERAL_CATEGORY_OPTIONS, ...categories.filter(category => category.key !== "general")]
    : categories;
  const categoryMap = Object.fromEntries(categoryOptions.map(category => [category.key, category]));
  const activeCategories = selectedCategories.filter(key => key in categoryMap);
  const categoryLabel = activeCategories.length === 0
    ? "분류선택"
    : activeCategories.length === 1
      ? categoryMap[activeCategories[0]]?.label || categoryMap[activeCategories[0]]?.displayLabel || "분류"
      : `${categoryMap[activeCategories[0]]?.label || categoryMap[activeCategories[0]]?.displayLabel || "분류"} 외 ${activeCategories.length - 1}개`;
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
      // 다시 불러오는 동안 이전 그룹을 지우지 않는다 - 지우면 분류 목록이 잠깐
      // 비어서, 마감제외를 켜고 끄는 사이에 분류 선택 팝업이 빈 채로 보인다.
      setState(previous => ({ ...previous, loading: true, error: "" }));
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

  useEffect(() => {
    const validKeys = new Set(categoryOptions.map(category => category.key));
    setSelectedCategories(prev => {
      const next = prev.filter(category => validKeys.has(category));
      return next.length === prev.length ? prev : next;
    });
  }, [categoryOptions]);

  // API가 내려준 분류·지역 그룹을 하나의 목록으로 펼친다. 각 항목은
  // 자기 카테고리 칩을 표시하고, 전체를 모집공고일 기준으로 정렬한다.
  const items = state.groups
    .flatMap(group => group.regions.flatMap(region => region.items))
    .filter(item => !excludeClosed || ["upcoming", "open"].includes(item.receipt_status))
    .filter(item => {
      if (activeCategories.length === 0) return true;
      return activeCategories.some(category => {
        if (category === "general-1" || category === "general-2") return item.category === "general";
        return item.category === category;
      });
    })
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
              <button type="button" className={`subscription-region-option subscription-region-option--all ${activeCategories.length === 0 ? "is-active" : ""}`} onClick={() => setSelectedCategories([])}>전체 분류</button>
              {categoryOptions.map(option => {
                const checked = selectedCategories.includes(option.key);
                return (
                  <label key={option.key} className={`subscription-region-option subscription-region-checkbox ${checked ? "is-active" : ""}`}>
                    <input
                      type="checkbox"
                      className="subscription-checkbox-input"
                      checked={checked}
                      onChange={() => setSelectedCategories(prev => (checked ? prev.filter(value => value !== option.key) : [...prev, option.key]))}
                    />
                    <span className={"subscription-checkbox-box" + (checked ? " is-checked" : "")}>
                      {checked && <img className="subscription-checkbox-icon" src="/check-icon.png" alt="" />}
                    </span>
                    <span>{option.label}</span>
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
                // "일반-1순위/2순위" 필터로 보고 있으면 그 라벨을 칩에도 보여준다
                // (실제로는 general 항목 전부가 나온다 - 백엔드가 순위를 안 나눠서
                // 구분해서 보여줄 수 없다).
                // 응답의 분류 목록에 없는 값이라도 칩을 지우지 않는다. 예전에는
                // 모르는 분류면 칩이 통째로 사라져서, 백엔드에 분류가 늘었을 때
                // 화면에서는 아무 표시도 나지 않았다.
                const activeGeneralFilter = activeCategories.length === 1 ? GENERAL_CATEGORY_OPTIONS.find(option => option.key === activeCategories[0]) : null;
                const category = item.category === "general" && activeGeneralFilter
                  ? { key: activeGeneralFilter.key, label: activeGeneralFilter.displayLabel, className: activeGeneralFilter.className }
                  : categoryMap[item.category]
                    || (item.category ? { label: item.category, className: DEFAULT_CATEGORY_CLASS } : null);
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
