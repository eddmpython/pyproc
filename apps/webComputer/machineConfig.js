import { WEB_COMPUTER_ASSET_PROVENANCE } from "./assetProvenance.js";

export const WEB_COMPUTER_ADAPTER_VERSION = "v86-0.5.424-buildroot68-product-v1";
export const WEB_COMPUTER_CAPABILITIES = Object.freeze(["pyproc", "x86-linux"]);
export const WEB_COMPUTER_GROUP_ID = "webComputerDefault";
export const WEB_COMPUTER_DATABASE = "webComputerProductV1";
export const WEB_COMPUTER_OWNER_DATABASE = "webComputerProductOwnerV1";
export const PYTHON_DISK_BYTES = 2 * 1024 * 1024;
export const LINUX_DISK_BYTES = 2 * 1024 * 1024;
export const WEB_COMPUTER_TIMEOUTS = Object.freeze({
  owner: 15000,
  request: 120000,
  save: 120000,
  restore: 180000,
  export: 180000,
  import: 180000,
});

const assetRoot = new URL("./assets/", import.meta.url);

export async function loadV86Constructor() {
  const module = await import(new URL("libv86.mjs", assetRoot).href);
  if (typeof module.V86 !== "function") throw new TypeError("Web Computer engine module does not export V86");
  return module.V86;
}

// 봉투가 나르는 것은 판정이 아니라 출처다.
//
// 예전엔 여기에 product.channel = "development"가 있었다. 그건 (a) assetCatalog의 채널과
// 손으로 맞춘 중복이었고 (b) 어긋나도 아무도 안 잡았으며 (c) imageTrust가 서명 검증 "전에"
// manifest를 파싱해 신뢰 화면에 쓰므로 공격자 제어 문자열이 제품 판정으로 표시될 자리였다.
// 판정은 저장소 게이트가 하고, 봉투는 "어떤 catalog와 SBOM으로 만들어졌는가"만 나른다.
export function createLinuxMachineManifest() {
  return {
    product: { image: "buildroot-linux-6.8.12-i686" },
    provenance: WEB_COMPUTER_ASSET_PROVENANCE,
    v86: {
      readyPattern: "~% ",
      bootTimeoutMs: 120000,
      options: {
        wasm_path: new URL("v86.wasm", assetRoot).href,
        bios: { url: new URL("seabios.bin", assetRoot).href },
        vga_bios: { url: new URL("vgabios.bin", assetRoot).href },
        bzimage: { url: new URL("buildroot-bzimage68.bin", assetRoot).href, async: false },
        filesystem: {},
        cmdline: "tsc=reliable mitigations=off random.trust_cpu=on",
        memory_size: 64 * 1024 * 1024,
        disable_keyboard: false,
        disable_mouse: true,
        disable_speaker: true,
      },
    },
  };
}
