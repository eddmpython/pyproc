// v86Readiness.js - Layer 5/guests: "이 guest가 부팅을 마쳤다"의 판정.
//
// 어댑터에서 나온 이유는 축이다: 이것은 매니페스트가 선언한 준비 조건을 읽고 기다리는 정책이고,
// 에뮬레이터를 조립하거나 수명주기를 모는 일과 같은 이유로 바뀌지 않는다. 어댑터 상태를 통째로
// 만지지 않는 것이 그 증거다: 필요한 것은 선언과 포트 둘뿐이라 인자로 받는다.
import { WebMachineError } from "../contracts/webMachineError.js";

export async function awaitV86Readiness({ manifest, serialPort, framebufferPort, control }) {
  const readiness = manifest?.v86?.readiness;
  if (!readiness) {
    const pattern = String(manifest?.v86?.readyPattern || "~% ");
    await serialPort.waitFor(pattern, 0, Number(manifest?.v86?.bootTimeoutMs || 120000), control);
    return;
  }
  if (readiness.kind === "serial-pattern") {
    const pattern = String(readiness.pattern || "");
    if (!pattern) throw new TypeError("serial-pattern readiness requires a pattern");
    await serialPort.waitFor(pattern, 0, Number(readiness.timeoutMs || 120000), control);
    return;
  }
  if (readiness.kind === "framebuffer") {
    if (!framebufferPort) throw new WebMachineError("WEB_MACHINE_GUEST_BOOT", "framebuffer readiness requires a framebuffer device");
    await framebufferPort.waitForFrame(Number(readiness.timeoutMs || 30000));
    return;
  }
  throw new TypeError(`unsupported v86 readiness: ${readiness.kind}`);
}
