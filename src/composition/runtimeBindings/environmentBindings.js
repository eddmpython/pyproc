// environmentBindings.js - 패키지, 장치 파일, 부팅 환경 조립.
import { DeviceFs } from "../../capabilities/deviceFs.js";
import { Init } from "../../capabilities/init.js";
import { WheelCache } from "../../capabilities/wheelCache.js";

export const ENVIRONMENT_RUNTIME_BINDINGS = Object.freeze({
  enableWheelCache: {
    value(cfg = {}) {
      return new WheelCache(this, cfg);
    },
  },
  enableDeviceFs: {
    value(cfg = {}) {
      return new DeviceFs(this, cfg);
    },
  },
  enableInit: {
    value(cfg = {}) {
      return new Init(this, cfg);
    },
  },
});
