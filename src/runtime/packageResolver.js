// packageResolver.js - Layer 0: deterministic Simple API resolution, locks, and hash storage.
import { parseSha256Address, sha256Address, SHA256_ADDRESS_PREFIX } from "./contentDigest.js";
import { PyProcError } from "./errors.js";
import { compareNames } from "./memoryLayout.js";
import {
  canonicalRequiresPython,
  canonicalPackageJson,
  immutablePackageValue,
  normalizePackageName,
} from "./packageCanonical.js";
import { parseWheelFilename } from "./wheelInstaller.js";

export const PACKAGE_LOCK_PROTOCOL = "pyproc.package-lock";
export const PACKAGE_LOCK_VERSION = 2;
export const PACKAGE_RESOLVER_VERSION = "pyproc.simple-resolver/2";

const SIMPLE_JSON_MEDIA = "application/vnd.pypi.simple.v1+json";
const requirementName = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/u;
const markerVariables = new Set([
  "implementation_name", "implementation_version", "os_name", "platform_machine",
  "platform_python_implementation", "platform_release", "platform_system", "platform_version",
  "python_full_version", "python_version", "sys_platform", "extra",
]);

function resolution(message, context = undefined) {
  return new PyProcError("PYPROC_PACKAGE_RESOLUTION", message, context ? { context } : {});
}

function bytesValue(input, label) {
  if (input instanceof Uint8Array) return input.slice();
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
  throw new PyProcError("PYPROC_INPUT_INVALID", `${label} must be bytes`);
}

function acceptedSha256(value, label) {
  const hex = parseSha256Address(value);
  if (!hex) throw resolution(`${label} must have a SHA-256 digest`);
  return `${SHA256_ADDRESS_PREFIX}${hex}`;
}

function acceptedUrl(value, label) {
  let url;
  try { url = new URL(value); }
  catch (error) { throw resolution(`${label} is not an absolute URL`); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw resolution(`${label} must be an uncredentialed HTTP URL without a fragment`);
  }
  return url.href;
}

function versionParts(value) {
  const match = /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:(a|b|c|rc|alpha|beta|pre|preview)[._-]?(\d+)?)?(?:[._-]?(post|rev|r)[._-]?(\d+)?)?(?:[._-]?dev[._-]?(\d+)?)?(?:\+([a-z0-9]+(?:[._-][a-z0-9]+)*))?$/iu.exec(String(value).trim());
  if (!match) throw resolution(`Version is not supported by the deterministic resolver: ${value}`);
  const preNames = { a: "a", alpha: "a", b: "b", beta: "b", c: "rc", rc: "rc", pre: "rc", preview: "rc" };
  return Object.freeze({ raw: String(value), epoch: Number(match[1] || 0),
    release: Object.freeze(match[2].split(".").map(Number)),
    pre: match[3] ? Object.freeze([preNames[match[3].toLowerCase()], Number(match[4] || 0)]) : null,
    post: match[5] ? Number(match[6] || 0) : null, dev: match[7] === undefined ? null : Number(match[7] || 0),
    local: match[8] ? Object.freeze(match[8].toLowerCase().split(/[._-]/u)) : null });
}

function numberCompare(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

export function comparePackageVersions(leftValue, rightValue) {
  const left = versionParts(leftValue);
  const right = versionParts(rightValue);
  let compared = numberCompare(left.epoch, right.epoch);
  if (compared) return compared;
  const releaseLength = Math.max(left.release.length, right.release.length);
  for (let index = 0; index < releaseLength; index += 1) {
    compared = numberCompare(left.release[index] || 0, right.release[index] || 0);
    if (compared) return compared;
  }
  const preRank = (value) => {
    if (!value.pre) return value.dev !== null && value.post === null ? [-1, 0] : [3, 0];
    return [{ a: 0, b: 1, rc: 2 }[value.pre[0]], value.pre[1]];
  };
  const leftPre = preRank(left);
  const rightPre = preRank(right);
  compared = numberCompare(leftPre[0], rightPre[0]) || numberCompare(leftPre[1], rightPre[1]);
  if (compared) return compared;
  compared = numberCompare(left.post === null ? -1 : left.post, right.post === null ? -1 : right.post);
  if (compared) return compared;
  compared = numberCompare(left.dev === null ? Number.POSITIVE_INFINITY : left.dev,
    right.dev === null ? Number.POSITIVE_INFINITY : right.dev);
  if (compared) return compared;
  if (left.local === null || right.local === null) return left.local === right.local ? 0 : left.local === null ? -1 : 1;
  for (let index = 0; index < Math.max(left.local.length, right.local.length); index += 1) {
    if (left.local[index] === undefined || right.local[index] === undefined) {
      return left.local[index] === right.local[index] ? 0 : left.local[index] === undefined ? -1 : 1;
    }
    const leftNumeric = /^\d+$/u.test(left.local[index]);
    const rightNumeric = /^\d+$/u.test(right.local[index]);
    if (leftNumeric !== rightNumeric) return leftNumeric ? 1 : -1;
    compared = leftNumeric ? numberCompare(Number(left.local[index]), Number(right.local[index]))
      : compareNames(left.local[index], right.local[index]);
    if (compared) return compared;
  }
  return 0;
}

function isPrerelease(version) {
  const parsed = versionParts(version);
  return parsed.pre !== null || parsed.dev !== null;
}

function compatibleUpper(version) {
  const parsed = versionParts(version);
  if (parsed.release.length < 2) throw resolution(`Compatible release needs at least two segments: ${version}`);
  const prefix = parsed.release.slice(0, -1);
  prefix[prefix.length - 1] += 1;
  return prefix.join(".");
}

function matchesSpecifier(version, rawSpecifier) {
  const specifier = rawSpecifier.trim();
  if (!specifier) return true;
  const match = /^(~=|==|!=|<=|>=|<|>)([^\s]+)$/u.exec(specifier);
  if (!match) throw resolution(`Unsupported version specifier: ${specifier}`);
  const [, operator, expected] = match;
  if ((operator === "==" || operator === "!=") && expected.endsWith(".*")) {
    const expectedRelease = expected.slice(0, -2).split(".").map(Number);
    const actualRelease = versionParts(version).release;
    const equal = expectedRelease.every((part, index) => actualRelease[index] === part);
    return operator === "==" ? equal : !equal;
  }
  if (operator === "~=") {
    return comparePackageVersions(version, expected) >= 0 && comparePackageVersions(version, compatibleUpper(expected)) < 0;
  }
  const compared = comparePackageVersions(version, expected);
  return { "==": compared === 0, "!=": compared !== 0, "<=": compared <= 0,
    ">=": compared >= 0, "<": compared < 0, ">": compared > 0 }[operator];
}

function markerTokens(marker) {
  const tokens = [];
  const expression = String(marker);
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace) { offset += whitespace[0].length; continue; }
    const string = /^(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)")/u.exec(rest);
    if (string) {
      tokens.push({ kind: "string", value: (string[1] ?? string[2]).replace(/\\(['"\\])/gu, "$1") });
      offset += string[0].length;
      continue;
    }
    const operator = /^(===|==|!=|<=|>=|~=|<|>)/u.exec(rest);
    if (operator) { tokens.push({ kind: "operator", value: operator[0] }); offset += operator[0].length; continue; }
    const punctuation = /^[()]/u.exec(rest);
    if (punctuation) { tokens.push({ kind: punctuation[0], value: punctuation[0] }); offset += 1; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_.-]*/u.exec(rest);
    if (word) { tokens.push({ kind: "word", value: word[0].toLowerCase() }); offset += word[0].length; continue; }
    throw resolution(`Unsupported environment marker near: ${rest.slice(0, 24)}`);
  }
  return tokens;
}

function compareMarkerValues(left, operator, right, versionComparison) {
  if (operator === "in" || operator === "not in") {
    const included = right.includes(left);
    return operator === "in" ? included : !included;
  }
  if (operator === "~=") return matchesSpecifier(left, `~=${right}`);
  const compared = versionComparison ? comparePackageVersions(left, right) : compareNames(left, right);
  return { "===": left === right, "==": left === right, "!=": left !== right,
    "<=": compared <= 0, ">=": compared >= 0, "<": compared < 0, ">": compared > 0 }[operator];
}

export function evaluatePackageMarker(marker, environment) {
  if (!marker) return true;
  const tokens = markerTokens(marker);
  let cursor = 0;
  const peek = (...values) => values.includes(tokens[cursor]?.value);
  const take = () => tokens[cursor++];
  const atom = () => {
    if (peek("(")) {
      take();
      const result = expression();
      if (!peek(")")) throw resolution("Environment marker has an unmatched parenthesis");
      take();
      return result;
    }
    const leftToken = take();
    if (!leftToken || !["word", "string"].includes(leftToken.kind)) throw resolution("Environment marker operand is missing");
    let operatorToken = take();
    if (operatorToken?.value === "not" && peek("in")) { take(); operatorToken = { value: "not in" }; }
    else if (operatorToken?.value === "in") operatorToken = { value: "in" };
    if (!operatorToken || !["===", "==", "!=", "<=", ">=", "~=", "<", ">", "in", "not in"].includes(operatorToken.value)) {
      throw resolution("Environment marker comparison operator is missing");
    }
    const rightToken = take();
    if (!rightToken || !["word", "string"].includes(rightToken.kind)) throw resolution("Environment marker operand is missing");
    const resolveValue = (token) => {
      if (token.kind === "string") return { value: token.value, variable: null };
      if (!markerVariables.has(token.value)) throw resolution(`Unknown environment marker variable: ${token.value}`);
      return { value: String(environment[token.value] ?? ""), variable: token.value };
    };
    const left = resolveValue(leftToken);
    const right = resolveValue(rightToken);
    const versionComparison = [left.variable, right.variable].some((name) => name?.includes("version"));
    return compareMarkerValues(left.value, operatorToken.value, right.value, versionComparison);
  };
  const conjunction = () => {
    let result = atom();
    while (peek("and")) { take(); const next = atom(); result = result && next; }
    return result;
  };
  const expression = () => {
    let result = conjunction();
    while (peek("or")) { take(); const next = conjunction(); result = result || next; }
    return result;
  };
  const result = expression();
  if (cursor !== tokens.length) throw resolution("Environment marker has trailing tokens");
  return result;
}

export function parsePackageRequirement(value) {
  if (typeof value !== "string" || !value.trim()) throw new PyProcError("PYPROC_INPUT_INVALID", "Package requirement must be a string");
  const [requirement, ...markerParts] = value.trim().split(";");
  if (markerParts.length > 1) throw resolution(`Requirement has more than one marker separator: ${value}`);
  const nameMatch = requirementName.exec(requirement.trim());
  if (!nameMatch) throw resolution(`Requirement name is invalid: ${value}`);
  let rest = requirement.trim().slice(nameMatch[0].length).trim();
  const extras = [];
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) throw resolution(`Requirement extras are not closed: ${value}`);
    for (const extra of rest.slice(1, end).split(",").map((item) => item.trim()).filter(Boolean)) {
      extras.push(normalizePackageName(extra));
    }
    rest = rest.slice(end + 1).trim();
  }
  if (rest.startsWith("(")) {
    if (!rest.endsWith(")")) throw resolution(`Requirement specifier is not closed: ${value}`);
    rest = rest.slice(1, -1).trim();
  }
  if (rest.includes("@")) throw resolution("Direct URL requirements are outside the locked Simple API contract");
  const specifiers = rest ? rest.split(",").map((item) => item.trim()).filter(Boolean) : [];
  for (const specifier of specifiers) matchesSpecifier("1.0", specifier);
  return immutablePackageValue({ raw: value.trim(), name: normalizePackageName(nameMatch[0]),
    extras: [...new Set(extras)].sort(), specifiers, marker: markerParts[0]?.trim() || null });
}

function requirementAllows(requirement, version) {
  return requirement.specifiers.every((specifier) => matchesSpecifier(version, specifier));
}

function explicitlyRequestsPrerelease(requirement, version) {
  return requirement.specifiers.some((specifier) => /^==[^*]+$/u.test(specifier)
    && matchesSpecifier(version, specifier) && isPrerelease(specifier.slice(2)));
}

function metadataHeaders(text) {
  const headers = new Map();
  let current = null;
  for (const rawLine of String(text).replaceAll("\r\n", "\n").split("\n")) {
    if (!rawLine) break;
    if (/^[ \t]/u.test(rawLine)) {
      if (!current) throw resolution("Package metadata has an orphan continuation line");
      const values = headers.get(current);
      values[values.length - 1] += ` ${rawLine.trim()}`;
      continue;
    }
    const separator = rawLine.indexOf(":");
    if (separator < 1) throw resolution("Package metadata contains a malformed header");
    current = rawLine.slice(0, separator).toLowerCase();
    const values = headers.get(current) || [];
    values.push(rawLine.slice(separator + 1).trim());
    headers.set(current, values);
  }
  return headers;
}

function dependencyRequirements(candidate, extras, environment) {
  const contexts = ["", ...extras];
  return candidate.dependencies.map(parsePackageRequirement).filter((requirement) => !requirement.marker
    || contexts.some((extra) => evaluatePackageMarker(requirement.marker, { ...environment, extra })))
    .map((requirement) => requirement.marker ? immutablePackageValue({ ...requirement, marker: null }) : requirement);
}

function responseHeader(response, name) {
  return response?.headers && typeof response.headers.get === "function" ? response.headers.get(name) : null;
}

async function responseBytes(response) {
  if (typeof response.arrayBuffer !== "function") throw resolution("Package response cannot provide bytes");
  return new Uint8Array(await response.arrayBuffer());
}

function acceptedIndexes(indexes) {
  if (!Array.isArray(indexes) || !indexes.length) throw new PyProcError("PYPROC_INPUT_INVALID", "At least one package index is required");
  const accepted = indexes.map((index, priority) => {
    const input = typeof index === "string" ? { url: index, trustRef: null } : index;
    const url = acceptedUrl(input?.url, `Package index ${priority}`);
    const directoryUrl = url.endsWith("/") ? url : `${url}/`;
    if (typeof input?.trustRef !== "string" || !input.trustRef) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `Package index ${priority} needs trustRef`);
    }
    return Object.freeze({ url: directoryUrl, trustRef: input.trustRef, priority });
  });
  if (new Set(accepted.map((index) => index.url)).size !== accepted.length) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Package index URLs must be unique");
  }
  return Object.freeze(accepted);
}

function acceptedPolicy(value, allowed, fallback, label) {
  const accepted = value || fallback;
  if (!allowed.includes(accepted)) throw new PyProcError("PYPROC_INPUT_INVALID", `${label} policy is invalid`);
  return accepted;
}

export class MemoryPackageContentStore {
  #entries = new Map();

  async put(expectedSha256, input) {
    const address = acceptedSha256(expectedSha256, "Content store key");
    const bytes = bytesValue(input, "Content store value");
    const actual = await sha256Address(bytes);
    if (actual !== address) throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Content store write hash mismatch", {
      context: { expected: address, actual },
    });
    this.#entries.set(address, bytes.slice());
    return address;
  }

  async get(expectedSha256) {
    const address = acceptedSha256(expectedSha256, "Content store key");
    const bytes = this.#entries.get(address);
    if (!bytes) return null;
    const actual = await sha256Address(bytes);
    if (actual !== address) {
      this.#entries.delete(address);
      throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Content store read hash mismatch", {
        context: { expected: address, actual },
      });
    }
    return bytes.slice();
  }

  async has(expectedSha256) { return (await this.get(expectedSha256)) !== null; }
}

export class SimpleApiPackageResolver {
  #fetch;
  #indexes;
  #bundledArtifacts;
  #candidateCache = new Map();
  #metadataCache = new Map();

  constructor(options = {}) {
    if (typeof options.fetch !== "function" && typeof globalThis.fetch !== "function") {
      throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "Package resolver requires fetch");
    }
    this.#fetch = options.fetch || globalThis.fetch.bind(globalThis);
    this.#indexes = acceptedIndexes(options.indexes || []);
    this.#bundledArtifacts = new Map();
    if (options.bundledArtifacts !== undefined && !Array.isArray(options.bundledArtifacts)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Package bundledArtifacts must be an array");
    }
    for (const [index, artifact] of (options.bundledArtifacts || []).entries()) {
      const sha256 = acceptedSha256(artifact?.sha256, `Bundled artifact ${index} hash`);
      if (this.#bundledArtifacts.has(sha256)) {
        throw new PyProcError("PYPROC_INPUT_INVALID", `Bundled package artifact digest is duplicated: ${sha256}`);
      }
      this.#bundledArtifacts.set(sha256, bytesValue(artifact?.bytes, `Bundled artifact ${index}`));
    }
    this.pythonVersion = options.pythonVersion || "3.14.6";
    versionParts(this.pythonVersion);
    const markerEnvironment = { implementation_name: "cpython",
      implementation_version: this.pythonVersion, os_name: "posix", platform_machine: "wasm32",
      platform_python_implementation: "CPython", platform_release: "", platform_system: "WASI",
      platform_version: "", python_full_version: this.pythonVersion,
      python_version: versionParts(this.pythonVersion).release.slice(0, 2).join("."), sys_platform: "wasi",
      ...(options.markerEnvironment || {}) };
    if (Object.entries(markerEnvironment).some(([key, value]) => !markerVariables.has(key) || key === "extra"
      || typeof value !== "string")) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Package marker environment has an unknown or non-string value");
    }
    this.markerEnvironment = immutablePackageValue(markerEnvironment);
    const allowedTags = options.allowedTags || ["py3-none-any"];
    if (!Array.isArray(allowedTags) || !allowedTags.length
      || allowedTags.some((tag) => typeof tag !== "string" || !/^[A-Za-z0-9_.]+-[A-Za-z0-9_.]+-[A-Za-z0-9_.]+$/u.test(tag))
      || new Set(allowedTags).size !== allowedTags.length) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Package allowedTags must be unique compatibility tags");
    }
    this.allowedTags = Object.freeze([...allowedTags].sort());
    if (typeof options.nativeProfile !== "undefined" && (typeof options.nativeProfile !== "string" || !options.nativeProfile)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Package nativeProfile must be a non-empty string");
    }
    this.nativeProfile = options.nativeProfile || "pure-python";
    if (options.engineId !== undefined && options.engineId !== null
      && (typeof options.engineId !== "string" || !options.engineId)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Package engineId must be null or a non-empty string");
    }
    this.engineId = options.engineId || null;
    this.prereleasePolicy = acceptedPolicy(options.prereleasePolicy, ["forbid", "explicit"], "forbid", "Prerelease");
    this.yankedPolicy = acceptedPolicy(options.yankedPolicy, ["forbid", "lockedOnly"], "forbid", "Yanked");
  }

  async #request(url, options, label) {
    try { return await this.#fetch(url, options); }
    catch (error) {
      if (error instanceof PyProcError) throw error;
      throw resolution(`Package network request failed for ${label}`, { url, cause: String(error?.message || error) });
    }
  }

  async #simpleProject(name) {
    if (this.#candidateCache.has(name)) return this.#candidateCache.get(name);
    for (const index of this.#indexes) {
      const endpoint = new URL(`${encodeURIComponent(name)}/`, index.url).href;
      const response = await this.#request(endpoint, { headers: { Accept: SIMPLE_JSON_MEDIA } }, name);
      if (response?.status === 404) continue;
      if (!response?.ok) throw resolution(`Simple API request failed for ${name}`, { endpoint, status: response?.status });
      if (response.url && response.url !== endpoint) {
        throw resolution(`Simple API project endpoint redirected outside its locked URL: ${response.url}`);
      }
      const contentType = String(responseHeader(response, "content-type") || "").split(";", 1)[0].trim().toLowerCase();
      const media = /^application\/vnd\.pypi\.simple\.v(\d+)\+json$/u.exec(contentType);
      if (!media || media[1] !== "1") throw resolution(`Simple API response has an unsupported media type: ${contentType}`);
      let document;
      try { document = await response.json(); }
      catch (error) { throw resolution(`Simple API response is not JSON for ${name}`); }
      const apiVersion = String(document?.meta?.["api-version"] || "1.0");
      if (apiVersion.split(".")[0] !== "1") throw resolution(`Simple API major version is unsupported: ${apiVersion}`);
      if (normalizePackageName(document?.name || name) !== name || !Array.isArray(document?.files)) {
        throw resolution(`Simple API project identity is invalid for ${name}`);
      }
      const candidates = [];
      for (const file of document.files) {
        if (typeof file?.filename !== "string" || !file.filename.endsWith(".whl")) continue;
        let wheel;
        try { wheel = parseWheelFilename(file.filename); }
        catch (error) { continue; }
        if (normalizePackageName(wheel.distribution) !== name || !wheel.tags.some((tag) => this.allowedTags.includes(tag))) continue;
        if (wheel.abi.split(".").some((tag) => tag !== "none") || wheel.platform.split(".").some((tag) => tag !== "any")) continue;
        if (!file.hashes?.sha256 || !Number.isSafeInteger(file.size) || file.size < 0) continue;
        const metadataHash = typeof file["core-metadata"] === "object" ? file["core-metadata"]?.sha256 : null;
        if (!metadataHash) continue;
        const requiresPython = canonicalRequiresPython(file["requires-python"] || null);
        if (requiresPython && !String(requiresPython).split(",").every((item) => matchesSpecifier(this.pythonVersion, item))) continue;
        if (this.prereleasePolicy === "forbid" && isPrerelease(wheel.version)) continue;
        if (file.yanked) continue;
        candidates.push(Object.freeze({ name, version: wheel.version, filename: file.filename,
          url: acceptedUrl(new URL(file.url, endpoint).href, `${file.filename} URL`),
          sha256: acceptedSha256(file.hashes.sha256, `${file.filename} hash`),
          size: file.size, requiresPython, metadataSha256: acceptedSha256(metadataHash, `${file.filename} metadata hash`),
          sourceIndex: index.url, yanked: file.yanked || false, provenanceUrl: endpoint }));
      }
      candidates.sort((left, right) => comparePackageVersions(right.version, left.version)
        || compareNames(left.filename, right.filename));
      const result = Object.freeze(candidates);
      this.#candidateCache.set(name, result);
      return result;
    }
    throw resolution(`No configured index contains package ${name}`);
  }

  async #candidateMetadata(candidate) {
    if (this.#metadataCache.has(candidate.metadataSha256)) return this.#metadataCache.get(candidate.metadataSha256);
    const metadataUrl = `${candidate.url}.metadata`;
    const response = await this.#request(metadataUrl, { headers: { Accept: "text/plain" } }, `${candidate.filename} metadata`);
    if (!response?.ok) throw resolution(`Package metadata request failed for ${candidate.filename}`, {
      metadataUrl, status: response?.status,
    });
    const bytes = await responseBytes(response);
    const actual = await sha256Address(bytes);
    if (actual !== candidate.metadataSha256) {
      throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Package metadata hash differs from the Simple API", {
        context: { filename: candidate.filename, expected: candidate.metadataSha256, actual },
      });
    }
    let headers;
    try { headers = metadataHeaders(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch (error) {
      if (error instanceof PyProcError) throw error;
      throw resolution(`Package metadata is not valid UTF-8: ${candidate.filename}`);
    }
    if (normalizePackageName(headers.get("name")?.[0] || "") !== candidate.name
      || headers.get("version")?.[0] !== candidate.version) {
      throw resolution(`Package metadata identity differs from ${candidate.filename}`);
    }
    const result = Object.freeze({ ...candidate,
      dependencies: Object.freeze([...(headers.get("requires-dist") || [])].sort(compareNames)) });
    this.#metadataCache.set(candidate.metadataSha256, result);
    return result;
  }

  async #search(pending, selected, expandedExtras) {
    if (!pending.length) return selected;
    const [requirement, ...remaining] = pending;
    if (requirement.marker && !evaluatePackageMarker(requirement.marker, { ...this.markerEnvironment, extra: "" })) {
      return this.#search(remaining, selected, expandedExtras);
    }
    const existing = selected.get(requirement.name);
    if (existing) {
      if (!requirementAllows(requirement, existing.version)) return null;
      const knownExtras = expandedExtras.get(requirement.name) || new Set();
      const newExtras = requirement.extras.filter((extra) => !knownExtras.has(extra));
      if (!newExtras.length) return this.#search(remaining, selected, expandedExtras);
      const nextExpanded = new Map(expandedExtras);
      nextExpanded.set(requirement.name, new Set([...knownExtras, ...newExtras]));
      const dependencies = dependencyRequirements(existing, newExtras, this.markerEnvironment);
      return this.#search([...dependencies, ...remaining], selected, nextExpanded);
    }
    const candidates = (await this.#simpleProject(requirement.name))
      .filter((candidate) => requirementAllows(requirement, candidate.version)
        && (!isPrerelease(candidate.version) || this.prereleasePolicy === "explicit"
          && explicitlyRequestsPrerelease(requirement, candidate.version)));
    for (const rawCandidate of candidates) {
      const candidate = await this.#candidateMetadata(rawCandidate);
      const nextSelected = new Map(selected);
      nextSelected.set(requirement.name, candidate);
      const nextExpanded = new Map(expandedExtras);
      nextExpanded.set(requirement.name, new Set(requirement.extras));
      const dependencies = dependencyRequirements(candidate, requirement.extras, this.markerEnvironment);
      const result = await this.#search([...dependencies, ...remaining], nextSelected, nextExpanded);
      if (result) return result;
    }
    return null;
  }

  async resolve(requirements) {
    if (!Array.isArray(requirements) || !requirements.length) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "resolve requires at least one package requirement");
    }
    const parsed = requirements.map(parsePackageRequirement)
      .sort((left, right) => compareNames(left.raw, right.raw));
    const selected = await this.#search(parsed, new Map(), new Map());
    if (!selected) throw resolution(`Package dependency conflict: ${parsed.map((item) => item.raw).join(", ")}`);
    const packages = [...selected.values()].sort((left, right) => compareNames(left.name, right.name)).map((candidate) => ({
      name: candidate.name, version: candidate.version, filename: candidate.filename, url: candidate.url,
      sha256: candidate.sha256, size: candidate.size, requiresPython: candidate.requiresPython,
      dependencies: [...candidate.dependencies], metadataSha256: candidate.metadataSha256,
      sourceIndex: candidate.sourceIndex, yanked: candidate.yanked, provenanceUrl: candidate.provenanceUrl,
    }));
    const lock = immutablePackageValue({ protocol: PACKAGE_LOCK_PROTOCOL, version: PACKAGE_LOCK_VERSION,
      resolverVersion: PACKAGE_RESOLVER_VERSION, requirements: parsed.map((item) => item.raw),
      indexes: this.#indexes.map(({ url, trustRef }) => ({ url, trustRef })), pythonVersion: this.pythonVersion,
      markerEnvironment: this.markerEnvironment, allowedTags: [...this.allowedTags], engineId: this.engineId,
      nativeProfile: this.nativeProfile,
      prereleasePolicy: this.prereleasePolicy, yankedPolicy: this.yankedPolicy, packages });
    return Object.freeze({ lock, lockDigest: await sha256Address(canonicalPackageJson(lock)) });
  }

  async validateLock(input) {
    if (!input || typeof input !== "object" || input.protocol !== PACKAGE_LOCK_PROTOCOL
      || input.version !== PACKAGE_LOCK_VERSION || input.resolverVersion !== PACKAGE_RESOLVER_VERSION
      || input.pythonVersion !== this.pythonVersion || input.engineId !== this.engineId
      || input.nativeProfile !== this.nativeProfile
      || input.prereleasePolicy !== this.prereleasePolicy || input.yankedPolicy !== this.yankedPolicy
      || canonicalPackageJson(input.markerEnvironment) !== canonicalPackageJson(this.markerEnvironment)
      || canonicalPackageJson(input.allowedTags) !== canonicalPackageJson(this.allowedTags)
      || canonicalPackageJson(input.indexes) !== canonicalPackageJson(this.#indexes.map(({ url, trustRef }) => ({ url, trustRef })))
      || !Array.isArray(input.requirements) || !Array.isArray(input.packages)) {
      throw resolution("Package lock does not match this resolver environment");
    }
    const canonicalRequirements = input.requirements.map((requirement) => parsePackageRequirement(requirement).raw)
      .sort(compareNames);
    if (canonicalPackageJson(input.requirements) !== canonicalPackageJson(canonicalRequirements)) {
      throw resolution("Package lock requirements are not canonical");
    }
    const names = new Set();
    let priorName = "";
    for (const entry of input.packages) {
      const name = normalizePackageName(entry?.name || "");
      const wheel = parseWheelFilename(entry.filename || "");
      const dependencies = Array.isArray(entry.dependencies) ? entry.dependencies
        .map((dependency) => parsePackageRequirement(dependency).raw)
        .sort(compareNames) : null;
      if (names.has(name) || compareNames(name, priorName) < 0 || entry.name !== name
        || typeof entry.version !== "string" || typeof entry.filename !== "string"
        || normalizePackageName(wheel.distribution) !== name || wheel.version !== entry.version
        || !wheel.tags.some((tag) => this.allowedTags.includes(tag))
        || !Number.isSafeInteger(entry.size) || entry.size < 0 || dependencies === null
        || canonicalPackageJson(entry.dependencies) !== canonicalPackageJson(dependencies)
        || entry.requiresPython !== canonicalRequiresPython(entry.requiresPython)
        || entry.yanked !== false && entry.yanked !== true && typeof entry.yanked !== "string"
        || this.yankedPolicy === "forbid" && entry.yanked !== false) {
        throw resolution("Package lock package entries are not canonical");
      }
      versionParts(entry.version);
      if (entry.requiresPython && !entry.requiresPython.split(",").every((item) => matchesSpecifier(this.pythonVersion, item))) {
        throw resolution(`Package lock Requires-Python is incompatible: ${entry.filename}`);
      }
      acceptedUrl(entry.url, `${entry.filename} URL`);
      acceptedUrl(entry.provenanceUrl, `${entry.filename} provenance URL`);
      acceptedSha256(entry.sha256, `${entry.filename} hash`);
      acceptedSha256(entry.metadataSha256, `${entry.filename} metadata hash`);
      if (!this.#indexes.some((index) => index.url === entry.sourceIndex)) {
        throw resolution(`Package lock uses an untrusted source index: ${entry.sourceIndex}`);
      }
      names.add(name);
      priorName = name;
    }
    const lock = immutablePackageValue(JSON.parse(canonicalPackageJson(input)));
    return Object.freeze({ lock, lockDigest: await sha256Address(canonicalPackageJson(lock)) });
  }

  async materialize(input, { contentStore, offline = false } = {}) {
    if (!contentStore || typeof contentStore.get !== "function" || typeof contentStore.put !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "materialize requires a package content store");
    }
    const { lock, lockDigest } = await this.validateLock(input);
    const wheels = [];
    for (const entry of lock.packages) {
      let bytes = await contentStore.get(entry.sha256);
      let source = "content-store";
      if (!bytes) {
        const bundled = this.#bundledArtifacts.get(entry.sha256);
        if (bundled) {
          bytes = bundled.slice();
          source = "package";
        } else {
          if (offline) throw resolution(`Offline package artifact is absent from the content store or package: ${entry.filename}`);
          const response = await this.#request(entry.url, { headers: { Accept: "application/octet-stream" } }, entry.filename);
          if (!response?.ok) throw resolution(`Package artifact request failed for ${entry.filename}`, { status: response?.status });
          const declaredLength = responseHeader(response, "content-length");
          bytes = await responseBytes(response);
          if (declaredLength !== null && Number(declaredLength) !== entry.size) {
            throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `Package Content-Length differs from lock: ${entry.filename}`);
          }
          if (bytes.byteLength !== entry.size || await sha256Address(bytes) !== entry.sha256) {
            throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `Package bytes differ from lock: ${entry.filename}`);
          }
          source = "network";
        }
        await contentStore.put(entry.sha256, bytes);
      }
      if (bytes.byteLength !== entry.size || await sha256Address(bytes) !== entry.sha256) {
        throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `Cached package bytes differ from lock: ${entry.filename}`);
      }
      wheels.push(Object.freeze({ package: entry, bytes: bytes.slice(), source }));
    }
    return Object.freeze({ lock, lockDigest, offline, wheels: Object.freeze(wheels) });
  }
}
