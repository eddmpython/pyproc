// motorTaskSession.js - public Control facade의 target, session, artifact cleanup 수명주기.

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requirementOf(situation, requirementRef) {
  const matches = situation.requirements?.filter((entry) => entry.requirementRef === requirementRef) || [];
  if (matches.length !== 1) throw new TypeError("Motor task requirement must be unique");
  return matches[0];
}

function artifactRefs(situation) {
  return (situation.visualProbes || []).map((probe) => probe?.artifact?.artifactRef)
    .filter((ref) => typeof ref === "string");
}

function cleanupFailure(phase, error) {
  return Object.freeze({ phase, code: String(error?.code || "MOTOR_TASK_CLEANUP_FAILED") });
}

export class MotorTaskSession {
  static async open(client, input = {}, requestOptions = {}) {
    object(client, "Motor task Control client");
    const config = object(input, "Motor task input");
    const hasUrl = typeof config.url === "string" && config.url.length > 0;
    const hasTarget = typeof config.targetRef === "string" && config.targetRef.length > 0;
    if (hasUrl === hasTarget) throw new TypeError("Motor task requires exactly one url or targetRef");
    let targetRef = config.targetRef || null;
    let ownedTarget = false;
    if (hasUrl) {
      const opened = await client.openTarget(config.url, { expectedRisk: config.expectedRisk || "externalEffect",
        waitUntil: config.waitUntil || "commit", ...requestOptions });
      targetRef = opened.output.targetRef;
      ownedTarget = true;
    }
    try {
      const attached = await client.attachSession(targetRef, requestOptions);
      return new MotorTaskSession(client, { targetRef, sessionRef: attached.output, ownedTarget,
        retainArtifacts: config.retainArtifacts === true });
    } catch (error) {
      if (ownedTarget) await client.closeTarget(targetRef, requestOptions).catch(() => {});
      throw error;
    }
  }

  constructor(client, { targetRef, sessionRef, ownedTarget, retainArtifacts }) {
    this.client = client;
    this.targetRef = targetRef;
    this.sessionRef = Object.freeze({ ...sessionRef });
    this.ownedTarget = ownedTarget;
    this.retainArtifacts = retainArtifacts;
    this.artifacts = new Set();
    this.retained = new Set();
    this.situations = new Set();
    this.closed = false;
    this.cleanupResult = null;
  }

  _open() {
    if (this.closed) throw new Error("Motor task session is closed");
  }

  async situate(focus, options = {}, requestOptions = {}) {
    this._open();
    const result = await this.client.perception(this.sessionRef).situate(focus, options, requestOptions);
    for (const ref of artifactRefs(result.situation)) this.artifacts.add(ref);
    this.situations.add(result.situation.integrity.canonicalSha256);
    return result;
  }

  diagnoseAmbiguity(situationInput, requirementRef) {
    this._open();
    const situation = object(situationInput?.situation || situationInput, "SituationCapsule");
    const requirement = requirementOf(situation, requirementRef);
    const executable = requirement.state === "satisfied" && requirement.cardinality === "one"
      && requirement.matched === 1 && requirement.entityRefs.length === 1
      && !situation.unknowns.some((entry) => entry.requirementRef === requirementRef);
    return Object.freeze({
      protocol: "pyproc.motorAmbiguityDiagnostic",
      version: 1,
      requirementRef,
      state: executable ? "unique" : requirement.matched > 1 ? "ambiguous" : "incomplete",
      matched: requirement.matched,
      canExecute: executable,
      requiredCallerRefinement: executable ? Object.freeze([]) : Object.freeze([
        Object.freeze({ predicate: "semantic.name", operator: "exact" }),
        Object.freeze({ predicate: "semantic.state", operator: "equals" }),
        Object.freeze({ predicate: "interaction.actionable", operator: "equals" }),
        Object.freeze({ predicate: "kind", operator: "equals" }),
      ]),
    });
  }

  execute(input, requestOptions = {}) {
    this._open();
    const operation = object(input, "Motor task execution");
    const situation = object(operation.situation?.situation || operation.situation, "SituationCapsule");
    if (!this.situations.has(situation.integrity?.canonicalSha256)) {
      throw new TypeError("Motor task can execute only a SituationCapsule observed by this session");
    }
    const requirement = requirementOf(situation, operation.requirementRef);
    if (requirement.state !== "satisfied" || requirement.cardinality !== "one" || requirement.matched !== 1
      || situation.unknowns.some((entry) => entry.requirementRef === operation.requirementRef)) {
      throw new TypeError("Motor task requires explicit refinement to one complete target before execution");
    }
    return this.client.executeMotor({ ...operation, situation, sessionRef: this.sessionRef }, requestOptions);
  }

  retainArtifact(artifactRef) {
    this._open();
    if (!this.artifacts.has(artifactRef)) throw new TypeError("Motor task artifact is not owned by this session");
    this.retained.add(artifactRef);
    return Object.freeze({ artifactRef, retained: true });
  }

  async close(requestOptions = {}) {
    if (this.cleanupResult) return this.cleanupResult;
    this.closed = true;
    const failures = [];
    try { await this.client.detachSession(this.sessionRef, requestOptions); }
    catch (error) { failures.push(cleanupFailure("sessionDetach", error)); }
    if (!this.retainArtifacts) {
      for (const artifactRef of [...this.artifacts].filter((ref) => !this.retained.has(ref)).sort()) {
        try { await this.client.deleteArtifact(artifactRef, requestOptions); }
        catch (error) { failures.push(cleanupFailure("artifactDelete", error)); }
      }
    }
    if (this.ownedTarget) {
      try { await this.client.closeTarget(this.targetRef, requestOptions); }
      catch (error) { failures.push(cleanupFailure("targetClose", error)); }
    }
    this.cleanupResult = Object.freeze({ protocol: "pyproc.motorTaskCleanup", version: 1,
      state: failures.length ? "incomplete" : "complete", effectRetried: false,
      targetOwnership: this.ownedTarget ? "owned" : "borrowed", artifactsRetained: this.retained.size,
      failures: Object.freeze(failures) });
    return this.cleanupResult;
  }
}
