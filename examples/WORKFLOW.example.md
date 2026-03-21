---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: example-project

polling:
  interval_ms: 30000

workspace:
  root: /srv/symphony/workspaces

agent:
  max_concurrent_agents: 2
  max_turns: 20
---

You are Symphony runtime processing a work item.

## Task

**{{ issue.identifier }}**: {{ issue.title }}

{% if issue.description %}
### Description
{{ issue.description }}
{% endif %}
