// deviceFs.js - Layer 1 능력: 모든 것은 파일(Plan 9). 브라우저 능력이 파이썬 파일이 된다.
// 실측(pythonMachine/deviceFsProbe 8/8): open() 쌍방 브리지, 열 때마다 신선한 동적 읽기,
// /proc 커널 상태, 부분 읽기/with문/os.path.exists까지 파이썬답게 동작.
// 계약: 장치 read 콜백은 동기이고 open 시점에 내용이 확정된다. 비동기 소스(클립보드 등)는
// "캐시 + refresh(비동기)"가 정직한 계약이다: open()은 마지막으로 알려진 값을 준다.
// 엔진 FS 접근은 이 능력 뒤에 격리한다(소비자는 파이썬 open()만 쓴다).
export class DeviceFs {
  constructor(rt, cfg = {}) {
    this._rt = rt;
    this._cfg = cfg;
    this._clip = ""; // /dev/clipboard 읽기 캐시(refreshClipboard가 채운다)
  }

  install() {
    const rt = this._rt;
    const FS = rt.raw.FS;
    rt.execSeq++; // FS 변이 = 실행 경계(리액티브 가드 근거)
    const enc = new TextEncoder(), dec = new TextDecoder();
    let minor = 0;
    const installed = [];

    const mk = (path, provider) => {
      const dev = FS.makedev(64, ++minor);
      FS.registerDevice(dev, {
        open(stream) { stream.pyprocData = enc.encode(String((provider.read && provider.read()) ?? "")); },
        close() {},
        read(stream, buffer, offset, length, position) {
          const data = stream.pyprocData;
          let i = 0;
          while (i < length && position + i < data.length) { buffer[offset + i] = data[position + i]; i++; }
          return i;
        },
        write(stream, buffer, offset, length) {
          if (provider.write) provider.write(buffer.subarray(offset, offset + length));
          return length;
        },
      });
      FS.mkdev(path, dev);
      installed.push(path);
    };

    try { FS.mkdir("/proc"); } catch (e) { /* 이미 존재하면 그대로 쓴다 */ }
    // 내장 /proc: 커널 상태 파일
    mk("/proc/meminfo", { read: () => JSON.stringify({ heapBytes: rt.memory.byteLength(), execSeq: rt.execSeq }) });
    if (this._cfg.ps) mk("/proc/ps", { read: () => JSON.stringify(this._cfg.ps()) });
    // 내장 /dev/clipboard: 쓰기 = 시스템 클립보드 반영 시도(권한 없으면 캐시만),
    // 읽기 = 캐시(비동기 클립보드 읽기는 refreshClipboard()로 끌어온다).
    mk("/dev/clipboard", {
      read: () => this._clip,
      write: (bytes) => {
        const text = dec.decode(bytes);
        this._clip = text;
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); // 권한 없음 = 캐시만 (best-effort)
      },
    });
    // 소비자 정의 장치: { "/dev/이름": { read?: () => string, write?: (Uint8Array) => void } }
    for (const [path, provider] of Object.entries(this._cfg.devices || {})) mk(path, provider);
    return { installed };
  }

  // 시스템 클립보드를 캐시로 끌어온다(사용자 제스처/권한 필요할 수 있음).
  // 이후 파이썬 open('/dev/clipboard').read()가 이 값을 읽는다.
  async refreshClipboard() {
    this._clip = await navigator.clipboard.readText();
    return this._clip;
  }
}
