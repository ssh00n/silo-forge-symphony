import type { OrchestratorState, IssueTracker, ServiceConfig } from "../types.js";
import { log } from "../logging/logger.js";

export interface ReconcileActions {
  terminate: Array<{
    issueId: string;
    cleanupWorkspace: boolean;
    reason: string;
  }>;
  updateIssues: Array<{
    issueId: string;
    state: string;
  }>;
}

/**
 * Detect stalled runs.
 */
export function detectStalledRuns(
  state: OrchestratorState,
  stallTimeoutMs: number,
): string[] {
  if (stallTimeoutMs <= 0) return [];

  const now = Date.now();
  const stalled: string[] = [];

  for (const [issueId, entry] of state.running) {
    const lastActivity = entry.last_codex_timestamp ?? entry.started_at;
    const elapsed = now - lastActivity.getTime();
    if (elapsed > stallTimeoutMs) {
      log.warn(
        `Stalled run detected: elapsed=${elapsed}ms > timeout=${stallTimeoutMs}ms`,
        {
          issue_id: issueId,
          issue_identifier: entry.identifier,
        },
      );
      stalled.push(issueId);
    }
  }

  return stalled;
}

/**
 * Reconcile running issues against tracker states.
 * Returns actions that the orchestrator should take.
 */
export async function reconcileTrackerStates(
  state: OrchestratorState,
  tracker: IssueTracker,
  config: ServiceConfig,
): Promise<ReconcileActions> {
  const actions: ReconcileActions = {
    terminate: [],
    updateIssues: [],
  };

  const runningIds = [...state.running.keys()];
  if (runningIds.length === 0) return actions;

  let refreshed;
  try {
    refreshed = await tracker.fetchIssueStatesByIds(runningIds);
  } catch (err) {
    log.warn(
      `State refresh failed, keeping workers running: ${err instanceof Error ? err.message : String(err)}`,
    );
    return actions;
  }

  const refreshedMap = new Map(refreshed.map((i) => [i.id, i]));
  const activeStates = new Set(
    config.tracker.active_states.map((s) => s.trim().toLowerCase()),
  );
  const terminalStates = new Set(
    config.tracker.terminal_states.map((s) => s.trim().toLowerCase()),
  );

  for (const issueId of runningIds) {
    const fresh = refreshedMap.get(issueId);
    if (!fresh) continue; // Issue not found in response, keep running

    const normalizedState = fresh.state.trim().toLowerCase();

    if (terminalStates.has(normalizedState)) {
      actions.terminate.push({
        issueId,
        cleanupWorkspace: true,
        reason: `Issue state is terminal: ${fresh.state}`,
      });
    } else if (activeStates.has(normalizedState)) {
      actions.updateIssues.push({
        issueId,
        state: fresh.state,
      });
    } else {
      actions.terminate.push({
        issueId,
        cleanupWorkspace: false,
        reason: `Issue state is no longer active: ${fresh.state}`,
      });
    }
  }

  return actions;
}
