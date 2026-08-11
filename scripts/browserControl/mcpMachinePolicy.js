// The machine boots trusted engine assets first, then this policy closes external network access.
export function installFailClosedNetworkPolicy(machine) {
  const policy = machine.runtime.enableJail({
    net: false,
    clipboard: false,
    home: false,
    workers: false,
  });
  if (!document.querySelector("meta[data-pyproc-network-policy]")) {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = policy.jail.csp();
    meta.dataset.pyprocNetworkPolicy = "fail-closed";
    document.head.append(meta);
  }
  return policy;
}
