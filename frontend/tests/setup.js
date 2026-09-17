// 테스트마다 주소를 처음 상태로 되돌린다.
//
// jsdom은 한 파일 안의 모든 테스트가 같은 window를 쓴다. 보고 있는 그룹을 주소에
// 남기게 되면서(?group=12), 앞 테스트가 남긴 주소를 뒤 테스트가 그대로 복원해
// 엉뚱한 그룹이 걸린 채로 시작하는 일이 생겼다. 공유 토큰(?share=)도 같은 자리를 쓴다.
import { beforeEach } from "vitest";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
