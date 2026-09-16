"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NewsCard from "./NewsCard";
import SubscriptionInfoCard from "./SubscriptionInfoCard";
import Toast from "../Toast";
import { CopyIcon } from "../icons";
import useToast from "@/hooks/useToast";
import { createDashboardInsight } from "@/lib/api";

const MIN_HEIGHT = 100;
// 이전엔 MAX_HEIGHT를 310px 고정값으로 뒀는데(2026-09 피드백 - 화면이 작을
// 때 리사이즈 가능 영역이 화면 절반을 넘어가 버려 부모 패널 밖으로 넘치는
// 문제) 화면 높이의 비율로 동적으로 계산하도록 변경. 처음엔 50%로 했다가
// 이후 80%로 재조정.
//
// 80%까지 늘어나면 아래 뉴스·청약 카드 줄(.insight-panel-inner >
// .insight-cards-row가 flex-basis 260px로 최소 높이를 갖고 있음)이 들어갈
// 자리가 부족해져 .insight-panel에 스크롤이 생기는 문제가 있었다. 그래서
// 단순히 "화면의 80%"가 아니라 "이 패널(.insight-panel-inner)의 실제 높이
// 중 카드 줄 최소 높이 + 리사이즈 손잡이 + gap을 뺀 나머지"로 상한을 다시
// 잡는다. RESERVED_BELOW_AI 값은 globals.css의 카드 줄 최소 높이(260px)
// 계산과 맞춰뒀다 - 그쪽을 바꾸면 여기도 같이 바꿔야 한다.
const RESERVED_BELOW_AI = 290; // 카드 줄 최소 260px + 리사이즈 손잡이(~14px) + gap*2(8px) + 하단 padding(8px)

// <InsightPanel /> : 헤더의 "인사이트" 탭 콘텐츠. 상세 데이터(기존
// 대시보드/차트)와 나란히 슬라이드 트랙에 놓이는 두 번째 패널. 구성: 제목 →
// AI 분석(높이 조절 가능) → 뉴스/청약 정보 카드 2개 가로 배치.
//
// AI 분석은 로그인 + 선택(체크)한 관심 매물이 있어야 호출 가능하고
// (POST /dashboard/insight, AI-01), 계정·선택·이용 목적이 바뀌면 이전 결과를
// 버려야 한다 - analysisKey가 바뀔 때 "렌더링 중 state 조정" 패턴으로
// insight를 idle로 되돌린다(EditListingDialog의 prevOpen과 동일한 이유로
// useEffect+setState 대신 이 패턴을 쓴다: react-hooks/set-state-in-effect 회피).
export default function InsightPanel({ items = [], userId, profile, refreshKey, referenceSizeId }) {
  const [height, setHeight] = useState(240);
  const [isDragging, setIsDragging] = useState(false);
  // 서버 렌더 시점엔 window/DOM이 없어 310(기존 고정값과 동일한 기본치)로
  // 시작하고, 마운트 후 실제 패널 높이 기준으로 갱신 + 창 크기 변경 시
  // 다시 계산한다.
  const [maxHeight, setMaxHeight] = useState(310);
  const drag = useRef(null);
  const selected = items.filter((item) => item.checked && item.backendId != null);
  // 계정·후보 상세·선택·이용 목적이 바뀌면 이전 분석을 폐기한다.
  const analysisKey = JSON.stringify([userId, selected, profile?.service_purposes]);
  const aiContentRef = useRef(null);
  const panelInnerRef = useRef(null);
  const toast = useToast();

  // AI-01(POST /dashboard/insight) 연동. 외부 LLM 호출 비용이 매번 드는
  // "행위"라 자동 재조회하지 않고(백엔드도 그래서 GET이 아니라 POST -
  // app/insight/router.py 주석 참고) 사용자가 버튼을 눌렀을 때만 부른다.
  const [insight, setInsight] = useState({ status: "idle", data: null, error: "" });
  const [prevAnalysisKey, setPrevAnalysisKey] = useState(analysisKey);
  if (analysisKey !== prevAnalysisKey) {
    setPrevAnalysisKey(analysisKey);
    setInsight({ status: "idle", data: null, error: "" });
  }
  // items(대시보드 관심 매물)의 id는 프론트 로컬 id("item-N")라 백엔드가
  // 돌려주는 item.id(실제 DB id, lib/dashboardItems.js의 backendId)와
  // 다르다 - backendId 기준으로 매칭해야 이름이 붙는다.
  const itemLabelByBackendId = useMemo(
    () => Object.fromEntries(
      items.map(item => [item.backendId, `${item.name} · ${item.sizeLabel}`]),
    ),
    [items],
  );
  // 응답이 오는 동안 언마운트되거나(패널 전환 등) 연속 클릭으로 중복
  // 호출되는 걸 막는다.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const busyRef = useRef(false);
  // 요청마다 번호를 매기고, 계정·선택·후보 상세·이용 목적(analysisKey)이 바뀌면 번호를 올려
  // 진행 중이던 이전 요청을 무효로 만든다. 늦게 도착한 이전 응답·실패가 새 조건의 화면을
  // 덮어쓰지 않고, 새 조건에서는 이전 요청을 기다리지 않고 바로 분석할 수 있다.
  const requestIdRef = useRef(0);
  useEffect(() => {
    requestIdRef.current += 1;
    busyRef.current = false;
  }, [analysisKey]);
  const runAnalysis = useCallback(async () => {
    if (!userId || selected.length === 0 || busyRef.current) return;
    busyRef.current = true;
    const requestId = ++requestIdRef.current;
    const isCurrent = () => activeRef.current && requestIdRef.current === requestId;
    setInsight({ status: "loading", data: null, error: "" });
    try {
      const data = await createDashboardInsight(
        selected.map((item) => item.backendId),
        userId,
      );
      if (isCurrent()) setInsight({ status: "done", data, error: "" });
    } catch (error) {
      if (isCurrent()) setInsight({ status: "error", data: null, error: error.message });
    } finally {
      if (requestIdRef.current === requestId) busyRef.current = false;
    }
  }, [userId, selected]);

  useEffect(() => {
    const updateMaxHeight = () => {
      const panelHeight = panelInnerRef.current?.clientHeight ?? window.innerHeight;
      const byScreen = window.innerHeight * 0.8;
      const byPanel = panelHeight - RESERVED_BELOW_AI;
      const next = Math.max(MIN_HEIGHT, Math.min(byScreen, byPanel));
      setMaxHeight(next);
      // 창을 줄여서 상한이 낮아졌는데 이미 그보다 큰 높이로 펼쳐져 있던
      // 경우, 이 높이 자체는 리사이즈 이벤트로는 다시 clamp되지 않으므로
      // (clamp()는 드래그/키보드 조작 때만 호출됨) 여기서 같이 줄여준다.
      setHeight(h => Math.min(h, next));
    };
    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);
    return () => window.removeEventListener("resize", updateMaxHeight);
  }, []);

  const clamp = useCallback(
    (value) => Math.max(MIN_HEIGHT, Math.min(maxHeight, value)),
    [maxHeight],
  );

  const handleCopy = useCallback(async () => {
    const text = aiContentRef.current?.innerText.trim();
    if (!text) {
      toast.show("아직 복사할 내용이 없어요.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.show("복사했어요");
    } catch {
      toast.show("복사에 실패했어요. 잠시 후 다시 시도해주세요.");
    }
  }, [toast]);

  return (
    <div className="insight-panel" data-component="InsightPanel">
      <div className="insight-panel-inner" ref={panelInnerRef}>
        <div
          id="insight-ai-content"
          className="insight-ai-placeholder is-resizable"
          style={{ height }}
        >
          <div className="insight-card-header">
            <span className="insight-card-title">
              등록된 매물에 대한 AI 분석 데이터
            </span>
            <div className="insight-ai-actions">
              <button
                type="button"
                className="insight-copy-btn"
                aria-label="AI 분석 내용 복사"
                onClick={handleCopy}
              >
                <CopyIcon />
              </button>
              <button
                type="button"
                className="insight-ai-analyze-btn"
                onClick={runAnalysis}
                disabled={!userId || selected.length === 0 || insight.status === "loading"}
              >
                {insight.status === "done"
                  ? "다시 분석"
                  : insight.status === "loading"
                    ? "분석 중…"
                    : "AI 분석 시작하기"}
              </button>
            </div>
          </div>
          {/* 버튼 두 개는 위 .insight-card-header에 있어 스크롤과 무관하게
              항상 고정 노출되고, 아래 영역만 내용에 따라 스크롤된다. 복사
              버튼도 이 영역만 대상으로 하도록 ref를 여기로 옮겼다. */}
          <div className="insight-ai-scroll" ref={aiContentRef}>
            <div className="insight-ai-body" aria-live="polite">
              {insight.status === "idle" && (
                <div className="insight-ai-status">
                  {!userId ? (
                    <p className="news-message insight-ai-idle-text">
                      로그인하면 저장한 관심 매물의 AI 인사이트를 확인할 수 있어요.
                    </p>
                  ) : items.length === 0 ? (
                    <p className="news-message">
                      관심 매물을 먼저 등록하면 AI 분석을 받을 수 있어요.
                    </p>
                  ) : selected.length === 0 ? (
                    <p className="news-message insight-ai-idle-text">
                      분석할 관심 매물을 선택해 주세요.
                    </p>
                  ) : (
                    <p className="news-message insight-ai-idle-text">
                      매물 수정에서 층·향·인테리어 같은 세부 정보를 채워두면, 더
                      정확한 AI 인사이트를 받아볼 수 있어요.
                    </p>
                  )}
                </div>
              )}
              {insight.status === "loading" && (
                <div className="insight-ai-status" role="status">
                  <p className="news-message">AI가 분석하는 중입니다. 잠시만 기다려주세요.</p>
                </div>
              )}
              {insight.status === "error" && (
                <div className="insight-ai-status">
                  <p className="news-message news-error" role="alert">
                    {insight.error}{" "}
                    <button type="button" onClick={runAnalysis}>다시 시도</button>
                  </p>
                </div>
              )}
              {insight.status === "done" && (
                <>
                  {insight.data.summary && (
                    <p className="insight-ai-summary">{insight.data.summary}</p>
                  )}
                  <div className="insight-ai-items">
                    {insight.data.items
                      .filter((item) => selected.some((candidate) => candidate.backendId === item.id))
                      .map(item => (
                        <div key={item.id} className="insight-ai-item">
                          <div className="insight-ai-item-name">
                            {itemLabelByBackendId[item.id] || `매물 #${item.id}`}
                          </div>
                          {item.strengths?.length > 0 && (
                            <div className="insight-ai-item-row">
                              <span className="insight-ai-tag insight-ai-tag--positive">강점</span>
                              <span className="insight-ai-item-text">{item.strengths.join(" · ")}</span>
                            </div>
                          )}
                          {item.weaknesses?.length > 0 && (
                            <div className="insight-ai-item-row">
                              <span className="insight-ai-tag insight-ai-tag--negative">약점</span>
                              <span className="insight-ai-item-text">{item.weaknesses.join(" · ")}</span>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div
          className={
            "insight-resize-handle" + (isDragging ? " is-dragging" : "")
          }
          role="separator"
          aria-label="AI 분석 영역 높이 조절"
          aria-orientation="horizontal"
          aria-controls="insight-ai-content"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={maxHeight}
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            drag.current = { y: event.clientY, height };
            setIsDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (drag.current)
              setHeight(
                clamp(drag.current.height + event.clientY - drag.current.y),
              );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setIsDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setIsDragging(false);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setIsDragging(false);
          }}
          onDoubleClick={() => setHeight(240)}
          onKeyDown={(event) => {
            const values = {
              ArrowUp: height - 20,
              ArrowDown: height + 20,
              Home: MIN_HEIGHT,
              End: maxHeight,
            };
            if (event.key in values) {
              event.preventDefault();
              setHeight(clamp(values[event.key]));
            }
          }}
        >
          <span className="insight-resize-handle-bar" aria-hidden="true" />
        </div>
        <div className="insight-cards-row">
          <NewsCard />
          <SubscriptionInfoCard
            refreshKey={refreshKey}
            referenceSizeId={referenceSizeId}
          />
        </div>
      </div>
      <Toast message={toast.message} visible={toast.visible} />
    </div>
  );
}
