// stateBindings.js - 실행 상태의 체크포인트와 durable journal 조립.
import { MachineJournal } from "../../capabilities/journal/machineJournal.js";
import { ReactiveController } from "../../capabilities/reactive.js";

const REACTIVE_CONTROLLER = Symbol.for("pyproc.reactiveController");

export const STATE_RUNTIME_BINDINGS = Object.freeze({
  // 런타임당 컨트롤러 1개. 복수 컨트롤러는 서로의 경계를 보지 못해 복원 soundness를 깬다.
  enableReactive: {
    value() {
      return (this[REACTIVE_CONTROLLER] ||= new ReactiveController(this));
    },
  },
  enableJournal: {
    value(cfg = {}) {
      return new MachineJournal(this, cfg);
    },
  },
});
