import { SkillOsError, utf8Compare } from "./common.mjs";
import { verifyCatalogDigest } from "./skillCatalog.mjs";

const MAX_RESULTS = 3;
const MAX_RESPONSE_BYTES = 4 * 1024;

export function normalizeSkillQuery(query) {
  const value = String(query || "").normalize("NFKC").replaceAll("\\", "/")
    .replace(/[A-Z]/gu, (letter) => letter.toLowerCase()).trim();
  const phrases = [...value.matchAll(/"([^"\n]+)"/gu)].map((match) => match[1].trim()).filter(Boolean);
  const unquoted = value.replace(/"[^"\n]+"/gu, " ");
  const tokens = unquoted.match(/[\p{L}\p{N}_./:-]+/gu)?.filter((token) => /[\p{L}\p{N}]/u.test(token)) || [];
  return Object.freeze({ value, phrases: Object.freeze([...new Set(phrases)]),
    tokens: Object.freeze([...new Set(tokens)]) });
}

function rank(record, normalized) {
  const name = record.name.normalize("NFKC").toLowerCase();
  const description = record.description.normalize("NFKC").replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
  if (normalized.value === name) return { score: 600, match: ["exact-name"] };
  if (normalized.phrases.length && normalized.phrases.every((phrase) => description.includes(phrase))) {
    return { score: 500 + normalized.phrases.length, match: ["quoted-description"] };
  }
  if (normalized.tokens.length && normalized.tokens.every((token) => description.includes(token))) {
    return { score: 400 + normalized.tokens.length, match: ["all-description-tokens"] };
  }
  if (normalized.tokens.some((token) => record.path.toLowerCase().includes(token))) {
    return { score: 300, match: ["path-token"] };
  }
  const matched = normalized.tokens.filter((token) => description.includes(token));
  if (matched.length) return { score: 100 + matched.length, match: ["partial-description-token"] };
  return { score: 0, match: [] };
}

export function searchSkills(catalog, query, { limit = MAX_RESULTS } = {}) {
  verifyCatalogDigest(catalog);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    throw new SkillOsError("SKILL_SEARCH_INVALID", "skill search limit must be between 1 and 3");
  }
  const normalized = normalizeSkillQuery(query);
  if (!normalized.tokens.length && !normalized.phrases.length && normalized.value !== "") {
    return Object.freeze({ catalogDigest: catalog.catalogDigest, results: Object.freeze([]), truncated: false });
  }
  const ranked = catalog.skills.map((record) => ({ record, ...rank(record, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || utf8Compare(left.record.name, right.record.name));
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].score < 600) {
    throw new SkillOsError("SKILL_SEARCH_AMBIGUOUS", `skill search is ambiguous: ${ranked[0].record.name}, ${ranked[1].record.name}`);
  }
  const selected = ranked.slice(0, limit).map(({ record, match }) => Object.freeze({ name: record.name,
    description: record.description, path: record.path, sha256: record.sha256, match }));
  while (selected.length && Buffer.byteLength(JSON.stringify({ catalogDigest: catalog.catalogDigest,
    results: selected, truncated: ranked.length > selected.length })) > MAX_RESPONSE_BYTES) selected.pop();
  if (ranked.length && !selected.length) throw new SkillOsError("SKILL_RESOURCE_LIMIT", "skill search response exceeds 4 KiB");
  return Object.freeze({ catalogDigest: catalog.catalogDigest, results: Object.freeze(selected),
    truncated: ranked.length > selected.length });
}

export const SKILL_SEARCH_LIMITS = Object.freeze({ results: MAX_RESULTS, responseBytes: MAX_RESPONSE_BYTES });
