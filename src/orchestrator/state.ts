import type { OrchestratorState, RunningEntry, CodexTotals } from "../types.js";

export function createInitialState(
  pollIntervalMs: number,
  maxConcurrentAgents: number,
): OrchestratorState {
  return {
    poll_interval_ms: pollIntervalMs,
    max_concurrent_agents: maxConcurrentAgents,
    running: new Map(),
    claimed: new Set(),
    retry_attempts: new Map(),
    completed: new Set(),
    codex_totals: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      seconds_running: 0,
    },
    codex_rate_limits: null,
  };
}

export function getAvailableSlots(state: OrchestratorState): number {
  return Math.max(state.max_concurrent_agents - state.running.size, 0);
}

export function getAvailableSlotsByState(
  state: OrchestratorState,
  stateName: string,
  perStateMap: Map<string, number>,
): number {
  const normalized = stateName.trim().toLowerCase();
  const limit = perStateMap.get(normalized);
  if (limit === undefined) {
    return getAvailableSlots(state);
  }

  let count = 0;
  for (const entry of state.running.values()) {
    if (entry.issue.state.trim().toLowerCase() === normalized) {
      count++;
    }
  }

  return Math.max(limit - count, 0);
}

export function addRuntimeSeconds(
  totals: CodexTotals,
  entry: RunningEntry,
): CodexTotals {
  const elapsed = (Date.now() - entry.started_at.getTime()) / 1000;
  return {
    ...totals,
    seconds_running: totals.seconds_running + elapsed,
  };
}

export function getSnapshotTotals(state: OrchestratorState): CodexTotals {
  let activeSeconds = 0;
  for (const entry of state.running.values()) {
    activeSeconds += (Date.now() - entry.started_at.getTime()) / 1000;
  }

  return {
    ...state.codex_totals,
    seconds_running: state.codex_totals.seconds_running + activeSeconds,
  };
}
