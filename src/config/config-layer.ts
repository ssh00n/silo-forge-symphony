import { tmpdir, homedir } from "node:os";
import { resolve } from "node:path";
import type { ServiceConfig } from "../types.js";

function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function resolveEnvVar(value: string): string {
  if (value.startsWith("$")) {
    const varName = value.slice(1);
    return process.env[varName] ?? "";
  }
  return value;
}

function expandPath(value: string): string {
  if (value.startsWith("~")) {
    return resolve(homedir(), value.slice(1).replace(/^\//, ""));
  }
  return value;
}

function toInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const n =
    typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isNaN(n) ? fallback : n;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = toInt(value, fallback);
  return n > 0 ? n : fallback;
}

function toStringList(value: unknown, fallback: string[]): string[] {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return fallback;
}

function toPerStateMap(
  value: unknown,
): Map<string, number> {
  const map = new Map<string, number>();
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof val === "number" ? val : parseInt(String(val), 10);
    if (!Number.isNaN(n) && n > 0) {
      map.set(key.trim().toLowerCase(), n);
    }
  }
  return map;
}

export function buildServiceConfig(
  config: Record<string, unknown>,
): ServiceConfig {
  const tracker = (config.tracker ?? {}) as Record<string, unknown>;
  const polling = (config.polling ?? {}) as Record<string, unknown>;
  const workspace = (config.workspace ?? {}) as Record<string, unknown>;
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;
  const promptContract = (config.prompt_contract ?? {}) as Record<string, unknown>;
  const sharedMemory = (config.shared_memory ?? {}) as Record<string, unknown>;
  const agent = (config.agent ?? {}) as Record<string, unknown>;
  const codex = (config.codex ?? {}) as Record<string, unknown>;

  const kind = String(tracker.kind ?? "");
  const defaultEndpoint =
    kind === "linear" ? "https://api.linear.app/graphql" : "";

  let apiKey = String(tracker.api_key ?? "");
  apiKey = resolveEnvVar(apiKey);
  // Fallback to canonical env var for linear
  if (!apiKey && kind === "linear") {
    apiKey = process.env.LINEAR_API_KEY ?? "";
  }

  let wsRoot = String(workspace.root ?? "");
  if (wsRoot) {
    wsRoot = resolveEnvVar(wsRoot);
    wsRoot = expandPath(wsRoot);
    // Resolve relative paths
    if (wsRoot.includes("/") || wsRoot.includes("\\")) {
      wsRoot = resolve(wsRoot);
    }
  } else {
    wsRoot = resolve(tmpdir(), "symphony_workspaces");
  }

  const hookTimeoutMs = toPositiveInt(hooks.timeout_ms, 60000);

  return {
    tracker: {
      kind,
      endpoint: String(tracker.endpoint ?? defaultEndpoint),
      api_key: apiKey,
      project_slug: String(tracker.project_slug ?? ""),
      active_states: toStringList(tracker.active_states, [
        "Todo",
        "In Progress",
      ]),
      terminal_states: toStringList(tracker.terminal_states, [
        "Closed",
        "Cancelled",
        "Canceled",
        "Duplicate",
        "Done",
      ]),
    },
    polling: {
      interval_ms: toInt(polling.interval_ms, 30000),
    },
    workspace: {
      root: wsRoot,
    },
    hooks: {
      after_create: hooks.after_create ? String(hooks.after_create) : null,
      before_run: hooks.before_run ? String(hooks.before_run) : null,
      after_run: hooks.after_run ? String(hooks.after_run) : null,
      before_remove: hooks.before_remove ? String(hooks.before_remove) : null,
      timeout_ms: hookTimeoutMs,
    },
    prompt_contract: {
      soul_path: promptContract.soul_path
        ? expandPath(resolveEnvVar(String(promptContract.soul_path)))
        : resolve(homedir(), ".openclaw", "workspace", "SOUL.md"),
      agents_path: promptContract.agents_path
        ? expandPath(resolveEnvVar(String(promptContract.agents_path)))
        : resolve(homedir(), ".openclaw", "workspace", "AGENTS.md"),
    },
    shared_memory: {
      enabled: sharedMemory.enabled === undefined
        ? false
        : String(sharedMemory.enabled).toLowerCase() !== "false",
      path: sharedMemory.path
        ? expandPath(resolveEnvVar(String(sharedMemory.path)))
        : resolve(homedir(), "agent-shared-memory"),
      branch: String(sharedMemory.branch ?? "main"),
      sync_before_dispatch: sharedMemory.sync_before_dispatch === undefined
        ? false
        : String(sharedMemory.sync_before_dispatch).toLowerCase() !== "false",
      sync_after_run: sharedMemory.sync_after_run === undefined
        ? false
        : String(sharedMemory.sync_after_run).toLowerCase() !== "false",
    },
    agent: {
      max_concurrent_agents: toInt(agent.max_concurrent_agents, 10),
      max_turns: toInt(agent.max_turns, 20),
      max_retry_backoff_ms: toInt(agent.max_retry_backoff_ms, 300000),
      max_concurrent_agents_by_state: toPerStateMap(
        agent.max_concurrent_agents_by_state,
      ),
    },
    codex: {
      command: String(codex.command ?? "codex app-server"),
      fallback_command: codex.fallback_command
        ? String(codex.fallback_command)
        : null,
      approval_policy: String(codex.approval_policy ?? "auto-edit"),
      thread_sandbox: String(codex.thread_sandbox ?? "none"),
      turn_sandbox_policy: String(codex.turn_sandbox_policy ?? "none"),
      turn_timeout_ms: toInt(codex.turn_timeout_ms, 3600000),
      read_timeout_ms: toInt(codex.read_timeout_ms, 5000),
      stall_timeout_ms: toInt(codex.stall_timeout_ms, 300000),
    },
  };
}
