"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import ChartPlaceholder from "./ChartPlaceholder";
import { getTradePoints } from "@/lib/api";

// 실거래 분포도 — 대시보드 차트 그리드에서 가장 큰 메인 자리(.chart-main).
// 체크된 매물마다 컬럼 하나씩, 그 안에 기간 내 개별 실거래가를 점으로
// 흩뿌리고 거래가 몰린 구간은 원형 그라데이션 글로우로 표시한다. 호가를
// 입력해둔 매물만 초록 점(입력한 호가)이 추가로 뜬다.
//
// 실데이터 연결(2026-09): 다른 실데이터 차트(PriceTrendChart 등)와 동일한
// 방식 - items 중 checked && sizeId 있는 것만 골라 기간(3/12/36개월)·
// 매매/전세 탭에 맞춰 /items/{size_id}/trade-points(개별 거래 포인트 +
// 기간 내 평균가)를 호출한다.

const TRADE_TYPES = [
  { key: "sale", label: "매매" },
  { key: "jeonse", label: "전세" },
];

// 여백(패딩)은 실제 px 값으로 고정 - 카드 크기가 달라져도 항상 이만큼만
// 차지한다. W/H(전체 그리는 영역 크기)는 실측한 컨테이너 크기를 그대로
// 쓴다(아래 useState/useEffect) - viewBox를 640x300 같은 고정값으로 쓰면
// 실제 렌더 비율과 안 맞을 때 전체 그림이 확대/축소되어 보이고(2026-09
// 피드백 - "전체 크기가 줄었다"), 폰트/점도 그 배율만큼 실제 px보다 작거나
// 커져서 다른 차트(px 단위를 그대로 쓰는 Recharts 기반)와 크기가 안 맞아
// 보이는 문제(2026-09 피드백 - "아이템 이름 폰트 크기가 정렬 안 됨")가 있었다.
const PAD_TOP = 16;
const PAD_BOTTOM = 30;
const PAD_LEFT = 36;
const PAD_RIGHT = 14;
const PLOT_TOP = PAD_TOP;

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const t = idx - lo;
  return sortedValues[lo] * (1 - t) + sortedValues[hi] * t;
}

// 점 지터(가로 퍼짐) 위치만 결정하는 용도 - 시드 기반이라 리렌더돼도
// 같은 데이터면 점 위치가 흔들리지 않는다.
function seededRandom(seed) {
  const x = Math.sin(seed * 999.9 + 12.3) * 43758.5453;
  return x - Math.floor(x);
}

// 320000000(원) -> "32.0억". PriceTrendChart의 formatPriceLabel과 동일한
// 규칙(반올림 대신 절삭 + 소수 1자리)으로 앱 전체 표기를 통일한다.
function formatEok(won) {
  if (won == null) return null;
  const eok = won / 100000000;
  const truncated = Math.floor(eok * 10) / 10;
  // 40.0억처럼 소수점이 의미 없을 때는 정수로 딱 떨어지게 표기(2026-09 피드백 -
  // nice-number 축 값이 대부분 정수라 .0이 계속 붙어 보임).
  const label = Number.isInteger(truncated)
    ? String(truncated)
    : truncated.toFixed(1);
  return `${label}억`;
}

// "32,000"/"32000"(만원 단위 입력값, dashboardItems.js의 price 필드) -> 원.
// wonToPriceInput의 역변환과 동일한 규칙이라 여기서도 그대로 맞춰 쓴다.
function priceInputToWon(priceInput) {
  const digits = String(priceInput || "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  return Number(digits) * 10000;
}

// "깔끔한" 축 눈금 값(1/2/5/10의 배수)을 만드는 표준 nice-number 알고리즘
// (Heckbert) - 그대로 쓰면 24.7억/13.5억처럼 어중간한 소수가 나와서, 억
// 단위로 계산해 25억/20억/15억처럼 한국 돈 단위에 맞는 값으로 반올림한다
// (2026-09 피드백 - 축 숫자가 들쭉날쭉해서 덜 다듬어져 보인다는 지적).
function niceNumber(rawValue, shouldRound) {
  if (rawValue <= 0) return 0;
  const exponent = Math.floor(Math.log10(rawValue));
  const fraction = rawValue / 10 ** exponent;
  let niceFraction;
  if (shouldRound) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

// 억 단위로 nice-number 눈금을 계산해 원 단위 domain/tick 배열로 돌려준다.
function computeNiceScale(minWon, maxWon, tickCount = 3) {
  const EOK = 100000000;
  const minEok = minWon / EOK;
  const maxEok = maxWon / EOK;
  const step = niceNumber(Math.max(maxEok - minEok, 0.1) / tickCount, true);
  const niceMinEok = Math.max(0, Math.floor(minEok / step) * step);
  const niceMaxEok = Math.ceil(maxEok / step) * step;

  const ticks = [];
  for (let v = niceMinEok; v <= niceMaxEok + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }

  return {
    domainMin: niceMinEok * EOK,
    domainMax: niceMaxEok * EOK,
    ticks: ticks.map((v) => v * EOK),
  };
}

export default function RealTradeDistributionChart({ items }) {
  const [activePeriod, setActivePeriod] = useState("12");
  const [tradeType, setTradeType] = useState("sale");
  const [dataByItem, setDataByItem] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hoveredItemId, setHoveredItemId] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });

  const svgRef = useRef(null);
  const wrapRef = useRef(null);

  // .trade-distribution-chart__chart(wrapRef)의 실제 렌더 크기를 그대로
  // viewBox로 쓴다(1 unit = 1px) - CSS에서 높이를 고정해뒀는데(230px) 폭은
  // 카드마다 다르므로, 고정 비율 viewBox를 쓰면 비율이 안 맞아 그림 전체가
  // 줄어들어 보이는 문제가 있었다. 실측하면 항상 박스를 꽉 채우고, 다른
  // 차트와 동일한 실제 px 단위로 폰트/점 크기를 맞출 수 있다.
  const [boxSize, setBoxSize] = useState({ width: 900, height: 222 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setBoxSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const W = boxSize.width;
  const H = boxSize.height;
  const PLOT_BOTTOM = H - PAD_BOTTOM;
  const PLOT_LEFT = PAD_LEFT;
  const PLOT_RIGHT = W - PAD_RIGHT;

  const checkedItems = (items || []).filter(
    (it) => it.checked && it.sizeId != null,
  );
  // items 배열 참조 대신 의존성용 키 문자열을 쓰는 이유는 다른 실데이터
  // 차트들과 동일(PriceTrendChart 참고) - 체크 상태/사이즈 변경만 감지.
  const checkedKey = checkedItems
    .map((it) => `${it.id}:${it.sizeId}`)
    .join(",");

  useEffect(() => {
    if (checkedItems.length === 0) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 표준 데이터 페칭 패턴(다른 실데이터 차트들과 동일)
    setLoading(true);
    setError(null);

    const months = Number(activePeriod);

    Promise.all(
      checkedItems.map((item) =>
        getTradePoints(item.sizeId, months, tradeType).then((res) => ({
          itemId: item.id,
          count: res.count ?? 0,
          averagePrice: res.average_price ?? null,
          points: res.points || [],
        })),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        const map = {};
        results.forEach((r) => {
          map[r.itemId] = r;
        });
        setDataByItem(map);
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          "실거래 분포도를 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
        );
        setDataByItem({});
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkedKey가 checkedItems의 실질적인 변경을 대신 표현
  }, [checkedKey, activePeriod, tradeType]);

  // 아이템별 실거래 포인트 + 호가 + 기간 내 평균가를 한 번에 계산.
  const perItem = useMemo(() => {
    return checkedItems.map((item) => {
      const data = dataByItem[item.id];
      const amounts = (data?.points || [])
        .map((p) => p.deal_amount)
        .filter((v) => v != null)
        .sort((a, b) => a - b);
      return {
        item,
        amounts,
        askWon: priceInputToWon(item.price),
        count: data?.count ?? 0,
        averagePrice: data?.averagePrice ?? null,
      };
    });
  }, [checkedItems, dataByItem]);

  const hasAnyData = perItem.some(
    (d) => d.amounts.length > 0 || d.askWon != null,
  );

  // 공유 가격축 domain - 전체 아이템의 실거래가+호가를 합쳐 min/max
  // 산출한 뒤, nice-number로 반올림한 눈금을 함께 계산한다.
  const { domainMin, domainMax, ticks } = useMemo(() => {
    const allValues = perItem.flatMap((d) =>
      d.askWon != null ? d.amounts.concat([d.askWon]) : d.amounts,
    );
    if (allValues.length === 0) {
      return { domainMin: 0, domainMax: 100000000, ticks: [0, 100000000] };
    }
    const dataMin = Math.min(...allValues);
    const dataMax = Math.max(...allValues);
    // nice-number 계산 자체가 다음 step까지 올림/내림해줘서 자체 여백이
    // 생기므로, 사전 패딩은 살짝만 둔다(예전 15% -> 5%) - 세로 공간을
    // 점/글로우 표시에 더 쓰기 위해(2026-09 피드백 - 차트 높이를 늘릴 수
    // 없는 대신 여백을 줄여 밀도를 높여달라는 요청).
    const padAmt = (dataMax - dataMin) * 0.05 || dataMax * 0.08 || 50000000;
    return computeNiceScale(Math.max(0, dataMin - padAmt), dataMax + padAmt);
  }, [perItem]);

  function priceToY(price) {
    if (domainMax === domainMin) return (PLOT_TOP + PLOT_BOTTOM) / 2;
    return (
      PLOT_BOTTOM -
      ((price - domainMin) / (domainMax - domainMin)) * (PLOT_BOTTOM - PLOT_TOP)
    );
  }

  const colCount = Math.max(perItem.length, 1);
  const colWidth = (PLOT_RIGHT - PLOT_LEFT) / colCount;
  const maxJitterHalfWidth = colWidth * 0.26;

  function showTooltip(itemId, centerX) {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const svgRect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scale = svgRect.width / W;
    setTooltipPos({
      left: svgRect.left + centerX * scale - wrapRect.left,
      top: svgRect.top - wrapRect.top + PLOT_TOP * scale,
    });
    setHoveredItemId(itemId);
  }
  function hideTooltip() {
    setHoveredItemId(null);
  }

  const hoveredData = perItem.find((d) => d.item.id === hoveredItemId);

  return (
    <ChartPlaceholder
      title="실거래 분포도"
      className="chart-main"
      infoText="체크한 매물들의 실거래가를 흩어서 보여주고, 입력한 호가와 비교해요."
      headerRight={
        <div className="trade-distribution-chart__header-right">
          <div className="trade-distribution-chart__legend">
            <span className="trade-distribution-chart__legend-item">
              <span
                className="trade-distribution-chart__legend-dot"
                style={{ background: "var(--color-text-faint)" }}
              />
              실거래가
            </span>
            <span className="trade-distribution-chart__legend-item">
              <span
                className="trade-distribution-chart__legend-dot"
                style={{ background: "var(--color-primary)" }}
              />
              입력한 호가
            </span>
          </div>
          <label className="trade-distribution-chart__period-picker">
            <span>기간</span>
            <select
              value={activePeriod}
              onChange={(event) => setActivePeriod(event.target.value)}
              className="trade-distribution-chart__select"
            >
              <option value="3">3개월</option>
              <option value="12">12개월</option>
              <option value="36">36개월</option>
            </select>
          </label>
        </div>
      }
    >
      <div className="trade-distribution-chart__wrap">
        <div className="trade-distribution-chart__type-tabs">
          <span
            className="trade-distribution-chart__type-tab-thumb"
            style={{
              transform:
                tradeType === "jeonse"
                  ? "translateX(calc(100% + 2px))"
                  : "translateX(0)",
            }}
          />
          {TRADE_TYPES.map((type) => (
            <button
              key={type.key}
              type="button"
              className={
                "trade-distribution-chart__type-tab" +
                (tradeType === type.key ? " is-active" : "")
              }
              onClick={() => setTradeType(type.key)}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div className="trade-distribution-chart__chart" ref={wrapRef}>
          {checkedItems.length === 0 && (
            <div className="trade-distribution-chart__empty">
              <img
                className="chart-empty-icon"
                src="/empty-state-icon.png"
                alt=""
              />
              선택된 매물이 없어요.
            </div>
          )}
          {checkedItems.length > 0 && loading && (
            <div className="trade-distribution-chart__empty">
              <img
                className="chart-loading-spinner"
                src="/loading-spinner.gif"
                alt="불러오는 중"
              />
            </div>
          )}
          {checkedItems.length > 0 && !loading && error && (
            <div className="trade-distribution-chart__empty">{error}</div>
          )}
          {checkedItems.length > 0 && !loading && !error && !hasAnyData && (
            <div className="trade-distribution-chart__empty">
              선택하신 기간에는 실거래 데이터가 없어요.
            </div>
          )}
          {checkedItems.length > 0 && !loading && !error && hasAnyData && (
            <svg
              ref={svgRef}
              className="trade-distribution-chart__svg"
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              /* width/height를 CSS 100%가 아니라 실측 px(boxSize)로
                 인라인 고정 - 인라인 style이 스타일시트의 100%보다
                 우선하므로, SVG가 자기 viewBox 비율로 되돌아가 컨테이너
                 배분 높이를 잘못 해석하던 문제(2026-09, replaced element
                 percentage-height 엣지 케이스)가 아예 재발할 수 없다. */
              style={{ width: W, height: H }}
            >
              <defs>
                {/* 타원 2개(outer+inner)를 겹쳐서 만들던 방식은 경계가 살짝
                    링처럼 보이는 문제(2026-09 피드백)가 있어, stop을 촘촘히
                    나눈 단일 타원 하나로 매끈하게 정리했다. */}
                <radialGradient id="tdcGlow">
                  <stop offset="0%" stopColor="#09ce91" stopOpacity="0.22" />
                  <stop offset="35%" stopColor="#09ce91" stopOpacity="0.14" />
                  <stop offset="65%" stopColor="#09ce91" stopOpacity="0.06" />
                  <stop offset="100%" stopColor="#09ce91" stopOpacity="0" />
                </radialGradient>
                <filter
                  id="tdcGlowBlur"
                  x="-60%"
                  y="-60%"
                  width="220%"
                  height="220%"
                >
                  <feGaussianBlur stdDeviation="2.5" />
                </filter>
              </defs>

              {ticks.map((v, i) => {
                const y = priceToY(v);
                return (
                  <g key={i}>
                    <line
                      x1={PLOT_LEFT}
                      x2={PLOT_RIGHT}
                      y1={y}
                      y2={y}
                      className="trade-distribution-chart__gridline"
                    />
                    <text
                      x={PLOT_LEFT - 10}
                      y={y + 4}
                      textAnchor="end"
                      className="trade-distribution-chart__tick-label"
                    >
                      {formatEok(v)}
                    </text>
                  </g>
                );
              })}

              {perItem.map((d, idx) => {
                const centerX = PLOT_LEFT + colWidth * (idx + 0.5);
                const { amounts, askWon, item } = d;
                const plotHeight = PLOT_BOTTOM - PLOT_TOP;
                const minGlowHeight = 34;
                // 컨테이너 실제 높이가 얼마든(반응형으로 줄어들어도) 글로우가
                // plot 영역을 넘어설 만큼 과하게 커지지 않도록 상한을 둔다.
                const maxGlowHeight = plotHeight * 0.62;

                let glowRy = null;
                let midY = null;
                if (amounts.length > 0) {
                  const midPrice = percentile(amounts, 0.5);
                  midY = priceToY(midPrice);
                  const lowY = priceToY(percentile(amounts, 0.15));
                  const highY = priceToY(percentile(amounts, 0.85));
                  const spreadHeight = Math.min(
                    Math.max(lowY - highY, minGlowHeight),
                    maxGlowHeight,
                  );
                  glowRy = spreadHeight / 2;
                }

                return (
                  <g key={item.id}>
                    {/* 데이터가 거의/전혀 없는 컬럼(예: 호가만 입력된 경우)도
                        다른 컬럼과 같은 축 위에 있다는 게 보이도록 옅은
                        세로 기준선을 항상 깔아준다(2026-09 피드백 - 점 하나만
                        덩그러니 떠 있어 보이는 문제). */}
                    <line
                      x1={centerX}
                      x2={centerX}
                      y1={PLOT_TOP}
                      y2={PLOT_BOTTOM}
                      className="trade-distribution-chart__baseline"
                    />

                    {amounts.length > 0 && (
                      <ellipse
                        cx={centerX}
                        cy={midY}
                        rx={colWidth * 0.38}
                        ry={glowRy}
                        fill="url(#tdcGlow)"
                        filter="url(#tdcGlowBlur)"
                      />
                    )}

                    {amounts.map((price, i) => {
                      const y = priceToY(price);
                      const jitter =
                        (seededRandom(idx * 500 + i * 11 + 3) * 2 - 1) *
                        maxJitterHalfWidth;
                      return (
                        <circle
                          key={i}
                          cx={centerX + jitter}
                          cy={y}
                          r={3}
                          className="trade-distribution-chart__txn-dot"
                        />
                      );
                    })}

                    {askWon != null && (
                      <circle
                        cx={centerX}
                        cy={priceToY(askWon)}
                        r={4.125}
                        className="trade-distribution-chart__ask-dot"
                      />
                    )}

                    <text
                      x={centerX}
                      y={H - 10}
                      textAnchor="middle"
                      className="trade-distribution-chart__item-label"
                    >
                      {item.name}
                    </text>

                    <rect
                      x={PLOT_LEFT + colWidth * idx}
                      y={PLOT_TOP}
                      width={colWidth}
                      height={PLOT_BOTTOM - PLOT_TOP}
                      className="trade-distribution-chart__col-hit"
                      tabIndex={0}
                      onPointerEnter={() => showTooltip(item.id, centerX)}
                      onPointerLeave={hideTooltip}
                      onFocus={() => showTooltip(item.id, centerX)}
                      onBlur={hideTooltip}
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {hoveredData && (
            <div
              className="trade-distribution-chart__tooltip"
              style={{ left: tooltipPos.left, top: tooltipPos.top }}
            >
              <div className="trade-distribution-chart__tooltip-title">
                {hoveredData.item.name}
              </div>
              {/* 순서: 거래 건수 -> 기간 내 평균가격 -> 호가(2026-09 피드백) */}
              <div className="trade-distribution-chart__tooltip-row">
                <span className="trade-distribution-chart__tooltip-label">
                  <span
                    className="trade-distribution-chart__tooltip-dot"
                    style={{ background: "var(--color-text-faint)" }}
                  />
                  거래 건수
                </span>
                <span className="trade-distribution-chart__tooltip-value">
                  {hoveredData.count}건
                </span>
              </div>
              {hoveredData.count > 0 && hoveredData.averagePrice != null && (
                <div className="trade-distribution-chart__tooltip-row">
                  <span className="trade-distribution-chart__tooltip-label">
                    <span
                      className="trade-distribution-chart__tooltip-dot"
                      style={{ background: "var(--color-text-faint)" }}
                    />
                    기간 내 평균가격
                  </span>
                  <span className="trade-distribution-chart__tooltip-value">
                    {formatEok(hoveredData.averagePrice)}
                  </span>
                </div>
              )}
              {hoveredData.askWon != null && (
                <div className="trade-distribution-chart__tooltip-row">
                  <span className="trade-distribution-chart__tooltip-label">
                    <span
                      className="trade-distribution-chart__tooltip-dot"
                      style={{ background: "var(--color-primary)" }}
                    />
                    호가
                  </span>
                  <span className="trade-distribution-chart__tooltip-value">
                    {formatEok(hoveredData.askWon)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ChartPlaceholder>
  );
}
