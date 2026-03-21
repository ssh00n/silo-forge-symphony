import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServiceConfig } from "../../src/config/config-layer.js";

describe("config-layer", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.LINEAR_API_KEY = process.env.LINEAR_API_KEY;
    savedEnv.MY_KEY = process.env.MY_KEY;
  });

  afterEach(() => {
    if (savedEnv.LINEAR_API_KEY !== undefined)
      process.env.LINEAR_API_KEY = savedEnv.LINEAR_API_KEY;
    else delete process.env.LINEAR_API_KEY;
    if (savedEnv.MY_KEY !== undefined)
      process.env.MY_KEY = savedEnv.MY_KEY;
    else delete process.env.MY_KEY;
  });

  it("applies defaults for missing fields", () => {
    const config = buildServiceConfig({});
    expect(config.tracker.kind).toBe("");
    expect(config.polling.interval_ms).toBe(30000);
    expect(config.agent.max_concurrent_agents).toBe(10);
    expect(config.agent.max_turns).toBe(20);
    expect(config.agent.max_retry_backoff_ms).toBe(300000);
    expect(config.codex.command).toBe("codex app-server");
    expect(config.codex.fallback_command).toBeNull();
    expect(config.codex.turn_timeout_ms).toBe(3600000);
    expect(config.codex.read_timeout_ms).toBe(5000);
    expect(config.codex.stall_timeout_ms).toBe(300000);
    expect(config.hooks.timeout_ms).toBe(60000);
    expect(config.prompt_contract.soul_path).toContain(".openclaw/workspace/SOUL.md");
    expect(config.prompt_contract.agents_path).toContain(".openclaw/workspace/AGENTS.md");
    expect(config.shared_memory.enabled).toBe(false);
    expect(config.shared_memory.sync_before_dispatch).toBe(false);
    expect(config.shared_memory.sync_after_run).toBe(false);
    expect(config.tracker.active_states).toEqual(["Todo", "In Progress"]);
    expect(config.tracker.terminal_states).toContain("Done");
  });

  it("resolves $VAR for api_key", () => {
    process.env.MY_KEY = "secret-token";
    const config = buildServiceConfig({
      tracker: { kind: "linear", api_key: "$MY_KEY", project_slug: "test" },
    });
    expect(config.tracker.api_key).toBe("secret-token");
  });

  it("falls back to LINEAR_API_KEY env var for linear tracker", () => {
    process.env.LINEAR_API_KEY = "fallback-token";
    const config = buildServiceConfig({
      tracker: { kind: "linear", project_slug: "test" },
    });
    expect(config.tracker.api_key).toBe("fallback-token");
  });

  it("treats empty $VAR resolution as missing", () => {
    process.env.MY_KEY = "";
    delete process.env.LINEAR_API_KEY;
    const config = buildServiceConfig({
      tracker: { kind: "linear", api_key: "$MY_KEY", project_slug: "test" },
    });
    expect(config.tracker.api_key).toBe("");
  });

  it("parses comma-separated active_states string", () => {
    const config = buildServiceConfig({
      tracker: { active_states: "Ready, In Progress, Doing" },
    });
    expect(config.tracker.active_states).toEqual([
      "Ready",
      "In Progress",
      "Doing",
    ]);
  });

  it("parses active_states array", () => {
    const config = buildServiceConfig({
      tracker: { active_states: ["Todo", "Started"] },
    });
    expect(config.tracker.active_states).toEqual(["Todo", "Started"]);
  });

  it("converts string integers for numeric fields", () => {
    const config = buildServiceConfig({
      polling: { interval_ms: "5000" },
      agent: { max_concurrent_agents: "3" },
    });
    expect(config.polling.interval_ms).toBe(5000);
    expect(config.agent.max_concurrent_agents).toBe(3);
  });

  it("sets default endpoint for linear tracker", () => {
    const config = buildServiceConfig({
      tracker: { kind: "linear" },
    });
    expect(config.tracker.endpoint).toBe(
      "https://api.linear.app/graphql",
    );
  });

  it("builds per-state concurrency map with normalized keys", () => {
    const config = buildServiceConfig({
      agent: {
        max_concurrent_agents_by_state: {
          "In Progress": 3,
          todo: 2,
          invalid: -1,
          bad: "abc",
        },
      },
    });
    expect(config.agent.max_concurrent_agents_by_state.get("in progress")).toBe(
      3,
    );
    expect(config.agent.max_concurrent_agents_by_state.get("todo")).toBe(2);
    expect(config.agent.max_concurrent_agents_by_state.has("invalid")).toBe(
      false,
    );
    expect(config.agent.max_concurrent_agents_by_state.has("bad")).toBe(false);
  });

  it("preserves codex.command as string", () => {
    const config = buildServiceConfig({
      codex: { command: "my-agent serve --port 3000" },
    });
    expect(config.codex.command).toBe("my-agent serve --port 3000");
  });

  it("preserves codex.fallback_command as string", () => {
    const config = buildServiceConfig({
      codex: {
        command: "claude",
        fallback_command: "codex app-server",
      },
    });
    expect(config.codex.fallback_command).toBe("codex app-server");
  });

  it("falls back to default for non-positive hook timeout", () => {
    const config = buildServiceConfig({
      hooks: { timeout_ms: -100 },
    });
    expect(config.hooks.timeout_ms).toBe(60000);
  });

  it("expands ~ in workspace root", () => {
    const config = buildServiceConfig({
      workspace: { root: "~/my-workspaces" },
    });
    expect(config.workspace.root).not.toContain("~");
    expect(config.workspace.root).toContain("my-workspaces");
  });

  it("parses prompt contract and shared memory settings", () => {
    const config = buildServiceConfig({
      prompt_contract: {
        soul_path: "~/contracts/SOUL.md",
        agents_path: "~/contracts/AGENTS.md",
      },
      shared_memory: {
        enabled: true,
        path: "~/agent-shared-memory",
        branch: "main",
        sync_before_dispatch: true,
        sync_after_run: true,
      },
    });
    expect(config.prompt_contract.soul_path).toContain("contracts/SOUL.md");
    expect(config.prompt_contract.agents_path).toContain("contracts/AGENTS.md");
    expect(config.shared_memory.enabled).toBe(true);
    expect(config.shared_memory.path).toContain("agent-shared-memory");
    expect(config.shared_memory.sync_before_dispatch).toBe(true);
    expect(config.shared_memory.sync_after_run).toBe(true);
  });
});
