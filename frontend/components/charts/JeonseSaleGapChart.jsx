"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartPlaceholder from "./ChartPlaceholder";
import { getJeonseGapRecent } from "@/lib/api";

// 전세-매매 갭 분석 — 대시보드에 체크된 매물들의 매매가/전세가 갭을 보여준다.
// 실거래 데이터 연결(2026-09, TradeVolumeLiquidityChart와 동일한 방식):
// items 중 checked && sizeId 있는 것만 골라 GET /items/jeonse-gap-recent를
// 한 번에 호출한다. ⚠️ 매매/전세 가격은 백엔드 팀 확정 로직(B-08, 기간
// 완화 방식)이 아니라 "최근 실거래 10건의 중앙값"으로 계산된다(요청사항) —
// lib/api.js의 getJeonseGapRecent 주석 참고.
function formatKoreanMoney(value) {
  const man = Number(value);
  if (!Number.isFinite(man)) return "-";

  const eok = Math.floor(man / 10000);
  const remainder = man % 10000;

  if (eok > 0 && remainder > 0) {
    return `${eok}억 ${remainder.toLocaleString()}만원`;
  }
  if (eok > 0) {
    return `${eok}억`;
  }

  return `${man.toLocaleString()}만원`;
}

function ComplexTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  // 막대는 jeonse + gap(매매-전세 차액)을 쌓아서 그리지만(아래 설명 참고),
  // 툴팁에는 항상 실제 매매가/전세가를 보여줘야 하므로 그리기용 dataKey가
  // 아니라 원본 데이터 행(payload[0].payload)에서 직접 값을 읽는다.
  const row = payload[0]?.payload;
  if (!row) return null;

  const rows = [
    { key: "sale", label: "매매가", value: row.sale, color: "var(--color-chart-sale)" },
    { key: "jeonse", label: "전세가", value: row.jeonse, color: "var(--color-chart-jeonse)" },
  ];

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
            {formatKoreanMoney(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function JeonseSaleGapChart({ items }) {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkedItems = (items || []).filter(
    (it) => it.checked && it.sizeId != null
  );
  // TradeVolumeLiquidityChart와 동일한 이유로 items 배열 참조 대신 의존성용
  // 키 문자열을 만든다 — 실제로 대상이 바뀔 때만 재조회되게.
  const checkedKey = checkedItems.map((it) => `${it.id}:${it.sizeId}`).join(",");

  useEffect(() => {
    // 체크된 매물이 없으면 조회를 건너뛴다 — 렌더에서 checkedItems.length로
    // 먼저 안내 문구를 보여주므로 이 경우 chartData/loading/error는 안 쓰인다.
    if (checkedItems.length === 0) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 표준 데이터 페칭 패턴(TradeVolumeLiquidityChart와 동일)
    setLoading(true);
    setError(null);

    const sizeIds = checkedItems.map((it) => it.sizeId);
    getJeonseGapRecent(sizeIds)
      .then((res) => {
        if (cancelled) return;
        const bySizeId = new Map(res.items.map((row) => [row.size_id, row]));
        const rows = checkedItems.map((item) => {
          const row = bySizeId.get(item.sizeId);
          if (!row || row.sample_insufficient) {
            return { name: item.name, sale: 0, jeonse: 0, gap: 0, percent: null };
          }
          // 백엔드는 원(₩) 단위로 내려주는데 이 차트는 기존부터 만원 단위를
          // 다뤄서(formatKoreanMoney) 여기서 맞춰준다.
          const sale = Math.round(row.sale_median / 10000);
          const jeonse = Math.round(row.jeonse_median / 10000);
          return {
            name: item.name,
            sale,
            jeonse,
            // gap: 막대의 "매매" 세그먼트에 실제로 쓰는 값(매매가 전체가
            // 아니라 매매가-전세가). jeonse와 gap을 쌓으면 정확히 sale이
            // 되므로, 전세 세그먼트가 전체 막대 중 차지하는 비율 =
            // jeonse/sale = percent(갭비율)와 그대로 일치한다.
            // (이전엔 jeonse + sale을 그대로 쌓아서 총 높이가 sale+jeonse가
            // 되고, 전세 비율이 jeonse/(sale+jeonse)로 실제보다 작게
            // 보였음 — 예: 48%인데 32%처럼 보이던 문제)
            // 전세가율이 아주 높거나(예: 90%대 이상) 전세가가 매매가와
            // 같거나 큰 경우(sale - jeonse가 0에 가깝거나 음수) gap이 0에
            // 가까워져서 초록(매매) 세그먼트가 눈에 아예 안 보이는 문제가
            // 있었다 - 실제 값이 그런 게 아니라 "매매가만큼의 차액이 거의
            // 없다"는 뜻이라 수치상으론 맞지만, 사용자가 "매매 막대가
            // 사라졌다"고 오해하기 쉽다. sale의 4% 만큼은 항상 최소로
            // 보이게 해서 얇더라도 초록 캡이 남게 한다(퍼센트 라벨은 여전히
            // 실제 gap_ratio를 그대로 보여주므로 숫자 자체는 왜곡되지 않음).
            gap: Math.max(sale * 0.04, sale - jeonse),
            percent: row.gap_ratio,
          };
        });
        setChartData(rows);
      })
      .catch(() => {
        if (cancelled) return;
        setError("전세-매매 갭 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
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
  }, [checkedKey]);

  const maxSaleValue = Math.max(1, ...chartData.map((item) => Number(item.sale ?? 0)));
  // 1.18 -> 1.32: 가장 높은 막대 위 퍼센트 라벨(LabelList)이 카드 상단에
  // 바싹 붙어 보인다는 피드백(2026-09) — y축 도메인 여유를 더 줘서 막대
  // 자체를 상대적으로 낮추고, margin.top도 같이 늘려 라벨이 들어갈
  // 공간을 확보한다.
  const yAxisDomain = [0, Math.ceil(maxSaleValue * 1.32)];

  return (
    <ChartPlaceholder
      title="전세-매매 갭 분석"
      className="jeonse-sale-gap-chart"
      infoText={"체크한 매물의 매매가 대비 전세가 비율, 전세가율이에요.\n전세가율이 높을수록 매매가와 전세가 차이가 작다는 뜻이에요."}
    >
      <div className="jeonse-sale-gap-chart__wrap">
        <div className="jeonse-sale-gap-chart__chart">
          {checkedItems.length === 0 && (
            <div className="jeonse-sale-gap-chart__empty">
              <img className="chart-empty-icon" src="/empty-state-icon.png" alt="" />
              선택된 매물이 없어요.
            </div>
          )}
          {checkedItems.length > 0 && loading && (
            <div className="jeonse-sale-gap-chart__empty">
              <img
                className="chart-loading-spinner"
                src="/loading-spinner.gif"
                alt="불러오는 중"
              />
            </div>
          )}
          {checkedItems.length > 0 && !loading && error && (
            <div className="jeonse-sale-gap-chart__empty">{error}</div>
          )}
          {checkedItems.length > 0 && !loading && !error && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 48, right: 8, left: 0, bottom: 0 }}
                barCategoryGap={10}
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
                <YAxis hide domain={yAxisDomain} />
                <Tooltip
                  cursor={{ fill: "rgba(17,17,17,0.02)" }}
                  content={<ComplexTooltip />}
                />
                <Bar
                  dataKey="jeonse"
                  stackId="gap"
                  fill="var(--color-chart-jeonse)"
                  radius={0}
                  maxBarSize={48}
                />
                <Bar
                  dataKey="gap"
                  stackId="gap"
                  fill="var(--color-chart-sale)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                >
                  <LabelList
                    dataKey="percent"
                    position="top"
                    offset={8}
                    formatter={(value) => (value == null ? "표본 부족" : `${value}%`)}
                    style={{
                      fill: "#374151",
                      fontSize: 12,
                      fontWeight: 700,
                      textAnchor: "middle",
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </ChartPlaceholder>
  );
}
