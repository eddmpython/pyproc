// frameSpaceTargetDraft.js - cooperative sandbox target가 제공해야 할 최소 message bridge probe.
const PROTOCOL = "pyproc-frame";
const VERSION = 1;

function parentAccessible() {
  try {
    void parent.document.documentElement;
    return true;
  } catch (error) {
    return false;
  }
}

function elementSummary(element) {
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    role: element.getAttribute("role"),
    text: String(element.innerText || element.value || "").trim().slice(0, 200),
  };
}

function snapshot() {
  return {
    url: location.href,
    title: document.title,
    parentAccessible: parentAccessible(),
    elements: [...document.querySelectorAll("button,input,select,textarea,a,output,[role]")].slice(0, 100).map(elementSummary),
  };
}

function targetElement(selector) {
  if (typeof selector !== "string" || !selector) throw new Error("selector is required");
  const element = document.querySelector(selector);
  if (!element) throw new Error(`selector did not match: ${selector}`);
  return element;
}

async function screenshot() {
  const width = Math.max(1, Math.min(1600, document.documentElement.scrollWidth));
  const height = Math.max(1, Math.min(1200, document.documentElement.scrollHeight));
  const clone = document.documentElement.cloneNode(true);
  for (const script of clone.querySelectorAll("script")) script.remove();
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("screenshot SVG could not be rendered"));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("screenshot PNG encoding failed");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    kind: "screenshot",
    mimeType: "image/png",
    byteLength: bytes.byteLength,
    sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    dataBase64: btoa(binary),
    width,
    height,
  };
}

async function dispatch(operation, input = {}) {
  if (operation === "observe") return snapshot();
  if (operation === "action.fill") {
    const element = targetElement(input.selector);
    element.value = String(input.value ?? "");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return elementSummary(element);
  }
  if (operation === "action.click") {
    const element = targetElement(input.selector);
    element.click();
    return elementSummary(element);
  }
  if (operation === "action.screenshot") return screenshot();
  throw new Error(`unsupported frame operation: ${operation}`);
}

addEventListener("message", (event) => {
  const hello = event.data;
  const port = event.ports?.[0];
  if (event.source !== parent || !port || hello?.protocol !== PROTOCOL || hello?.version !== VERSION
    || hello?.type !== "hello" || typeof hello?.nonce !== "string") return;
  port.onmessage = async ({ data }) => {
    if (data?.protocol !== PROTOCOL || data?.version !== VERSION || data?.type !== "request") return;
    try {
      port.postMessage({ protocol: PROTOCOL, version: VERSION, type: "response", id: data.id,
        ok: true, value: await dispatch(data.operation, data.input) });
    } catch (error) {
      port.postMessage({ protocol: PROTOCOL, version: VERSION, type: "response", id: data.id,
        ok: false, error: { code: "FRAME_SPACE_TARGET_FAILED", message: String(error?.message || error).slice(-300) } });
    }
  };
  port.start();
  port.postMessage({ protocol: PROTOCOL, version: VERSION, type: "hello", nonce: hello.nonce,
    url: location.href, parentAccessible: parentAccessible() });
});

parent.postMessage({ protocol: PROTOCOL, version: VERSION, type: "ready" }, "*");
