// selfSignedCertificate.mjs - 테스트가 로컬 HTTPS 서버를 띄울 자체 서명 X.509 인증서를 의존성 없이 만든다.
// Node에는 인증서 생성 API가 없고 CI에 openssl이 있다는 보장도 없어 DER을 직접 조립한다. 키는 P-256,
// 서명은 ecdsa-with-SHA256, 확장은 subjectAltName과 serverAuth뿐이다. 결과는 X509Certificate로 다시 읽어 검증한다.
import { X509Certificate, createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

function length(size) {
  if (size < 0x80) return Buffer.from([size]);
  const bytes = [];
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function node(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

const sequence = (...parts) => node(0x30, ...parts);
const set = (...parts) => node(0x31, ...parts);
const explicit = (index, ...parts) => node(0xa0 | index, ...parts);

function oid(dotted) {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first * 40 + second];
  for (const value of rest) {
    const chunk = [value & 0x7f];
    for (let remaining = value >> 7; remaining > 0; remaining >>= 7) chunk.unshift((remaining & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return node(0x06, Buffer.from(bytes));
}

function positiveInteger(bytes) {
  const trimmed = bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
  return node(0x02, trimmed);
}

function utcTime(date) {
  const text = date.toISOString().replace(/[-:T]/g, "").slice(2, 14);
  return node(0x17, Buffer.from(`${text}Z`, "ascii"));
}

function name(commonName) {
  return sequence(set(sequence(oid("2.5.4.3"), node(0x0c, Buffer.from(commonName, "utf8")))));
}

function subjectAltName(hosts) {
  const names = hosts.map((host) => /^\d+\.\d+\.\d+\.\d+$/.test(host)
    ? node(0x87, Buffer.from(host.split(".").map(Number)))
    : node(0x82, Buffer.from(host, "ascii")));
  return sequence(oid("2.5.29.17"), node(0x04, sequence(...names)));
}

/**
 * @param {{ hosts: string[], days?: number, notBefore?: Date }} options
 * @returns {{ cert: string, key: string, spkiSha256: string }}
 */
export function createSelfSignedCertificate({ hosts, days = 7, notBefore = new Date(Date.now() - 60_000) }) {
  if (!Array.isArray(hosts) || hosts.length === 0) throw new TypeError("hosts must list at least one DNS name or IPv4 address");
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const signatureAlgorithm = sequence(oid("1.2.840.10045.4.3.2"));
  const notAfter = new Date(notBefore.getTime() + days * 86_400_000);
  const extensions = explicit(3, sequence(
    subjectAltName(hosts),
    sequence(oid("2.5.29.37"), node(0x04, sequence(oid("1.3.6.1.5.5.7.3.1")))),
  ));
  const tbs = sequence(
    explicit(0, node(0x02, Buffer.from([2]))),
    positiveInteger(randomBytes(16)),
    signatureAlgorithm,
    name(hosts[0]),
    sequence(utcTime(notBefore), utcTime(notAfter)),
    name(hosts[0]),
    spki,
    extensions,
  );
  const signature = sign("sha256", tbs, privateKey);
  const der = sequence(tbs, signatureAlgorithm, node(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
  const parsed = new X509Certificate(cert);
  if (!parsed.verify(publicKey)) throw new Error("generated certificate does not verify with its own key");
  return Object.freeze({
    cert,
    key: privateKey.export({ type: "pkcs8", format: "pem" }),
    spkiSha256: createHash("sha256").update(spki).digest("base64"),
  });
}
