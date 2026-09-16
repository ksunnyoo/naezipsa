"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import ChartPlaceholder from "./ChartPlaceholder";
import { getLiquidity } from "@/lib/api";

// 거래량 유동성 — 대시보드에 체크된 매물들의 매매/전세 계약 건수를 선택한
// 기간(3/12/36개월) 기준으로 비교한다. 실거래 데이터 연결(2026-09):
// items 중 checked && sizeId 있는 것만 골라 GET /items/{size_id}/liquidity를
// 부른다 — 체크를 해제하면 그 매물은 다음 재조회 때 그래프에서 빠진다
// (같은 체크박스가 "대시보드 반영"과 "이 차트 노출"을 겸함).
const SERIES = [
  { key: "sale", label: "매매", color: "var(--color-chart-sale)" },
  { key: "jeonse", label: "전세", color: "var(--color-chart-jeonse)" },
];

// ComplexTooltip(JeonseSaleGapChart.jsx)과 동일한 스타일 원칙(둥근 카드 +
// 컬러 점 인디케이터 + 라벨/값 정렬 + 넓게 퍼지는 그림자)을 따른다.
function VolumeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const rows = SERIES.map((series) => {
    const item = payload.find((p) => p.dataKey === series.key);
    if (!item) return null;
    return { ...series, value: item.value };
  }).filter(Boolean);

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.96)",
        border: "1px solid #e4e5e8",
        borderRadius: 8,
        padding: "6px 10px",
        boxShadow:
          "0 20px 25px -5px rgba(17,17,17,0.1), 0 8px 10px -6px rgba(17,17,17,0.1)",
        minWidth: 130,
        fontSize: 12,
      }}
    >
      <div style={{ color: "#111", fontWeight: 700, padding: "2px 0 4px" }}>
        {label}
      </div>
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "3px 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: row.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#6b7280", fontWeight: 500 }}>{row.label}</span>
          </div>
          <span
            style={{
              color: "#111",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {row.value}건
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TradeVolumeLiquidityChart({ items }) {
  const [period, setPeriod] = useState("12");
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkedItems = (items || []).filter(
    (it) => it.checked && it.sizeId != null
  );
  // effect 의존성으로 items 배열 자체(매 렌더 새 참조)를 쓰면 동/호수 수정
  // 같은 무관한 변경에도 재조회가 돌게 된다 — "id:sizeId" 조합 문자열로
  // 줄여서 실제로 대상이 바뀔 때만 재조회되게 한다.
  const checkedKey = checkedItems.map((it) => `${it.id}:${it.sizeId}`).join(",");

  useEffect(() => {
    // 체크된 매물이 없으면 그냥 조회를 건너뛴다 — 아래 렌더에서
    // checkedItems.length === 0을 먼저 보고 안내 문구를 보여주므로 이 경우엔
    // chartData/loading/error 값 자체가 쓰이지 않는다.
    if (checkedItems.length === 0) return;

    let cancelled = false;
    // 표준 "이펙트에서 데이터 fetch" 패턴 — react-hooks/set-state-in-effect가
    // 이펙트 본문의 동기 setState 호출을 전반적으로 경고하지만, 로딩 시작을
    // 알리는 이 두 줄은 React 공식 문서의 데이터 페칭 예시와 동일한 형태라
    // 의도적으로 유지한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    Promise.all(
      checkedItems.map((item) =>
        getLiquidity(item.sizeId, period).then((res) => ({
          name: item.name,
          sale: res.sale_count ?? 0,
          jeonse: res.jeonse_count ?? 0,
        }))
      )
    )
      .then((rows) => {
        if (cancelled) return;
        setChartData(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setError("거래량 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
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
  }, [checkedKey, period]);

  return (
    <ChartPlaceholder
      title="거래량 유동성"
      className="trade-volume-liquidity-chart"
      infoText={"체크한 매물의 매매·전세 거래 건수를 기간별로 보여줘요.\n건수가 많을수록 거래가 활발하다는 뜻이에요."}
      headerRight={
        <div className="trade-volume-liquidity-chart__header-right">
          <div className="trade-volume-liquidity-chart__legend">
            {SERIES.map((series) => (
              <span key={series.key} className="trade-volume-liquidity-chart__legend-item">
                <span
                  className="trade-volume-liquidity-chart__legend-dot"
                  style={{ background: series.color }}
                />
                {series.label}
              </span>
            ))}
          </div>
          <label className="trade-volume-liquidity-chart__period-picker">
            <span style={{ color: "#6b7280" }}>기간</span>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="trade-volume-liquidity-chart__select"
            >
              <option value="3">3개월</option>
              <option value="12">12개월</option>
              <option value="36">36개월</option>
            </select>
          </label>
        </div>
      }
    >
      <div className="trade-volume-liquidity-chart__wrap">
        <div className="trade-volume-liquidity-chart__chart">
          {checkedItems.length === 0 && (
            <div className="trade-volume-liquidity-chart__empty">
              <img className="chart-empty-icon" src="/empty-state-icon.png" alt="" />
              선택된 매물이 없어요.
            </div>
          )}
          {checkedItems.length > 0 && loading && (
            <div className="trade-volume-liquidity-chart__empty">
              <img
                className="chart-loading-spinner"
                src="/loading-spinner.gif"
                alt="불러오는 중"
              />
            </div>
          )}
          {checkedItems.length > 0 && !loading && error && (
            <div className="trade-volume-liquidity-chart__empty">{error}</div>
          )}
          {checkedItems.length > 0 && !loading && !error && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 24, right: 4, left: 0, bottom: 0 }}
                barCategoryGap="24%"
                barGap={4}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--color-border-subtle)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 500 }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(17,17,17,0.03)" }}
                  content={<VolumeTooltip />}
                />
                {SERIES.map((series) => (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    fill={series.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={16}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </ChartPlaceholder>
  );
}
