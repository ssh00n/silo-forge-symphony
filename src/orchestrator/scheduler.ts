import type { Issue, OrchestratorState, ServiceConfig } from "../types.js";
import { getAvailableSlots, getAvailableSlotsByState } from "./state.js";

/**
 * Sort candidates by dispatch priority:
 * 1. priority ascending (1..4, null sorts last)
 * 2. created_at oldest first
 * 3. identifier lexicographic tie-breaker
 */
export function sortForDispatch(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // Priority: lower is higher priority, null sorts last
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;

    // created_at: oldest first
    const ca = a.created_at?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const cb = b.created_at?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;

    // Identifier lexicographic
    return a.identifier.localeCompare(b.identifier);
  });
}

/**
 * Check if an issue should be dispatched.
 */
export function shouldDispatch(
  issue: Issue,
  state: OrchestratorState,
  config: ServiceConfig,
): boolean {
  // Must have required fields
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) {
    return false;
  }

  const normalizedState = issue.state.trim().toLowerCase();
  const activeStates = config.tracker.active_states.map((s) =>
    s.trim().toLowerCase(),
  );
  const terminalStates = config.tracker.terminal_states.map((s) =>
    s.trim().toLowerCase(),
  );

  // State must be active and not terminal
  if (!activeStates.includes(normalizedState)) return false;
  if (terminalStates.includes(normalizedState)) return false;

  // Not already running or claimed
  if (state.running.has(issue.id)) return false;
  if (state.claimed.has(issue.id)) return false;

  // Global concurrency check
  if (getAvailableSlots(state) <= 0) return false;

  // Per-state concurrency check
  if (
    getAvailableSlotsByState(
      state,
      issue.state,
      config.agent.max_concurrent_agents_by_state,
    ) <= 0
  ) {
    return false;
  }

  // Todo blocker rule: don't dispatch if any blocker is non-terminal
  if (normalizedState === "todo" && issue.blocked_by.length > 0) {
    const hasNonTerminalBlocker = issue.blocked_by.some((blocker) => {
      if (!blocker.state) return true; // Unknown state = non-terminal
      return !terminalStates.includes(blocker.state.trim().toLowerCase());
    });
    if (hasNonTerminalBlocker) return false;
  }

  return true;
}

/**
 * Filter and sort candidate issues for dispatch.
 */
export function selectCandidates(
  issues: Issue[],
  state: OrchestratorState,
  config: ServiceConfig,
): Issue[] {
  const sorted = sortForDispatch(issues);
  return sorted.filter((issue) => shouldDispatch(issue, state, config));
}
