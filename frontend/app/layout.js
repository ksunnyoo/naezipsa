import "./globals.css";
import "./global_mobile.css";

// 2026-09: 추천 폰트 후보 4개(SUIT, Spoqa Han Sans Neo, IBM Plex Sans KR,
// Wanted Sans)를 순서대로 미리보기해보고 Wanted Sans로 확정.
// next/font/google 대신 CDN CSS를 <link>로 직접 불러오는 이유는 기존
// Pretendard/Noto Sans KR 때와 동일: next/font는 빌드 타임에 폰트 파일을
// 미리 내려받아야 해서 빌드 환경에 외부 네트워크가 막혀 있으면 빌드 자체가
// 실패한다. <link> 태그는 브라우저가 "런타임에" 불러오므로 빌드 시점 네트워크
// 의존이 없다.
// React 19부터는 컴포넌트 어디서든 <link rel="stylesheet">를 렌더링하면
// 자동으로 <head>로 끌어올려지고 중복 제거까지 되므로, 명시적 <head> 태그로
// 감쌀 필요도 없다.
export const metadata = {
  title: "내집사",
  description: "관심 매물을 한눈에 비교하고 관리하는 대시보드",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/static/split/WantedSans.min.css"
        />
        {/* 로고 워드마크("내집사") 전용 - Jua는 400(Regular) 한 굵기만 있다. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Jua&display=swap"
        />
        {children}
      </body>
    </html>
  );
}
