// 헤더 로고(홈 버튼)는 로그인하면 누를 수 없다.
//
// 히어로는 매물을 처음 담게 하는 안내라서 이미 담은 사용자에게는 의미가 없고,
// 로그인 사용자에게는 대시보드가 본 화면이다. 로고 자체는 브랜드 표시라
// 감추지 않고 클릭만 막는다(2026-09-17 결정).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Header from "@/components/Header";

function renderHeader(user) {
  const onLogoClick = vi.fn();
  render(
    <Header
      onLogoClick={onLogoClick}
      onLoginClick={() => {}}
      user={user}
      onLogoutClick={() => {}}
      onProfileClick={() => {}}
      profileReady={Boolean(user)}
      activeContentTab="detail"
      onContentTabChange={() => {}}
      showContentTabs={false}
      groupMenu={{ open: false }}
      onShare={() => {}}
    />,
  );
  return onLogoClick;
}

afterEach(cleanup);

describe("헤더 로고(홈)", () => {
  it("로그인 전에는 눌러서 홈으로 갈 수 있다", () => {
    const onLogoClick = renderHeader(null);

    const logo = screen.getByRole("button", { name: "홈으로" });
    expect(logo.disabled).toBe(false);
    fireEvent.click(logo);
    expect(onLogoClick).toHaveBeenCalled();
  });

  it("로그인하면 눌리지 않는다", () => {
    const onLogoClick = renderHeader({ id: "user-a" });

    // 홈으로 가는 버튼이 아니므로 이름도 브랜드 이름으로 바뀐다.
    expect(screen.queryByRole("button", { name: "홈으로" })).toBeNull();
    const logo = screen.getByRole("button", { name: "내집사" });
    expect(logo.disabled).toBe(true);

    fireEvent.click(logo);
    expect(onLogoClick).not.toHaveBeenCalled();
  });

  it("로고는 로그인 뒤에도 그대로 보인다(감추지 않는다)", () => {
    renderHeader({ id: "user-a" });
    expect(screen.getByText("내집사")).toBeTruthy();
  });
});
