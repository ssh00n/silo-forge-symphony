# Runtime

`symphony` is the execution runtime for OpenClaw orchestration.

Core responsibilities:

- poll or accept work from a tracker/control plane
- build execution prompts from workflow contracts
- manage workspace creation and safety checks
- run workers and report runtime state

The current source tree was extracted from `openclaw-agent` and should now be treated
as the runtime source of truth.
