"use client";

import { useEffect, useRef, useState } from "react";
import ChartPlaceholder from "./ChartPlaceholder";
import { getAreaRanking } from "@/lib/api";

// 생활권 내 단지 랭킹 — 대시보드에 체크된 매물들을, 각자 같은 구(sgg_cd)
// 안의 비슷한 평형 단지들과 평단가로 비교한 순위를 보여준다. 실거래 데이터
// 연결(2026-09): 랭킹 계산 자체(같은 구 필터링, 평단가 산출, 순위 매기기)는
// 이미 백엔드에 구현돼 있는 B-09(GET /items/{size_id}/ranking)를 그대로
// 쓴다 — 새로 계산 로직을 만들 필요가 없었음. items 중 checked && sizeId
// 있는 것만 골라 각자 랭킹을 병렬로 조회한다(다른 실데이터 차트들과 동일한
// 패턴).

// getAreaRanking 응답 -> 랭킹 결과만 뽑아서 정리(캐시에 저장하는 값).
// id/name은 캐시에 넣지 않는다 — 같은 sizeId라도 매번 요청 시점의
// checkedItems에서 온 최신 id/name을 그대로 붙여 쓰기 위함.
function toRankingResult(res) {
  if (res.error || res.my_rank == null) {
    return { sampleInsufficient: true };
  }
  return { rank: res.my_rank, total: res.total };
}

function normalizeRankingData(data) {
  return [...data]
    .map((item) => {
      if (item.sampleInsufficient) return item;
      const total = Number(item.total) || 1;
      const rank = Number(item.rank) || 1;
      const percentile = Math.max((rank / total) * 100, 0);

      return {
        ...item,
        total,
        rank,
        percentile,
      };
    })
    .sort((a, b) => {
      // 데이터 부족 항목은 순위를 매길 수 없으니 항상 맨 아래로.
      if (a.sampleInsufficient && b.sampleInsufficient) return 0;
      if (a.sampleInsufficient) return 1;
      if (b.sampleInsufficient) return -1;
      return a.rank - b.rank;
    });
}

export default function AreaRankingChart({ items }) {
  const [rankingData, setRankingData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // sizeId -> 랭킹 결과 캐시. 체크박스를 껐다 켜서 같은 매물이 다시
  // checkedItems에 들어와도, 이미 조회했던 sizeId면 재조회 없이 즉시
  // 반영한다(2026-09 속도 개선 — 체크 토글마다 로딩이 뜨는 문제 해결).
  const cacheRef = useRef({});

  const checkedItems = (items || []).filter(
    (it) => it.checked && it.sizeId != null,
  );
  const checkedKey = checkedItems
    .map((it) => `${it.id}:${it.sizeId}`)
    .join(",");

  const buildRows = (list) =>
    list.map((item) => ({
      id: item.id,
      name: item.name,
      ...cacheRef.current[item.sizeId],
    }));

  useEffect(() => {
    // 체크된 매물이 없으면 조회를 건너뛴다 — 렌더에서 checkedItems.length로
    // 먼저 안내 문구를 보여주므로 이 경우 rankingData/loading/error는 안 쓰인다.
    if (checkedItems.length === 0) return;

    const toFetch = checkedItems.filter(
      (item) => !cacheRef.current[item.sizeId],
    );

    if (toFetch.length === 0) {
      // 체크된 매물 전부 캐시에 있음 — 로딩 없이 바로 반영
      setRankingData(buildRows(checkedItems));
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all(
      toFetch.map((item) =>
        getAreaRanking(item.sizeId).then((res) => {
          cacheRef.current[item.sizeId] = toRankingResult(res);
        }),
      ),
    )
      .then(() => {
        if (cancelled) return;
        setRankingData(buildRows(checkedItems));
      })
      .catch(() => {
        if (cancelled) return;
        setError(
          "생활권 랭킹 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.",
        );
        setRankingData([]);
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

  const rankedData = normalizeRankingData(rankingData);

  return (
    <ChartPlaceholder
      title="생활권 내 단지 랭킹"
      className="area-ranking-chart"
      infoText={
        "주변 지역·비슷한 평형의 단지와 평당 가격을\n비교해 현재 가격 수준을 확인할 수 있어요."
      }
    >
      <div className="area-ranking-chart__wrap">
        <div className="area-ranking-chart__header">
          <div>아파트 이름</div>
          <div>랭킹</div>
          <div className="area-ranking-chart__header-right">상위 %</div>
        </div>

        <div
          className={
            "area-ranking-chart__list" +
            (checkedItems.length === 0 || loading || error
              ? " area-ranking-chart__list--fill"
              : "") +
            // 선택된 매물이 없거나 로딩 중일 땐 안내 아이콘/스피너만 보여주고
            // 리스트 박스의 회색 배경·테두리는 감춘다(2026-09) - 원래는
            // 로딩 중에만 감췄는데, "선택된 매물이 없어요" 상태에서도 빈
            // 회색 박스가 함께 보이는 게 어색하다는 피드백으로 넓힘.
            (checkedItems.length === 0 || (checkedItems.length > 0 && loading)
              ? " area-ranking-chart__list--no-bg"
              : "")
          }
        >
          {checkedItems.length === 0 && (
            <div className="area-ranking-chart__empty">
              <img
                className="chart-empty-icon"
                src="/empty-state-icon.png"
                alt=""
              />
              선택된 매물이 없어요.
            </div>
          )}
          {checkedItems.length > 0 && loading && (
            <div className="area-ranking-chart__empty">
              <img
                className="chart-loading-spinner"
                src="/loading-spinner.gif"
                alt="불러오는 중"
              />
            </div>
          )}
          {checkedItems.length > 0 && !loading && error && (
            <div className="area-ranking-chart__empty">{error}</div>
          )}
          {checkedItems.length > 0 &&
            !loading &&
            !error &&
            rankedData.map((item) => (
              <div key={item.id} className="area-ranking-chart__row">
                <div className="area-ranking-chart__row-name">{item.name}</div>
                {item.sampleInsufficient ? (
                  <>
                    <div className="area-ranking-chart__row-rank">
                      표본 부족
                    </div>
                    <div className="area-ranking-chart__row-percentile">-</div>
                  </>
                ) : (
                  <>
                    <div className="area-ranking-chart__row-rank">
                      전체 {item.total}개 중 {item.rank}등
                    </div>
                    <div className="area-ranking-chart__row-percentile">
                      {item.percentile.toFixed(1)}%
                    </div>
                  </>
                )}
              </div>
            ))}
        </div>
      </div>
    </ChartPlaceholder>
  );
}
