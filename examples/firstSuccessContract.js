// firstSuccessContract.js - 공개 데모와 설치 playground가 공유하는 첫 성공 계약.
export const FIRST_SUCCESS_PROTOCOL = "pyproc.first-success";
export const FIRST_SUCCESS_VERSION = 1;
export const FIRST_SUCCESS_PYTHON = "print(sum(range(100)))";
export const FIRST_SUCCESS_OUTPUT = "4950";
export const DURABLE_REOPEN_PYTHON = "counter = 41";
export const DURABLE_REOPEN_NAME = "counter";
export const DURABLE_REOPEN_VALUE = 41;

export function firstSuccessProbe() {
  return Object.freeze({
    protocol: FIRST_SUCCESS_PROTOCOL,
    version: FIRST_SUCCESS_VERSION,
    python: FIRST_SUCCESS_PYTHON,
    expectedOutput: FIRST_SUCCESS_OUTPUT,
  });
}
