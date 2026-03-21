---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
polling:
  interval_ms: 15000
agent:
  max_concurrent_agents: 5
  max_turns: 10
codex:
  command: codex app-server
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.

{{ issue.description }}

{% if attempt %}This is retry attempt {{ attempt }}.{% endif %}

Labels: {% for label in issue.labels %}{{ label }}{% unless forloop.last %}, {% endunless %}{% endfor %}
