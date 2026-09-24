// trustedCertificates.js - 로컬 HTTPS 대상의 자체 서명 인증서를 공개키로 신뢰하는 계약.
// 신뢰는 manifest가 loopback HTTPS origin마다 인증서 파일을 명시할 때만 생긴다. pyproc은 그 인증서가 origin의
// 호스트를 이름으로 갖고 유효 기간 안인지 확인한 뒤 공개키(SPKI) SHA-256만 Chromium에 넘긴다
// (`--ignore-certificate-errors-spki-list`, 격리 profile에서만 적용된다). 원격 호스트의 인증서 무시와 전면
// 무시는 만들지 않는다. 신뢰는 공개키 단위이므로 같은 키를 쓰는 다른 loopback origin에도 미치지만 이동은
// 여전히 allowedOrigins가 막는다.
import { X509Certificate, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const TRUSTED_CERTIFICATES_MAX = 8;
// spkiSha256은 선택 키다. 정규화된 manifest가 다시 검증될 때 초기화 시점에 신뢰한 공개키와 같은지 확인한다.
const ENTRY_KEYS = new Set(["origin", "certificate", "spkiSha256"]);
const SPKI_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

function loopbackHttpsHost(origin, label) {
  let url;
  try { url = new URL(origin); } catch { throw new TypeError(`${label}.origin must be an exact HTTPS origin`); }
  if (url.protocol !== "https:" || url.origin !== origin) throw new TypeError(`${label}.origin must be an exact HTTPS origin`);
  const host = url.hostname;
  if (host !== "localhost" && !host.endsWith(".localhost") && host !== "127.0.0.1" && host !== "[::1]") {
    throw new TypeError(`${label}.origin must be a loopback HTTPS origin (localhost, 127.0.0.1 or [::1])`);
  }
  return host;
}

function namesHost(certificate, host) {
  if (host === "127.0.0.1") return certificate.checkIP(host) !== undefined;
  if (host === "[::1]") return certificate.checkIP("::1") !== undefined;
  return certificate.checkHost(host) !== undefined;
}

/** Validate manifest `browser.trustedCertificates` and pin each certificate by its public key. */
export function normalizeTrustedCertificates(input, allowedOrigins, { now = Date.now() } = {}) {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input) || input.length === 0 || input.length > TRUSTED_CERTIFICATES_MAX) {
    throw new TypeError(`browser.trustedCertificates must list 1 to ${TRUSTED_CERTIFICATES_MAX} entries`);
  }
  const origins = new Set();
  return Object.freeze(input.map((entry, index) => {
    const label = `browser.trustedCertificates[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError(`${label} must be an object`);
    for (const key of Object.keys(entry)) if (!ENTRY_KEYS.has(key)) throw new TypeError(`${label} does not accept ${key}`);
    const host = loopbackHttpsHost(entry.origin, label);
    if (!allowedOrigins.includes(entry.origin)) throw new TypeError(`${label}.origin must be one of browser.allowedOrigins`);
    if (origins.has(entry.origin)) throw new TypeError(`${label}.origin is listed twice`);
    origins.add(entry.origin);
    if (typeof entry.certificate !== "string" || !isAbsolute(entry.certificate)) {
      throw new TypeError(`${label}.certificate must be an absolute PEM certificate path`);
    }
    let certificate;
    try { certificate = new X509Certificate(readFileSync(entry.certificate)); }
    catch { throw new TypeError(`${label}.certificate is not a readable X.509 certificate: ${entry.certificate}`); }
    if (!namesHost(certificate, host)) throw new TypeError(`${label}.certificate does not name ${host}`);
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
      throw new TypeError(`${label}.certificate is outside its validity period`);
    }
    const spkiSha256 = createHash("sha256")
      .update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("base64");
    if (entry.spkiSha256 !== undefined && entry.spkiSha256 !== spkiSha256) {
      throw new TypeError(`${label}.certificate public key does not match the pinned spkiSha256`);
    }
    return Object.freeze({ origin: entry.origin, certificate: resolve(entry.certificate), spkiSha256 });
  }));
}

/** The launch projection: origin and public key pin only, never the certificate path. */
export function trustedCertificateEnvironment(entries) {
  return JSON.stringify(entries.map(({ origin, spkiSha256 }) => ({ origin, spkiSha256 })));
}

export function parseTrustedCertificateEnvironment(value, targetOrigins) {
  if (value === undefined || value === "") return Object.freeze([]);
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error("invalid PYPROC_BROWSER_TRUSTED_CERTIFICATES"); }
  if (!Array.isArray(parsed) || parsed.length > TRUSTED_CERTIFICATES_MAX) throw new Error("invalid PYPROC_BROWSER_TRUSTED_CERTIFICATES");
  return Object.freeze(parsed.map((entry, index) => {
    const label = `PYPROC_BROWSER_TRUSTED_CERTIFICATES[${index}]`;
    loopbackHttpsHost(entry?.origin, label);
    if (!targetOrigins.includes(entry.origin)) throw new Error(`${label} origin is outside PYPROC_BROWSER_ALLOWED_ORIGINS`);
    if (typeof entry.spkiSha256 !== "string" || !SPKI_SHA256.test(entry.spkiSha256) || Object.keys(entry).length !== 2) {
      throw new Error(`${label} must be { origin, spkiSha256 }`);
    }
    return Object.freeze({ origin: entry.origin, spkiSha256: entry.spkiSha256 });
  }));
}

export function trustedCertificateLaunchArgs(entries) {
  const pins = [...new Set(entries.map((entry) => entry.spkiSha256))];
  return pins.length ? [`--ignore-certificate-errors-spki-list=${pins.join(",")}`] : [];
}
