// config.js - 해시 고정 자산을 쓰는 Linux guest probe manifest 정본.
export const V86_ADAPTER_VERSION = "v86-0.5.424-buildroot68-state-v1";

export function createV86ProbeManifest() {
  return {
    v86: {
      readyPattern: "~% ",
      bootTimeoutMs: 120000,
      options: {
        wasm_path: "../fixtures/v86/assets/v86.wasm",
        bios: { url: "../fixtures/v86/assets/seabios.bin" },
        vga_bios: { url: "../fixtures/v86/assets/vgabios.bin" },
        bzimage: { url: "../fixtures/v86/assets/buildroot-bzimage68.bin", async: false },
        filesystem: {},
        cmdline: "tsc=reliable mitigations=off random.trust_cpu=on",
        memory_size: 64 * 1024 * 1024,
        disable_keyboard: true,
        disable_mouse: true,
        disable_speaker: true,
      },
    },
  };
}
