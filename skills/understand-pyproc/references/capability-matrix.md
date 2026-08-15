# Capability matrix

| Capability | Public surface | State | Evidence boundary |
|---|---|---|---|
| CPython execution | `boot`, `machine.run.python` | Complete | Installed Chrome and Edge gates |
| Typed values | `run.get`, `run.set`, ValueEnvelope | Complete | Contract matrix and browser probe |
| Checkpoint and restore | `machine.history` | Complete | Branch, corruption, wrong identity, and crash fixtures |
| Process clone | `machine.proc.clone` | Complete | Fresh worker, exact state, terminal truth |
| Machine image | `history.export`, `open(image)` | Complete | Engine-reference-only image and offline reopen |
| Pure Python packages | `PackageEnvironment` | Complete | Simple API, hash, tag, metadata, and archive fixtures |
| Curated native profiles | static engine profile | Bounded | Exact engine identity required |
| Terminal | `machine.terminal()` | Complete | Version 2 command and package routing contracts |
| VFS and OPFS | `KernelVfs` | Complete | Atomic commit and crash recovery matrix |
| HTTP and ASGI | product host adapters | Complete | Authority, stream credit, cancellation, and ASGI exchange |
| Socket relay | product host adapter | Bounded | Relay required, half-close and loss fixtures |
| GPU | product host adapter | Bounded | Explicit injected array provider and digest checks |
| Clipboard and framebuffer | product host adapters | Bounded | Redaction and frame digest contracts |
| WebComputer | `createWebComputer` | Complete | Owned kernel guest and signed WebMachine image |
| x86 guest | `createV86GuestFactory` | Optional | Consumer supplies emulator and boot assets |

The package does not claim native POSIX parity, arbitrary binary wheel support, raw sockets, native `fork`,
or cross-browser support outside the documented boundary.
