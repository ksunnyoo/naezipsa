"use client";

import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartPlaceholder from "./ChartPlaceholder";
import { getMacroIndices } from "@/lib/api";

// 거시 데이터 — 매매가격지수(한국부동산원 R-ONE, 월단위) 실거래 데이터 연결
// (2026-09, B-10 GET /macro/indices). 다른 차트들과 달리 매물별 데이터가
// 아니라 전국 단위 지표라 items(체크된 매물)엔 의존하지 않고, 기간(3/12/36
// 개월) 선택만으로 재조회한다 — 그래서 대시보드에 체크된 매물이 하나도
// 없어도 이 차트는 항상 값을 보여준다.
//
// ⚠️ 다른 실데이터 차트(거래량 유동성/전세-매매 갭/시세)는 전부 우리 DB를
// 조회해서 빠른데, 이 차트만 외부 공공 API(REB/KOSIS)를 거쳐서 원래도 더
// 느리다 — 백엔드에 캐싱/기간 제한/병렬 호출을 다 넣어도 "그 API 서버까지
// 왕복하는 시간" 자체는 못 없앤다. 그래서 프론트에서 기간별로 한 번 받은
// 결과를 세션 동안 캐싱해서(cacheRef) 같은 기간으로 다시 전환할 땐 로딩
// 없이 바로 보여주고, 마운트 시 나머지 두 기간도 조용히 미리 받아둔다
// (2026-09, "로딩이 가급적 안 뜨면 좋겠다" 피드백) — 그래도 아주 처음
// 한 번(혹은 캐시가 비어있는 새 기간을 처음 고를 때)은 여전히 로딩이 뜬다.
const PERIODS = ["3", "12", "36"];

function formatPeriod(period) {
  // 백엔드가 R-ONE 원본 포맷인 "202603"(YYYYMM) 문자열을 그대로 준다 ->
  // "26.03"으로 축약(PriceTrendChart의 formatYearMonth와 같은 목적).
  const s = String(period);
  if (s.length !== 6) return s;
  return `${s.slice(2, 4)}.${s.slice(4, 6)}`;
}

// getMacroIndices 응답 -> { chartData, error } 로 정리. 실제 조회 effect와
// 백그라운드 프리페치 effect가 같은 변환 로직을 쓰므로 함수로 뽑아둔다.
function toChartResult(res) {
  if (res.price_index_error || !res.price_index?.length) {
    return {
      chartData: [],
      error: res.price_index_error || "매매가격지수 데이터가 없어요.",
    };
  }
  return {
    chartData: res.price_index.map((row) => ({
      month: formatPeriod(row.period),
      value: row.value,
    })),
    error: null,
  };
}

export default function MacroDataChart() {
  const [period, setPeriod] = useState("12");
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // period -> { chartData, error }. ref라 값이 바뀌어도 리렌더를 안 일으킨다
  // (캐시 그 자체는 화면에 표시할 상태가 아님) — 새로고침하면 비워짐(세션 캐시).
  const cacheRef = useRef({});

  useEffect(() => {
    const cached = cacheRef.current[period];
    if (cached) {
      // 이미 받아둔 기간이면 네트워크 없이 즉시 반영 — 로딩 깜빡임 없음.
      setChartData(cached.chartData);
      setError(cached.error);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getMacroIndices(period)
      .then((res) => {
        if (cancelled) return;
        const parsed = toChartResult(res);
        cacheRef.current[period] = parsed;
        setChartData(parsed.chartData);
        setError(parsed.error);
      })
      .catch(() => {
        if (cancelled) return;
        // 네트워크 실패 자체는 캐싱하지 않는다 — 다음 시도 때 재조회되게.
        setError("매매가격지수를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
        setChartData([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period]);

  useEffect(() => {
    // 백그라운드 프리페치 — 마운트 시 지금 보고 있지 않은 나머지 기간도
    // 조용히 미리 받아서 cacheRef를 채워둔다. 화면 상태(loading/error)는
    // 건드리지 않으므로 사용자에게는 아무 표시도 안 뜬다. 실패해도 조용히
    // 무시 — 실제로 그 기간을 클릭하면 위 effect가 다시 정식으로 시도한다.
    let cancelled = false;
    // 지금 보고 있는 기간(period)은 위 effect가 이미 조회 중이라 여기서
    // 또 부르면 같은 요청이 중복된다 — 나머지 기간만 대상으로 한다.
    PERIODS.filter((p) => p !== period && !cacheRef.current[p]).forEach((p) => {
      getMacroIndices(p)
        .then((res) => {
          if (cancelled) return;
          cacheRef.current[p] = toChartResult(res);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 시 한 번만 프리페치. period는 "지금 선택된 걸 빼고" 판단하는 용도일 뿐, 나중에 period가 바뀔 때마다 이 프리페치를 다시 돌릴 필요는 없음
  }, []);

  // 헤드라인(최신값/전월대비 증감률)은 선택한 기간과 무관하게 항상 가장
  // 최근 두 달 기준 — months가 3이든 36이든 배열의 마지막 두 항목은 항상
  // 같은(가장 최근) 달이기 때문에 기간 선택에 따라 값이 흔들리지 않는다.
  const latestValue = chartData.length > 0 ? chartData[chartData.length - 1].value : null;
  const previousValue =
    chartData.length > 1 ? chartData[chartData.length - 2].value : null;
  const delta =
    latestValue != null && previousValue
      ? (((latestValue - previousValue) / previousValue) * 100).toFixed(1)
      : null;

  return (
    <ChartPlaceholder
      title="매매가격지수"
      className="macro-data-chart"
      infoText={"한국부동산원이 발표하는 지역별 집값 흐름을 보여줘요.\n기준 시점보다 위면 집값이 오른 거고, 아래면 내린 거예요."}
      headerRight={
        <div className="macro-data-chart__header-right">
          <label className="macro-data-chart__period-picker">
            <span style={{ color: "#6b7280" }}>기간</span>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="macro-data-chart__select"
            >
              <option value="3">3개월</option>
              <option value="12">12개월</option>
              <option value="36">36개월</option>
            </select>
          </label>
        </div>
      }
    >
      <div className="macro-data-chart__wrap">
        <div className="macro-data-chart__header">
          <div>
            <div className="macro-data-chart__value-row">
              <span className="macro-data-chart__value">
                {latestValue != null ? latestValue.toFixed(1) : "-"}
              </span>
              {delta != null && (
                <span className="macro-data-chart__badge">
                  {delta > 0 ? "+" : ""}
                  {delta}%
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="macro-data-chart__chart">
          {loading && (
            <div className="macro-data-chart__empty">
              <img
                className="chart-loading-spinner"
                src="/loading-spinner.gif"
                alt="불러오는 중"
              />
            </div>
          )}
          {!loading && error && (
            <div className="macro-data-chart__empty">{error}</div>
          )}
          {!loading && !error && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="macroAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-primary)"
                      stopOpacity={0.38}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-primary)"
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--color-border-subtle)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 500 }}
                />
                <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
                <Tooltip
                  cursor={{
                    stroke: "var(--color-border-strong)",
                    strokeWidth: 1,
                  }}
                  contentStyle={{
                    fontSize: 14,
                    borderRadius: 12,
                    border: "1px solid var(--color-border)",
                    background: "rgba(255,255,255,0.96)",
                    boxShadow: "0 8px 20px rgba(17,17,17,0.08)",
                  }}
                  labelStyle={{ fontSize: 12, fontWeight: 700 }}
                  itemStyle={{ fontSize: 12, color: "#374151" }}
                  formatter={(value) => [
                    `${Number(value).toFixed(1)}`,
                    "매매가격지수",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-primary)"
                  strokeWidth={3}
                  fill="url(#macroAreaFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </ChartPlaceholder>
  );
}
