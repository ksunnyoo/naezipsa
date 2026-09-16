"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// position:fixed는 조상 중 transform이 걸린 요소가 있으면 뷰포트가 아니라
// 그 조상을 기준으로 배치된다. 인사이트 패널은 .content-track(슬라이드
// 전환용 translateX)의 자손이라 이 토스트가 left:50%로 그 트랙(폭 200%)
// 기준 중앙에 잡혀버려 화면 왼쪽에 잘려 보이는 문제가 있었다. 항상
// document.body로 포탈해서 뷰포트 기준으로 뜨게 한다.
//
// SSR에는 document가 없어 렌더 가드가 필요한데, "typeof document ===
// undefined"로만 가드하면 실제로 하이드레이션 불일치가 난다(서버는 null을
// 그렸는데 클라이언트 첫 렌더는 브라우저라 바로 포탈을 그려버려서 - 포탈이
// 부모 트리 자리를 안 차지해도 React는 이 컴포넌트가 만들어낸 산출물 자체가
// 다르다고 보고 트리를 다시 그린다). useSyncExternalStore는 하이드레이션
// 중엔 getServerSnapshot(false)을 쓰고 마운트 후에만 실제 값(true)으로
// 다시 맞추도록 설계된 훅이라 이 문제가 없다 - useEffect에서 setState하는
// "mounted" 패턴과 같은 결과를 내면서도 react-hooks/set-state-in-effect
// 규칙에 걸리지 않는다.
const emptySubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export default function Toast({ message, visible }) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(
    <div className={"toast" + (visible ? " is-visible" : "")}>{message}</div>,
    document.body,
  );
}
