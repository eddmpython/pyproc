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

export function createLinuxMachineManifest() {
  return {
    product: { channel: "development", image: "buildroot-linux-6.8.12-i686" },
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
