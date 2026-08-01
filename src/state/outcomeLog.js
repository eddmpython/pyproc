// outcomeLog.js - Layer 1: 명령 결과 기록의 순수 코덱. 정확히 한 번의 수렴이 여기 위에 선다.
//
// 왜 이것이 필요한가: 리더가 죽으면 승계된 리더는 새 커널을 부팅해 마지막 세대로 부활한다.
// 그런데 "그 명령이 실행됐는가"는 아무 데도 남지 않아서, 호출자는 영원히
// PYPROC_RPC_OUTCOME_UNKNOWN을 받고 아무도 다시 묻지 않았다. 결과를 남기면 승계자가 답할 수 있다.
//
// **왜 세대 안에 실리는가(이 파일의 존재 이유):** 결과를 세대 밖 파일에 두면, 승계자가 세대 G로
// 부활한 뒤 G에 없는 효과의 결과를 답할 수 있다(그 효과는 힙에서 사라졌는데 "됐다"고 말한다).
// 결과가 힙과 같은 세대에 실리면 "답이 내구적이다"와 "효과가 내구적이다"가 한 사실이 된다.
// PREV 후퇴도 공짜로 정합한다: 힙이 G-1로 돌아가면 결과 집합도 G-1의 것이다.
//
// 순수 규율: 브라우저 전역 접근 0. 인코딩은 상태 커널의 정본 코덱을 그대로 쓴다.
import { PyProcError } from "../runtime/errors.js";
import { decodeStateObject, encodeStateObject } from "./objectModel.js";

// 링 상한. 출처는 kernelElection의 _served LRU와 같은 값이다: 그보다 크면 이미 잊은 요청의
// 결과를 세대가 나르고, 작으면 살아있는 요청의 결과가 먼저 밀려난다.
export const OUTCOME_LOG_MAX_RECORDS = 256;
// 한 결과의 바이트 상한. 결과가 이보다 크면 기록하지 않는다(아래 append의 판정 참조).
export const OUTCOME_RECORD_MAX_BYTES = 64 * 1024;

const corrupt = (detail) => new PyProcError("PYPROC_STATE_CORRUPT", `outcomeLog: ${detail}`);

// 기록 한 건이 세대에 실릴 수 있는가. 실릴 수 없는 결과(순환 참조, 함수, 상한 초과)는 조용히
// 자르지 않고 **기록하지 않는다**: 그 명령은 여전히 outcome unknown이고, 그것이 정직한 상태다.
export function isRecordable(record) {
  try {
    return encodeStateObject(record).byteLength <= OUTCOME_RECORD_MAX_BYTES;
  } catch (error) {
    return false;
  }
}

// 링에 한 건 추가. 같은 requestId가 이미 있으면 덮지 않는다: 첫 결과가 정본이다(두 번째 실행이
// 있었다면 그것이 곧 정확히 한 번의 위반이므로, 덮어쓰기로 그 사실을 지우면 안 된다).
export function appendOutcomeRecord(records, record) {
  const list = Array.isArray(records) ? records : [];
  if (!record || typeof record.requestId !== "string" || !record.requestId) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "appendOutcomeRecord: a requestId is required");
  }
  if (list.some((entry) => entry.requestId === record.requestId)) return list;
  if (!isRecordable(record)) return list;
  const next = [...list, record];
  return next.length > OUTCOME_LOG_MAX_RECORDS ? next.slice(next.length - OUTCOME_LOG_MAX_RECORDS) : next;
}

export function encodeOutcomeLog(records) {
  const list = Array.isArray(records) ? records : [];
  return encodeStateObject({ kind: "outcomeLog", version: 1, records: list });
}

export function decodeOutcomeLog(bytes) {
  if (!bytes || !bytes.byteLength) return [];
  let value;
  try {
    value = decodeStateObject(bytes);
  } catch (error) {
    throw corrupt(`decode 실패(${String(error?.message || error).slice(0, 60)})`);
  }
  if (!value || value.kind !== "outcomeLog") throw corrupt("kind가 outcomeLog가 아니다");
  if (value.version !== 1) throw corrupt(`알 수 없는 version ${value.version}`);
  if (!Array.isArray(value.records)) throw corrupt("records가 배열이 아니다");
  for (const record of value.records) {
    if (!record || typeof record.requestId !== "string" || !record.requestId) throw corrupt("requestId 없는 기록");
    if (typeof record.ok !== "boolean") throw corrupt(`ok가 boolean이 아니다: ${record.requestId}`);
  }
  return value.records;
}

// 결과 조회. 세대가 나른 기록에서 이 요청의 답을 찾는다(없으면 아직 실행되지 않았다는 뜻이고,
// 그 사실 자체가 재실행을 안전하게 만든다: 효과가 이 세대에 없다).
export function findOutcome(records, requestId) {
  return (Array.isArray(records) ? records : []).find((entry) => entry.requestId === requestId) || null;
}

