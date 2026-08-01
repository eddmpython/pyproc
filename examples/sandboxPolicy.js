// Public demos run trusted boot and package preparation first, then close the document's
// network boundary before any agent-supplied Python runs. MachineJail's Python module is the
// cooperative tier; this CSP meta is the browser-enforced tier that also catches import js.
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
