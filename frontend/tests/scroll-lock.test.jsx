// 배경 스크롤 잠금(useScrollLock).
//
// 팝업마다 각자 body.style.overflow를 저장했다 되돌리던 시절에는, 두 개가 겹치면
// 먼저 닫힌 쪽이 아직 열려 있는 팝업의 잠금까지 풀어버렸다(매물 추가 팝업 위로
// 온보딩이 열리는 경우). 반대 순서면 배경이 영영 잠겼다.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import useScrollLock from "@/hooks/useScrollLock";

function Popup({ active = true }) {
  useScrollLock(active);
  return null;
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("useScrollLock", () => {
  it("팝업이 겹쳐도 마지막 하나가 닫힐 때만 배경을 푼다", () => {
    const first = render(<Popup />);
    expect(document.body.style.overflow).toBe("hidden");

    const second = render(<Popup />);
    expect(document.body.style.overflow).toBe("hidden");

    // 하나가 닫혀도 아직 열린 팝업이 있으면 잠금이 유지돼야 한다.
    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");

    second.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("열리지 않은 팝업은 배경을 잠그지 않는다", () => {
    render(<Popup active={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("닫은 뒤에는 원래 값으로 돌려놓는다", () => {
    document.body.style.overflow = "auto";
    const view = render(<Popup />);
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();
    expect(document.body.style.overflow).toBe("auto");
  });
});
