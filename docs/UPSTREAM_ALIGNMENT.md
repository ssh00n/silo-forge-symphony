# Upstream Alignment

## Current Upstream Reality

Upstream Symphony is:

- public repository: `https://github.com/openai/symphony`
- product/spec source for Symphony behavior
- currently centered on:
  - `SPEC.md`
  - Elixir reference implementation under `elixir/`

It is not currently a TypeScript runtime repository that our local source can
cleanly fast-forward against file-by-file.

That means our local repository should be treated as:

- a spec-aligned integration workspace
- a Mission Control-oriented runtime implementation
- a narrow delta layered on top of upstream Symphony concepts

Not as:

- an unrelated standalone product
- a control plane
- a blueprint catalog

## What We Align To

Primary alignment targets:

1. upstream product boundary from `README.md`
2. upstream goals and non-goals from `SPEC.md`
3. upstream runtime contracts from `SPEC.md`

## Relevant Upstream Signals

From upstream `README.md`:

- Symphony turns project work into isolated autonomous implementation runs.
- It is positioned as the execution runtime, not the control plane.
- Upstream currently offers a spec and an Elixir reference implementation.

From upstream `SPEC.md`:

- Symphony is a scheduler/runner and tracker reader.
- Symphony goal: poll the issue tracker, dispatch work with bounded concurrency,
  maintain orchestrator state, preserve deterministic per-issue workspaces, and
  recover from transient failures.
- Symphony non-goal: rich web UI or multi-tenant control plane.
- Symphony non-goal: built-in business logic for ticket editing, PR state, or
  dashboard/product behavior.
- Workflow behavior is driven by repository-owned `WORKFLOW.md`.
- Extensions are allowed, including optional HTTP server surfaces.

## Local Alignment Assessment

| Local area | Alignment status | Action |
| --- | --- | --- |
| Scheduler/retry/reconcile loop | Aligned in shape | Keep aligned |
| Per-issue workspace preservation | Aligned in shape | Keep aligned |
| `WORKFLOW.md`-driven runtime | Aligned in shape | Keep aligned |
| Structured logs / runtime observability | Aligned in spirit | Keep aligned |
| Linear tracker reader model | Aligned with current upstream spec | Avoid unnecessary divergence |
| Mission Control HTTP dispatch endpoint | Spec extension | Keep as narrow local extension |
| Mission Control callback sender | Spec extension | Keep as narrow local extension |
| Multi-tenant silo/policy/governance logic | Not part of Symphony | Keep out of runtime |
| Approval and task business logic | Not part of Symphony | Keep in Mission Control |

## Boundary Consequences

Because upstream is spec-first and runtime-light:

- we should compare our runtime to upstream contracts, not try to mirror file layout
- local TypeScript implementation can evolve, but must stay inside upstream product boundaries
- any feature that smells like product workflow governance belongs back in Mission Control

## Fork Rule

Before adding runtime behavior, check:

1. Is it required by upstream Symphony's runtime role?
2. If not, is it the minimum extension needed for Mission Control integration?
3. If neither is true, do not add it to the runtime.
