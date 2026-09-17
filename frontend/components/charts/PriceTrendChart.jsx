"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import ChartPlaceholder from "./ChartPlaceholder";
import { getPriceTrend, getRentTrend } from "@/lib/api";

// 실거래가 추이 — 대시보드에 체크된 매물들의 월별 중앙값 시세를
// 선으로 비교한다. 실거래 데이터 연결(2026-09, 다른 차트들과 동일한 방식):
// items 중 checked && sizeId 있는 것만 골라 기간(3/12/36개월, 다른 차트들과
// 동일한 단위로 통일 - 2026-09)에 맞는 개월 수로 B-05를 호출한다. 추가
// 요구사항: 매매/전세 탭으로 어느 시세를 볼지 바꿀 수 있어야 해서, 탭
// 상태에 따라 /trend(매매) 또는 /rent-trend(전세) 중 하나를 부른다.

const TRADE_TYPES = [
  { key: "sale", label: "매매" },
  { key: "jeonse", label: "전세" },
];

// 매물마다 다른 색 — MAX_DASHBOARD_ITEMS(6)와 맞춰 6색.
const LINE_COLORS = ["#0bb76d", "#AFD61F", "#5398FF", "#968BE0", "#FFB270", "#D3D3D3"];

function formatYearMonth(yearMonth) {
  // "2024-03" -> "24.03"
  const [year, month] = String(yearMonth).split("-");
  if (!year || !month) return String(yearMonth);
  return `${year.slice(2)}.${month}`;
}

function formatPriceLabel(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return "0.0억";

  const eok = num / 100000000;
  const truncated = Math.floor(eok * 10) / 10;
  return `${truncated.toFixed(1)}억`;
}

function CustomTooltip({ active, payload, label, itemsById }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.96)",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        boxShadow: "0 4px 18px rgba(17, 24, 39, 0.08)",
        padding: "8px 10px",
        fontSize: "0.75rem",
        color: "#374151",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#111827" }}>
        {label}
      </div>
      {payload
        .filter((entry) => entry.value != null)
        .map((entry) => (
          <div
            key={entry.dataKey}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: entry.stroke || entry.color || "#374151",
                  display: "inline-block",
                }}
              />
              <span style={{ color: "#374151" }}>
                {itemsById.get(entry.dataKey)?.name ?? entry.dataKey}
              </span>
            </div>
            <span style={{ color: "#111827", fontWeight: 700 }}>
              {formatPriceLabel(entry.value)}
            </span>
          </div>
        ))}
    </div>
  );
}

export default function PriceTrendChart({ items }) {
  const [activePeriod, setActivePeriod] = useState("12");
  const [tradeType, setTradeType] = useState("sale");
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkedItems = (items || []).filter(
    (it) => it.checked && it.sizeId != null
  );
  const itemsById = useMemo(
    () => new Map(checkedItems.map((item) => [item.id, item])),
    [checkedItems]
  );
  // 다른 실데이터 차트들과 동일한 이유(TradeVolumeLiquidityChart 참고)로
  // items 배열 참조 대신 의존성용 키 문자열을 쓴다.
  const checkedKey = checkedItems.map((it) => `${it.id}:${it.sizeId}`).join(",");

  useEffect(() => {
    // 체크된 매물이 없으면 조회를 건너뛴다 — 렌더에서 checkedItems.length로
    // 먼저 안내 문구를 보여주므로 이 경우 chartData/loading/error는 안 쓰인다.
    if (checkedItems.length === 0) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 표준 데이터 페칭 패턴(다른 실데이터 차트들과 동일)
    setLoading(true);
    setError(null);

    const months = Number(activePeriod);
    const fetchTrend = tradeType === "sale" ? getPriceTrend : getRentTrend;

    Promise.all(
      checkedItems.map((item) =>
        fetchTrend(item.sizeId, months).then((res) => ({
          itemId: item.id,
          points: res.monthly_median_prices || [],
        }))
      )
    )
      .then((results) => {
        if (cancelled) return;

        // 매물마다 거래 이력이 달라 연월이 서로 다를 수 있어서, 전체
        // 연월의 합집합을 시간순으로 정렬해 x축을 맞추고, 매물별로 그
        // 연월에 데이터가 없으면 그 지점만 비워둔다(선이 끊기는 게 아니라
        // Recharts가 알아서 그 지점을 건너뛰어 이어그림).
        const pricesByItemAndMonth = new Map(
          results.map((r) => [r.itemId, new Map(r.points.map((p) => [p.year_month, p.median_price]))])
        );
        const allMonths = Array.from(
          new Set(results.flatMap((r) => r.points.map((p) => p.year_month)))
        ).sort();

        const rows = allMonths.map((ym) => {
          const row = { label: formatYearMonth(ym) };
          checkedItems.forEach((item) => {
            const price = pricesByItemAndMonth.get(item.id)?.get(ym);
            if (price != null) row[item.id] = price;
          });
          return row;
        });

        setChartData(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setError("실거래가 추이를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
        setChartData([]);
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

  const yAxisDomain = useMemo(() => {
    const allValues = chartData.flatMap((entry) =>
      checkedItems
        .map((item) => entry[item.id])
        .filter((v) => v != null)
        .map(Number)
    );
    if (allValues.length === 0) return [0, 100000000];

    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);

    const padValue = Math.max(50000000, (maxValue - minValue) * 0.12);
    const adjustedMin =
      Math.floor((minValue - padValue) / 100000000) * 100000000;
    const adjustedMax =
      Math.ceil((maxValue + padValue) / 100000000) * 100000000;

    return [adjustedMin, adjustedMax];
  }, [chartData, checkedItems]);

  const yAxisTicks = useMemo(() => {
    const [minValue, maxValue] = yAxisDomain;
    const range = Math.max(1, maxValue - minValue);
    const step = Math.max(
      100000000,
      Math.ceil(range / 5 / 100000000) * 100000000,
    );

    const ticks = [];
    for (let value = minValue; value <= maxValue; value += step) {
      ticks.push(value);
    }
    if (ticks[ticks.length - 1] !== maxValue) {
      ticks.push(maxValue);
    }
    return ticks;
  }, [yAxisDomain]);

  return (
    <ChartPlaceholder
      title="실거래가 추이"
      className="price-trend-chart"
      infoText={"선택한 단지의 매매·전세 실거래가가 월별로 어떻게 움직였는지 비교해요."}
      headerRight={
        <div className="price-trend-chart__header-right">
          <label className="price-trend-chart__period-picker">
            <span style={{ color: "#6b7280" }}>기간</span>
            <select
              value={activePeriod}
              onChange={(event) => setActivePeriod(event.target.value)}
              className="price-trend-chart__select"
            >
              <option value="3">3개월</option>
              <option value="12">12개월</option>
              <option value="36">36개월</option>
            </select>
          </label>
        </div>
      }
    >
      <div className="price-trend-chart__wrap">
        <div className="price-trend-chart__header">
          <div className="price-trend-chart__type-tabs">
            {/* 매매<->전세 전환이 즉시 배경만 바뀌며 깜빡이던 걸 없애려고,
                탭 자체엔 배경을 안 주고 이 thumb 하나를 옆으로 슬라이드시켜
                활성 탭을 표시한다(세그먼트 컨트롤 패턴). 탭이 2개뿐이라
                tradeType이 "jeonse"인지로만 좌/우 위치를 판단한다. */}
            <span
              className="price-trend-chart__type-tab-thumb"
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
                tabIndex={0}
                className={
                  "price-trend-chart__type-tab" +
                  (tradeType === type.key ? " is-active" : "")
                }
                onClick={() => setTradeType(type.key)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <div className="price-trend-chart__chart">
          {checkedItems.length === 0 && (
            <div className="price-trend-chart__empty">
              <img className="chart-empty-icon" src="/empty-state-icon.png" alt="" />
              선택된 매물이 없어요.
            </div>
          )}
          {checkedItems.length > 0 && loading && (
            <div className="price-trend-chart__empty">
              <img
                className="chart-loading-spinner"
                src="/loading-spinner.gif"
                alt="불러오는 중"
              />
            </div>
          )}
          {checkedItems.length > 0 && !loading && error && (
            <div className="price-trend-chart__empty">{error}</div>
          )}
          {checkedItems.length > 0 && !loading && !error && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e5e7eb"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tick={{ fontSize: "0.6875rem", fill: "#6b7280", fontWeight: 500 }}
                />
                <YAxis
                  width={36}
                  domain={yAxisDomain}
                  ticks={yAxisTicks}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={2}
                  tick={{ fontSize: "0.6875rem", fill: "#6b7280", fontWeight: 500 }}
                  tickFormatter={(value) => `${Math.round(value / 100000000)}억`}
                />
                <Tooltip content={<CustomTooltip itemsById={itemsById} />} />

                {checkedItems.map((item, index) => (
                  <Line
                    key={item.id}
                    type="monotone"
                    dataKey={item.id}
                    stroke={LINE_COLORS[index % LINE_COLORS.length]}
                    strokeWidth={2.2}
                    dot={false}
                    activeDot={{
                      r: 4,
                      stroke: LINE_COLORS[index % LINE_COLORS.length],
                      strokeWidth: 2,
                    }}
                    name={item.name}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </ChartPlaceholder>
  );
}
