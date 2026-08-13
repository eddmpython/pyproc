// Rehearse-Commit installed gates가 같은 verified Evidence Pack shape를 사용한다.

export function effectEvidenceManifest(repository, projectId) {
  const address = (digit) => `sha256:${digit.repeat(64)}`;
  return Object.freeze({
    producerVersion: "installed-contract", projectId, contractSha256: address("3"),
    scenarioCatalogSha256: address("4"), baselineCatalogSha256: address("5"), eyesSha256: address("6"),
    fixtureSha256: address("7"), policySha256: address("8"), browserFamily: "chromium",
    browserVersion: "installed-contract", environmentId: "installed-contract", viewportSha256: address("9"),
    locale: "en-US", timezoneId: "UTC", fontFingerprint: "installed-contract", providerKind: "nativeCdp",
    perception: "apx.situation/1.0", repository: Object.freeze({ commit: repository.commit,
      treeSha256: repository.treeSha256, diffSha256: repository.diffSha256, untracked: repository.untracked }),
  });
}

export async function publishVerifiedEffectPack({ createEvidencePack, publishEvidencePack, repositoryRoot,
  outputDir, repository, projectId, transaction }) {
  const pack = createEvidencePack({ manifest: effectEvidenceManifest(repository, projectId),
    scenarioRuns: [{ scenarioId: transaction.transactionId, required: true, terminal: "verified",
      effectTransaction: { transactionId: transaction.transactionId,
        intentSha256: transaction.intent.contentSha256,
        effectResultSha256: transaction.effectResult.contentSha256,
        sessionTerminalSha256: transaction.session.terminalSha256 } }], findings: [], verdict: "verified" });
  return publishEvidencePack({ repositoryRoot, outputDir, pack });
}
