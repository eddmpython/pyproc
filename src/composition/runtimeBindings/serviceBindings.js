// serviceBindings.js - Layer 3: Runtime 위에 요청, 서버, URL, 터미널 서비스를 조립한다.
import { AsgiServer } from "../../capabilities/asgiServer.js";
import { MachineJail } from "../../capabilities/machineJail.js";
import { SyscallBridge } from "../../capabilities/syscallBridge.js";
import { Terminal } from "../../capabilities/terminal.js";
import { VirtualOrigin } from "../../capabilities/virtualOrigin.js";

export const SERVICE_RUNTIME_BINDINGS = Object.freeze({
  enableSyscallBridge: {
    value(cfg = {}) {
      return new SyscallBridge(this, {
        ...cfg,
        assetIntegrity: cfg.assetIntegrity || this.assetIntegrity,
      });
    },
  },
  enableAsgiServer: {
    value(cfg = {}) {
      return new AsgiServer(this, cfg);
    },
  },
  // 설치된 AsgiServer를 받거나 현재 Runtime에서 새 서버를 만들어 URL 경계에 연결한다.
  enableVirtualOrigin: {
    value(asgi, cfg = {}) {
      return new VirtualOrigin(asgi || this.enableAsgiServer(cfg));
    },
  },
  enableTerminal: {
    value(cfg = {}) {
      return new Terminal(this, cfg);
    },
  },
  // 권한 감옥. 협조 티어(파이썬 초크포인트)를 설치하고 CSP connect-src 문자열을 돌려준다.
  // 배선이 없던 동안 소비 문서(trustPermissions)가 도달 불가한 클래스를 지시했고, 그러면 제품이
  // 권한 감옥을 자체 구현해 보안 표면이 pyproc 밖으로 분기한다.
  enableJail: {
    value(permissions = {}) {
      const jail = new MachineJail(permissions);
      const installed = jail.install(this);
      return { jail, ...installed };
    },
  },
});
