// webMachineError.js - host가 외부에 노출하는 구조화 오류 한 종류.
export class WebMachineError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "WebMachineError";
    this.code = code;
    this.details = details;
  }
}
