// deterministicOrder.js - 결정적 정렬 비교. 순수 함수, import 0.
//
// 왜 별 파일인가: 내용주소와 서명 대상의 엔트리 순서가 로케일/ICU 판본에 따라 달라지면 같은
// 상태가 다른 주소를 낳는다("같은 상태 = 같은 주소"라는 상태 커널의 전제가 깨진다). 그래서
// 비교자는 코드 단위 비교로 고정한다. guest도 이 계약을 직접 소비해야 하므로(볼륨 엔트리 정렬이
// 서명 대상이다) platform 코덱이 아니라 순수 집합에 산다.
export function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
