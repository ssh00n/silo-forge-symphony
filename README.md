# Silo Forge Symphony

Upstream-aligned Symphony runtime workspace for the Silo Forge execution plane.

Fork lineage:

- derived from [`openai/symphony`](https://github.com/openai/symphony)
- adapted as the runtime integration layer for `Silo Forge`

This repository is the runtime plane for:

- tracker intake and scheduling
- worker dispatch
- workspace lifecycle
- Silo Forge bridge callbacks

It is intentionally separate from:

- `silo-forge`, which owns the control plane
- blueprint/catalog repositories, which own authored role packs and templates
- `openai/symphony`, which remains the upstream runtime reference

## Current role

This repository should be treated as an upstream-aligned integration runtime, not as a separate product.

The local delta should stay as small as possible and focus on:

1. Silo Forge dispatch intake
2. Silo Forge callback reporting
3. local development and deployment wrappers
4. runtime-specific compatibility glue that does not belong in the control plane

## Layout

- `src/`: runtime source
- `test/`: unit and integration tests
- `deploy/`: runtime-owned service and deploy assets
- `docs/`: runtime-facing docs
- `examples/`: example authored inputs consumed by the runtime

## Working model

- follow upstream Symphony concepts and boundaries
- keep the bridge contract compatible with Silo Forge
- prefer generated contract artifacts over hand-maintained duplicated interfaces
- refresh generated schemas from the control-plane repo with `cd ../openclaw-mission-control && make contracts-gen`
- keep release and runtime concerns separate from the control plane repo

## Attribution

This repository includes derivative work based on `openai/symphony` and keeps the upstream Apache 2.0 license and attribution in place. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
