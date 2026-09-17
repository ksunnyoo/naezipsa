"use client";

import { useEffect } from "react";

// 팝업이 열려 있는 동안 배경 스크롤을 막는다.
//
// 팝업마다 각자 body.style.overflow를 저장했다 되돌리면 두 개가 겹쳤을 때 어긋난다.
// 실제로 이런 일이 있었다(2026-09-17):
//
//   1. 매물 추가 팝업이 열리며 "hidden"
//   2. 그 위로 온보딩이 열리며 이전 값 "hidden"을 기억
//   3. 매물 추가 팝업이 닫히며 배경을 풀어버림 -> 온보딩이 열려 있는데 뒤가 스크롤됨
//   4. 반대 순서면 온보딩이 "hidden"을 그대로 되돌려 배경이 영영 잠김
//
// 그래서 저장·복원 대신 **열린 개수를 세고**, 마지막 하나가 닫힐 때만 푼다.
// 개수는 모듈 하나에 모아 두어야 의미가 있으므로 컴포넌트 밖에 둔다.
let openCount = 0;
let restoreTo = "";

export default function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;

    if (openCount === 0) {
      restoreTo = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openCount += 1;

    return () => {
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) document.body.style.overflow = restoreTo;
    };
  }, [active]);
}
