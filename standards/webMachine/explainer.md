# Web Machine Core v1 Explainer

## User need

A web application can already run work in workers and WebAssembly, but each runtime tends to invent its own lifecycle, device access, cancellation meaning, snapshot shape, and inspection model. A controller that wants to move a machine between pages, processes, or implementations has no small common contract to target.

Web Machine Core v1 defines that contract. A controller can create a named machine, grant only named devices, run ordered requests, inspect state, and move portable snapshot content without learning the guest engine.

## Goals

- Keep the host independent of guest engines and application frameworks.
- Make lifecycle state and invalid transitions observable.
- Require device declarations and grants before guest boot.
- Serialize operations per machine so callers can reason about order.
- Distinguish cancellation before dispatch from cancellation after effects may have begun.
- Define portable and session snapshot boundaries.
- Define deterministic portable image metadata that can be signed by a higher layer.
- Supply executable vectors that different implementations can share.

## Non-goals

- Defining a guest instruction set, operating system, language, or package manager.
- Standardizing a browser storage backend, worker layout, network stack, or user interface.
- Granting ambient browser capabilities to a guest.
- Defining key trust, certificate policy, or archive byte layout.
- Claiming that a product-specific `.webmachine` binary archive is part of the core protocol.

## Shape

A host registers adapter factories and named devices. A machine binds one adapter identifier, a guest manifest, and a device allowlist. The adapter reports its version, snapshot scope, and required devices. The host validates that contract before calling `boot()`.

Each machine has one operation queue. Lifecycle calls and guest requests enter that queue. Inspection returns host state and a guest-defined summary, not a live capability object. A snapshot is an opaque byte payload inside a versioned envelope. Portable snapshots may be restored into a cold machine with the same identity and adapter contract. Session snapshots remain bound to one instance.

The portable image manifest describes machines, block devices, and their one-to-one content-addressed blobs. The manifest signature shape is defined so implementations can exchange metadata, while trust decisions remain with the embedding application.

## Alternatives considered

Using worker messages directly is simple for one application, but it does not define lifecycle transitions, permissions, snapshot compatibility, or post-dispatch cancellation. Exposing every guest as a remote object also leaks engine-specific methods and live capabilities across the boundary. A virtual hardware specification would be too large and would exclude language runtimes that need the same controller semantics without emulated hardware.

The selected protocol stays above those mechanisms. Implementations may use workers, processes, emulators, interpreters, or remote execution, provided they preserve the observable contract.

## Privacy, security, accessibility, and internationalization

The protocol grants no ambient device access. An adapter declares each required device and the machine permission list must name it before boot. Inspection is intentionally summary-shaped, and implementations should minimize identifiers and guest data returned to callers. Post-dispatch cancellation never authorizes automatic replay.

The protocol has no user interface, but products exposing it must preserve user intent, explain permission grants, and make lifecycle and error state available to assistive technology. Identifiers are Unicode strings ordered by their UTF-8 bytes for deterministic manifests. Human-facing text is not placed in the wire contract.

