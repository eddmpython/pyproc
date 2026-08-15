// The machine boots trusted engine assets first, then this policy closes external network access.
export function installFailClosedNetworkPolicy(machine, { frameOrigins = [] } = {}) {
  if (!machine?.kernel) throw new TypeError("an owned kernel Machine is required");
  const frameSrc = frameOrigins.length ? `; frame-src ${frameOrigins.join(" ")}` : "";
  const policy = Object.freeze({
    csp: `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${frameSrc}`,
  });
  if (!document.querySelector("meta[data-pyproc-network-policy]")) {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = policy.csp;
    meta.dataset.pyprocNetworkPolicy = "fail-closed";
    document.head.append(meta);
  }
  return policy;
}
