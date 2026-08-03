// servedResponses.js - Layer 4: 정확히 한 번 보증의 리더 절반.
//
// 두 기억이 한 쌍이다. 살아 있는 리더는 방금 답한 응답을 캐시로 재사용하고(같은 요청 ID가
// 다시 오면 실행하지 않는다), 승계자는 세대가 나른 결과 기록으로 답한다(리더가 바뀌어도
// 재실행하지 않는다). 둘의 상한이 같아야 한다: 캐시가 더 크면 이미 잊은 요청의 결과를 세대가
// 나르고, 더 작으면 살아있는 요청의 결과가 먼저 밀려난다. 그래서 상한 상수는 결과 기록이 소유한다.
//
// 순수 자료구조다: 실행도 전송도 저널도 모른다. KernelElection이 두 필드를 직접 만지면서
// LRU 축출과 롤백(커밋 실패 시 결과 기록을 되돌린다)을 섞어 갖고 있었다.
import { OUTCOME_LOG_MAX_RECORDS, appendOutcomeRecord, decodeOutcomeLog, encodeOutcomeLog, findOutcome } from "../../state/outcomeLog.js";

export class ServedResponses {
  constructor() {
    this._cache = new Map();
    this._outcomes = [];
  }

  // 살아 있는 리더의 응답 캐시. 같은 요청 ID의 재도착에 실행 없이 답한다.
  cached(requestId) {
    return this._cache.get(requestId);
  }

  remember(requestId, response) {
    this._cache.set(requestId, response);
    // FIFO 축출. 상한은 결과 기록과 같은 값이어야 한다(위 주석의 근거).
    if (this._cache.size > OUTCOME_LOG_MAX_RECORDS) this._cache.delete(this._cache.keys().next().value);
    return response;
  }

  get cacheSize() {
    return this._cache.size;
  }

  // 세대가 나르는 결과 기록. 승계자가 이것으로 답한다.
  recorded(requestId) {
    return findOutcome(this._outcomes, requestId);
  }

  // 기록을 더하고 되돌릴 수 있는 손잡이를 준다. 커밋이 실패하면 그 명령의 효과가 세대에 들지
  // 않았으므로 결과 기록도 남으면 안 된다(남으면 승계자가 안 된 일을 됐다고 답한다).
  record(entry) {
    const before = this._outcomes;
    this._outcomes = appendOutcomeRecord(before, entry);
    return () => { this._outcomes = before; };
  }

  get outcomeCount() {
    return this._outcomes.length;
  }

  // 세대에 실리는 사이드카. 비어 있으면 싣지 않는다.
  encode() {
    return this._outcomes.length ? encodeOutcomeLog(this._outcomes) : null;
  }

  decode(bytes) {
    this._outcomes = bytes ? decodeOutcomeLog(bytes) : [];
    return this;
  }
}
