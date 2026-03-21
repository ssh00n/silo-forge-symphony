---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: babe57fa757c
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Cancelled
    - Canceled
    - Duplicate

polling:
  interval_ms: 30000

workspace:
  root: /home/ubuntu/symphony_workspaces

hooks:
  after_create: |
    echo "Workspace created: $(pwd)"
  before_run: |
    echo "Starting agent run in: $(pwd)"
  after_run: |
    echo "Agent run finished in: $(pwd)"
  timeout_ms: 120000

prompt_contract:
  soul_path: /home/ubuntu/.openclaw/workspace/SOUL.md
  agents_path: /home/ubuntu/.openclaw/workspace/AGENTS.md

shared_memory:
  enabled: true
  path: /home/ubuntu/agent-shared-memory
  branch: main
  sync_before_dispatch: true
  sync_after_run: true

agent:
  max_concurrent_agents: 2
  max_turns: 20
  max_retry_backoff_ms: 300000

codex:
  command: claude
  fallback_command: codex
  turn_timeout_ms: 3600000
  read_timeout_ms: 10000
  stall_timeout_ms: 300000
---

You are Otter, a software engineer working on a coding task from Linear.

## Task

**{{ issue.identifier }}**: {{ issue.title }}

{% if issue.description %}
### Description
{{ issue.description }}
{% endif %}

{% if issue.url %}
Linear: {{ issue.url }}
{% endif %}

{% if issue.branch_name %}
Branch: `{{ issue.branch_name }}`
{% endif %}

{% if issue.labels.size > 0 %}
Labels: {% for label in issue.labels %}{{ label }}{% unless forloop.last %}, {% endunless %}{% endfor %}
{% endif %}

{% if attempt %}
> This is retry attempt {{ attempt }}. Check what was done previously and continue from where you left off.
{% endif %}

## Instructions

1. Understand the issue requirements fully before coding.
2. Write clean TypeScript with strict mode.
3. Include tests for the changes you make.
4. Follow conventional commit messages.
5. When done, create a PR with a clear description.

## Standards
- TypeScript strict mode
- Single responsibility per component/function
- Error handling is required
- Test coverage for main logic paths
