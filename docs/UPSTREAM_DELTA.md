# Upstream Delta

## Goal

Track the current local delta between this repository and upstream
`openai/symphony`.

This file exists to keep the fork narrow.

See also:

- `docs/UPSTREAM_ALIGNMENT.md`

## Rule

If a local change is not required for Mission Control integration or deployment,
it should be reconsidered for removal or upstream alignment.

Because upstream is currently spec-first with an Elixir reference implementation,
alignment should be measured primarily against `README.md` and `SPEC.md`, not a
TypeScript file tree.

## Current Delta Categories

| Area | Local status | Direction |
| --- | --- | --- |
| `src/control-plane/mission-control-server.ts` | Local-only | Keep as Mission Control bridge delta |
| `src/control-plane/mission-control-callbacks.ts` | Local-only | Keep as Mission Control bridge delta |
| `src/control-plane/mission-control-types.ts` | Local-only | Keep isolated from core runtime |
| `src/orchestrator/orchestrator.ts` Mission Control dispatch path | Local-only | Keep minimal and isolate further if possible |
| `deploy/systemd/symphony.service` | Local deployment wrapper | Keep if needed, separate from runtime logic |
| `deploy/scripts/deploy-symphony.sh` | Local deployment wrapper | Keep if needed, separate from runtime logic |
| Linear tracker behavior | Existing local behavior | Re-evaluate against upstream, do not expand unless required |

## Isolation Moves Completed

- Mission Control request/response/callback types now live under `src/control-plane/`
- core domain types in `src/types.ts` no longer carry the bridge payload schemas
- bridge server startup is now explicit from `src/index.ts` when `--port` is provided
- Mission Control run binding is now stored in an orchestrator-local map instead of
  embedding callback state into `RunningEntry`

## Next Isolation Moves

1. document exactly which runtime hooks differ from upstream behavior
2. compare local orchestrator flow against upstream before adding new core behavior
