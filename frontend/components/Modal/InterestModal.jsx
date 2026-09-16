"use client";

import { useEffect, useRef, useState } from "react";
import ChipGroup from "../ChipGroup";
import {
  BackArrowIcon,
  CloseIcon,
  SearchIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "../icons";
import { DIRECTIONS, INTERIORS, dealCountLabel, formatEokLabel } from "@/lib/data";
import { searchComplexes, getComplexSizes } from "@/lib/api";

// <InterestModal open onClose onSubmit /> : 오른쪽에서 슬라이드되는 매물 검색/
// 추가 패널. SearchStep/SizeSelectStep/DetailStep(+DetailAccordion)을 이
// 파일 안에 작은 컴포넌트로 나눠뒀다 — 다섯 화면이 전부 같은 내부 state를
// 공유하며 서로 긴밀히 얽혀 있어(예: DetailStep의 향/인테리어 선택이 바로
// 최종 제출값이 됨), 파일을 쪼개는 것보다 여기서 관리하는 편이 오히려
// 추적하기 쉽다.
//
// ⚠ 아래 "검색 결과 선택" 부분은 프로토타입에서 실제 맥북 사파리로 여러 번
// 검증한 브라우저 버그 우회 로직이다 — React로 옮기면서도 반드시 그대로
// 유지해야 한다(자세한 배경은 원본 프로토타입 파일의 Next.js 변환 가이드
// 주석 5~6번 참고):
//   1) 타이핑 중에는 결과 리스트를 갱신하지 않는다 — Enter/검색 버튼을 눌러야
//      committedQuery가 갱신되고 그 시점에만 결과가 나타난다.
//   2) 결과 버튼은 COMPLEXES 전체를 항상 렌더링해두고, 매칭 안 되는 것만
//      hidden 처리한다(필터링해서 갯수 자체를 줄이지 않음).
//   3) 결과 리스트 wrapper는 한 번 보여준 뒤로는 다시 hidden 처리하지 않는다
//      (개별 행만 hidden 토글) — 재검색할 때마다 등장 애니메이션이 다시
//      재생되어 깜빡이는 문제를 막기 위함.
//   4) 결과 선택은 mousedown 시점에 어떤 단지를 눌렀는지 pendingSelectId(ref)에
//      기록해두고, click에서 그 값을 그대로 확정 처리한다 — click의 e.target을
//      바로 믿지 않는다.
//
// 2026-09 업데이트: 검색 단계가 목업 COMPLEXES 대신 실 백엔드(GET /search)를
// 쓰도록 바뀌면서 위 2번 기법(전체 렌더 후 hidden)은 더 이상 적용하지 않는다
// — 서버가 키워드로 이미 걸러서 최대 20건만 주기 때문에 "전체 목록"이라는
// 개념 자체가 없어졌다. 대신 slideDown 애니메이션은 각 행이 아니라 그 부모인
// .result-list(래퍼) 하나에만 걸려 있고, 그 래퍼는 3번 규칙대로 한 번
// 마운트된 뒤 계속 유지되므로 재검색으로 행 내용이 바뀌어도 애니메이션 재생
// 문제는 그대로 방지된다. 1)/3)/4)는 데이터 출처와 무관한 규칙이라 그대로 유지.
// 평형 선택(이후 화면)은 아직 목업 — 다음 단계에서 실 데이터로 교체될 자리.

// 백엔드 /search 응답 한 건을 SizeSelectStep/DetailStep이 기대하는 "complex"
// 모양으로 변환한다. 평형(sizes)과 regulations(규제 뱃지) 둘 다 검색 API
// 응답에는 없어서 일단 빈 배열로 두고, 단지를 선택하는 시점에 각각
// /complexes/{id}/sizes, /complexes/{id}/regulation-status로 따로 불러와
// 채운다(handleSelectComplex 참고). 토지거래허가구역은 여기 없다 - 별개 법
// 조항 지정이라 투기과열/조정대상 두 값으로 유추할 수 없어, 그 데이터가
// 따로 들어오기 전까지는 만들어서 보여주지 않는다.
function toSearchComplexShape(apiResult) {
  return {
    id: `api-${apiResult.complex_id}`,
    complexId: apiResult.complex_id,
    name: apiResult.complex_name,
    region: apiResult.address,
    built: apiResult.build_year ? `${apiResult.build_year}년 준공` : "준공년도 정보 없음",
    dealCount: apiResult.size_count,
    regulations: [],
    sizes: [],
  };
}

// 백엔드 /complexes/{id}/sizes 응답 한 건을 SizeSelectStep/DetailStep이
// 기대하는 "size" 모양({label, price})으로 변환한다.
function toSizeShape(raw) {
  // 평(pyeong) 표기는 빼고 제곱미터만 보여준다 — 2026-09 요청.
  const label = raw.representative_area != null ? `${raw.representative_area}㎡` : `평형 ${raw.size_id}`;
  const eokLabel = formatEokLabel(raw.recent_median_price);
  return {
    label,
    price: eokLabel ? `최근거래가 ${eokLabel}` : "실거래 데이터 부족",
    sizeId: raw.size_id,
  };
}

export default function InterestModal({ open, onClose, onSubmit }) {
  const [screen, setScreen] = useState("search"); // 'search' | 'size' | 'detail'
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState(null); // null = 아직 검색 안 함
  const [resultsEverShown, setResultsEverShown] = useState(false);
  const [complex, setComplex] = useState(null);
  const [size, setSize] = useState(null);
  const [price, setPrice] = useState("");
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [floor, setFloor] = useState("");
  const [dong, setDong] = useState("");
  const [ho, setHo] = useState("");
  const [direction, setDirection] = useState(null);
  const [interior, setInterior] = useState(null);

  // 검색이 실 API 호출이라 로딩/에러 상태와 결과 배열을 따로 들고 있어야
  // 한다. results는 toSearchComplexShape()로 변환된 상태로 저장한다 —
  // SizeSelectStep/DetailStep이 COMPLEXES 항목과 같은 모양을 기대하기 때문.
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // 평형 목록도 별도 API 호출(GET /complexes/{id}/sizes)이라 로딩/에러
  // 상태가 따로 필요하다.
  const [sizesLoading, setSizesLoading] = useState(false);
  const [sizesError, setSizesError] = useState(null);

  const searchInputRef = useRef(null);
  const pendingSelectId = useRef(null);
  // 평형 목록을 불러오는 도중 사용자가 다른 단지를 다시 선택하면, 먼저 보낸
  // 요청이 나중에 응답으로 돌아와 엉뚱한 단지의 평형 목록을 덮어쓸 수 있다.
  // 지금 "유효한" 요청의 complexId를 기록해두고, 응답이 왔을 때 이 값과
  // 다르면(그 사이에 다른 단지를 선택했으면) 무시한다.
  const activeSizesComplexId = useRef(null);

  // 모달이 열릴 때마다(open이 false→true로 바뀔 때) 내부 state를 전부
  // freshState()에 해당하는 초기값으로 되돌린다. useEffect 안에서 setState를
  // 연쇄로 호출하는 대신(react-hooks/set-state-in-effect가 경고하는, 불필요한
  // 리렌더를 유발하는 패턴), React 공식 문서가 권장하는 "렌더링 중 state
  // 조정" 패턴을 쓴다 — prevOpen과 open을 비교해 막 열린 순간에만, 렌더링
  // 도중 동기적으로 리셋한다.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setScreen("search");
      setQuery("");
      setCommittedQuery(null);
      setResultsEverShown(false);
      setComplex(null);
      setSize(null);
      setPrice("");
      setAccordionOpen(false);
      setFloor("");
      setDong("");
      setHo("");
      setDirection(null);
      setInterior(null);
      setResults([]);
      setSearchLoading(false);
      setSearchError(null);
      setSizesLoading(false);
      setSizesError(null);
      // activeSizesComplexId(ref)는 여기서 안 건드린다 — 렌더링 도중 ref를
      // 쓰면 react-hooks/refs 룰에 걸린다. 안 지워도 안전한 이유: 아래
      // handleSelectComplex의 setComplex 콜백이 prev.complexId === c.complexId를
      // 다시 확인하므로, 모달을 닫았다 열어 complex가 null로 리셋된 뒤에
      // 이전 요청이 뒤늦게 돌아와도 그냥 무시된다.
    }
  }

  // 검색창 포커스는 실제 DOM을 건드리는 부수효과라 useEffect가 맞는 자리.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 모달이 열려있는 동안 배경 스크롤 잠금.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // 검색 커밋 시 실 API를 부른다(단지 선택 후 평형 목록도 실 API — 아래
  // handleSelectComplex 참고).
  async function commitSearch() {
    const q = query.trim();
    setCommittedQuery(q);
    if (!q) {
      setResults([]);
      return;
    }
    setResultsEverShown(true);
    setSearchLoading(true);
    setSearchError(null);
    try {
      const apiResults = await searchComplexes(q);
      setResults(apiResults.map(toSearchComplexShape));
    } catch (err) {
      setResults([]);
      setSearchError("검색 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleSelectComplex(id) {
    const c = results.find((x) => x.id === id);
    if (!c) return;
    setComplex(c);
    setSize(null);
    setScreen("size");

    activeSizesComplexId.current = c.complexId;
    setSizesLoading(true);
    setSizesError(null);
    try {
      const rawSizes = await getComplexSizes(c.complexId);
      if (activeSizesComplexId.current !== c.complexId) return; // 그 사이 다른 단지로 바뀜 — 무시
      setComplex((prev) =>
        prev && prev.complexId === c.complexId
          ? { ...prev, sizes: rawSizes.map(toSizeShape), dealCount: rawSizes.length }
          : prev
      );
    } catch (err) {
      if (activeSizesComplexId.current !== c.complexId) return;
      setSizesError("평형 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      if (activeSizesComplexId.current === c.complexId) setSizesLoading(false);
    }

    // 규제 뱃지는 부가 정보라 실패해도 조용히 무시한다(빈 배열 유지 -
    // InterestCard가 "규제 해당 없음"으로 보여줌) - 평형 조회 실패처럼
    // 화면을 막는 에러로 취급하지 않는다.
    try {
      const status = await getComplexRegulationStatus(c.complexId);
      if (activeSizesComplexId.current !== c.complexId) return;
      setComplex((prev) =>
        prev && prev.complexId === c.complexId
          ? { ...prev, regulations: regulationsFromBackend(status) }
          : prev
      );
    } catch {
      // 무시 - 위 주석 참고.
    }
  }

  const backLinkHidden = screen === "search";
  const canSubmit = complex && size !== null;

  function handleFooterClick() {
    if (!canSubmit) return;
    const sizeInfo = complex.sizes[size];
    onSubmit({
      name: complex.name,
      sizeLabel: sizeInfo.label,
      price,
      floor,
      dong,
      ho,
      direction,
      interior,
      regulations: complex.regulations || [],
      // 차트(거래량 유동성 등)가 실거래 데이터를 불러올 때 쓰는 백엔드 식별자.
      complexId: complex.complexId,
      sizeId: sizeInfo.sizeId,
    });
  }

  return (
    <div
      className={"modal-overlay" + (open ? " is-open" : "")}
      data-component="InterestModal"
      inert={!open}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="modal-panel" role="dialog" aria-modal="true" aria-label="관심 매물 추가">
        <div className="modal-header" data-component="ModalHeader">
          <button
            tabIndex={0}
            className="back-link"
            type="button"
            hidden={backLinkHidden}
            onClick={() => setScreen("search")}
          >
            <BackArrowIcon />
            매물 검색 돌아가기
          </button>
          <button tabIndex={0} className="modal-close" type="button" aria-label="닫기" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="modal-content" id="modal-content" data-component="ModalContent">
          {screen === "search" && (
            <SearchStep
              query={query}
              onQueryChange={setQuery}
              onCommit={commitSearch}
              committedQuery={committedQuery}
              resultsEverShown={resultsEverShown}
              results={results}
              searchLoading={searchLoading}
              searchError={searchError}
              pendingSelectId={pendingSelectId}
              onSelectComplex={handleSelectComplex}
              searchInputRef={searchInputRef}
            />
          )}
          {screen === "size" && (
            <SizeSelectStep
              complex={complex}
              size={size}
              sizesLoading={sizesLoading}
              sizesError={sizesError}
              onSelectSize={(i) => {
                setSize(i);
                setScreen("detail");
              }}
            />
          )}
          {screen === "detail" && (
            <DetailStep
              complex={complex}
              size={size}
              price={price}
              onPriceChange={setPrice}
              accordionOpen={accordionOpen}
              onToggleAccordion={() => setAccordionOpen((v) => !v)}
              floor={floor}
              onFloorChange={setFloor}
              dong={dong}
              onDongChange={setDong}
              ho={ho}
              onHoChange={setHo}
              direction={direction}
              onDirectionChange={setDirection}
              interior={interior}
              onInteriorChange={setInterior}
              onReselect={() => setScreen("size")}
            />
          )}
        </div>

        <div className="modal-footer" data-component="ModalFooter">
          <button
            tabIndex={0}
            className="footer-btn"
            type="button"
            data-state={canSubmit ? "active" : "disabled"}
            onClick={handleFooterClick}
          >
            {canSubmit && screen === "detail" ? "단지 바로 추가" : "단지 추가"}
          </button>
        </div>
      </aside>
    </div>
  );
}

// <SearchStep /> : 검색 입력 + <ResultsList />
function SearchStep({
  query,
  onQueryChange,
  onCommit,
  committedQuery,
  resultsEverShown,
  results,
  searchLoading,
  searchError,
  pendingSelectId,
  onSelectComplex,
  searchInputRef,
}) {
  const q = committedQuery || "";
  // 서버가 이미 키워드로 걸러서 주므로(최대 20건) results 자체가 매칭된
  // 것만 담고 있다 — 예전처럼 별도 filter/hidden 처리가 필요 없다.
  const showEmptyState =
    !searchLoading && !searchError && resultsEverShown && q && results.length === 0;

  return (
    <>
      <h2 className="modal-title">
        보고계신 매물
        <br />
        단지를 입력해보세요
      </h2>
      <div className="search-field">
        <input
          ref={searchInputRef}
          id="search-input"
          type="text"
          placeholder="단지명 입력 (예.행당대림)"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit();
          }}
        />
        <button
          tabIndex={0}
          className="search-submit"
          type="button"
          aria-label="검색"
          onClick={onCommit}
        >
          <SearchIcon />
        </button>
      </div>

      {resultsEverShown && (
        <div id="results-slot">
          {/* .result-list div 자체는 항상 마운트해두고 안의 내용(로딩/에러/
              결과)만 바꾼다 — 그래야 slideDown 애니메이션이 재검색마다
              재생되지 않는다(컴포넌트 상단 주석 3번/5번). */}
          <div className="result-list">
            {searchLoading && <div className="empty-state">검색 중...</div>}
            {!searchLoading && searchError && (
              <div className="empty-state">{searchError}</div>
            )}
            {!searchLoading &&
              !searchError &&
              results.map((c) => (
                <button
                  key={c.id}
                  tabIndex={0}
                  className="result-row"
                  type="button"
                  onMouseDown={(e) => {
                    pendingSelectId.current = c.id;
                    e.preventDefault();
                  }}
                  onClick={() => {
                    const id = pendingSelectId.current || c.id;
                    pendingSelectId.current = null;
                    onSelectComplex(id);
                  }}
                >
                  <span className="result-text">
                    <span className="result-name">{c.name}</span>
                    <span className="result-sub">
                      {c.region} / {c.built} 거래 / {dealCountLabel(c.dealCount)}
                    </span>
                  </span>
                  <ChevronRightIcon />
                </button>
              ))}
          </div>
          <div className="empty-state" hidden={!showEmptyState}>
            일치하는 단지가 없어요. 단지명을 다시 확인해주세요.
          </div>
        </div>
      )}
    </>
  );
}

// <SizeSelectStep /> : 평형 탭 목록
function SizeSelectStep({ complex, size, sizesLoading, sizesError, onSelectSize }) {
  return (
    <>
      <h2 className="modal-title">
        {complex.name} 매물의
        <br />
        평형을 선택해주세요
      </h2>
      <div className="complex-summary">
        <div className="complex-name">{complex.name}</div>
        <div className="complex-sub">
          {complex.region} / {complex.built} 거래 / {dealCountLabel(complex.dealCount)}
        </div>
      </div>
      {sizesLoading && (
        <div className="empty-state">
          <img className="chart-loading-spinner" src="/loading-spinner.gif" alt="불러오는 중" />
        </div>
      )}
      {!sizesLoading && sizesError && <div className="empty-state">{sizesError}</div>}
      {!sizesLoading && !sizesError && complex.sizes.length === 0 && (
        <div className="empty-state">이 단지는 등록된 평형 정보가 없어요.</div>
      )}
      {!sizesLoading && !sizesError && complex.sizes.length > 0 && (
        <div className="size-list">
          {complex.sizes.map((s, i) => {
            const selected = size === i;
            return (
              <button
                key={s.label}
                tabIndex={0}
                className={"size-tab" + (selected ? " is-selected" : "")}
                type="button"
                onClick={() => onSelectSize(i)}
              >
                {selected && (
                  <span className="size-tab-check">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12l5 5L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
                <span className="size-tab-title">{s.label}</span>
                <span className="size-tab-price">{s.price}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// <DetailStep /> : 호가 입력 + <DetailAccordion />(층/동/호수 + <ChipGroup/> x2)
function DetailStep({
  complex,
  size,
  price,
  onPriceChange,
  accordionOpen,
  onToggleAccordion,
  floor,
  onFloorChange,
  dong,
  onDongChange,
  ho,
  onHoChange,
  direction,
  onDirectionChange,
  interior,
  onInteriorChange,
  onReselect,
}) {
  return (
    <>
      <h2 className="modal-title">
        호가를 포함한
        <br />
        상세 정보를 입력해주세요
      </h2>
      <p className="modal-subtext">지금은 넘어가도 돼요</p>
      <div className="complex-summary">
        <div className="complex-summary-row">
          <div>
            <div className="complex-name">{complex.name}</div>
            <div className="complex-size-tag">{complex.sizes[size].label}</div>
          </div>
          <button tabIndex={0} className="reselect-link" type="button" onClick={onReselect}>
            평형 다시 선택
          </button>
        </div>
      </div>

      <div className="price-field">
        <div className="price-field-label">호가</div>
        <div className="field-suffix-wrap">
          <input
            type="text"
            inputMode="numeric"
            placeholder="32,000"
            value={price}
            onChange={(e) => onPriceChange(e.target.value)}
          />
          <span className="field-suffix">만원</span>
        </div>
        <p className="price-helper">
          <strong>호가를 입력</strong>하시면 현재 호가와 실거래 정보를 활용한 인사이트를 제공받을 수 있습니다.
        </p>
      </div>

      {/* 아코디언 본문은 열림 여부와 무관하게 항상 DOM에 그려두고, 펼치기/접기는
          className(.is-open)만 토글해서 처리한다(프로토타입과 동일 원칙). */}
      <div className={"accordion" + (accordionOpen ? " is-open" : "")}>
        <button
          tabIndex={0}
          className="accordion-toggle"
          type="button"
          aria-expanded={accordionOpen}
          onClick={onToggleAccordion}
        >
          <span>
            <span className="accordion-title">상세 정보 추가하기</span>
            <span className="accordion-hint">(층, 동호수 등)</span>
          </span>
          <span className="accordion-chevron">
            <ChevronDownIcon />
          </span>
        </button>
        <div className="accordion-body" inert={!accordionOpen}>
          <div className="accordion-body-inner">
            <div className="field-block">
              <div className="field-block-label">층</div>
              <div className="field-row">
                <div className="field-small field-suffix-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    placeholder="8"
                    value={floor}
                    onChange={(e) => onFloorChange(e.target.value)}
                  />
                  <span className="field-suffix">층</span>
                </div>
              </div>
            </div>

            <div className="field-block">
              <div className="field-block-label">동/호수</div>
              <div className="field-row">
                <div className="field-small field-suffix-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="208"
                    value={dong}
                    onChange={(e) => onDongChange(e.target.value)}
                  />
                  <span className="field-suffix">동</span>
                </div>
                <span className="field-sep">/</span>
                <div className="field-small field-suffix-wrap">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="1501"
                    value={ho}
                    onChange={(e) => onHoChange(e.target.value)}
                  />
                  <span className="field-suffix">호</span>
                </div>
              </div>
            </div>

            <div className="field-block">
              <div className="field-block-label">향</div>
              <ChipGroup name="direction" options={DIRECTIONS} value={direction} onChange={onDirectionChange} />
            </div>

            <div className="field-block">
              <div className="field-block-label">인테리어</div>
              <ChipGroup name="interior" options={INTERIORS} value={interior} onChange={onInteriorChange} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
