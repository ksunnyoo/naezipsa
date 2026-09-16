"use client";

import { useEffect, useState } from "react";
import { getInsightItems, sourceLink } from "@/lib/insightApi";

export default function NewsCard() {
  const [state, setState] = useState({ items: [], loading: true, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      getInsightItems("/news/hot", controller.signal),
      getInsightItems("/news?limit=20", controller.signal),
    ]).then(([policy, news]) => {
      if (controller.signal.aborted) return;
      const hotItems =
        policy.status === "fulfilled"
          ? policy.value.map((item) => ({ ...item, badge: "hot 뉴스" }))
          : [];
      const generalItems = (news.status === "fulfilled" ? news.value : []).filter(
        (item, index, all) =>
          !hotItems.some((hot) => hot.link === item.link) &&
          all.findIndex((other) => other.link === item.link) === index,
      );
      const items = [...hotItems, ...generalItems];
      setState({
        items,
        loading: false,
        error: [policy, news].some((result) => result.status === "rejected")
          ? "일부 뉴스를 불러오지 못했습니다."
          : "",
      });
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="insight-card" data-component="NewsCard">
      <div className="insight-card-header">
        <span className="insight-card-title">오늘 확인해야하는 뉴스</span>
      </div>
      <div className="news-list" aria-live="polite">
        {state.loading && (
          <p className="news-message">뉴스를 불러오는 중입니다.</p>
        )}
        {state.error && (
          <p className="news-message news-error" role="alert">
            {state.error}{" "}
            <button
              type="button"
              onClick={() => {
                setState((s) => ({ ...s, loading: true, error: "" }));
                setAttempt((a) => a + 1);
              }}
            >
              다시 시도
            </button>
          </p>
        )}
        {!state.loading && !state.error && state.items.length === 0 && (
          <p className="news-message">등록된 뉴스가 없습니다.</p>
        )}
        {state.items.map((item) => (
          <a
            href={sourceLink(item.link)}
            target="_blank"
            rel="noopener noreferrer"
            className="news-row"
            key={item.link}
          >
            {item.badge && <span className="news-badge">{item.badge}</span>}
            <span className="news-row-title">{item.title}</span>
            <span className="news-row-date">{item.date}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
