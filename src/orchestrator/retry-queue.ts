import type { OrchestratorState, RetryEntry } from "../types.js";
import { log } from "../logging/logger.js";

const CONTINUATION_DELAY_MS = 1000;
const BASE_FAILURE_DELAY_MS = 10000;

export function computeRetryDelay(
  attempt: number,
  maxBackoffMs: number,
  isContinuation: boolean,
): number {
  if (isContinuation) return CONTINUATION_DELAY_MS;
  const delay = BASE_FAILURE_DELAY_MS * Math.pow(2, attempt - 1);
  return Math.min(delay, maxBackoffMs);
}

export function scheduleRetry(
  state: OrchestratorState,
  issueId: string,
  attempt: number,
  opts: {
    identifier: string;
    error?: string | null;
    isContinuation?: boolean;
    maxBackoffMs: number;
    onFire: (issueId: string) => void;
  },
): OrchestratorState {
  // Cancel any existing retry for this issue
  const existing = state.retry_attempts.get(issueId);
  if (existing) {
    clearTimeout(existing.timer_handle);
    state.retry_attempts.delete(issueId);
  }

  const isContinuation = opts.isContinuation ?? false;
  const delay = computeRetryDelay(attempt, opts.maxBackoffMs, isContinuation);
  const dueAtMs = Date.now() + delay;

  const timerHandle = setTimeout(() => {
    opts.onFire(issueId);
  }, delay);

  const entry: RetryEntry = {
    issue_id: issueId,
    identifier: opts.identifier,
    attempt,
    due_at_ms: dueAtMs,
    timer_handle: timerHandle,
    error: opts.error ?? null,
  };

  state.retry_attempts.set(issueId, entry);

  log.info(
    `Retry scheduled: attempt=${attempt} delay=${delay}ms${isContinuation ? " (continuation)" : ""}`,
    {
      issue_id: issueId,
      issue_identifier: opts.identifier,
    },
  );

  return state;
}

export function cancelRetry(
  state: OrchestratorState,
  issueId: string,
): OrchestratorState {
  const entry = state.retry_attempts.get(issueId);
  if (entry) {
    clearTimeout(entry.timer_handle);
    state.retry_attempts.delete(issueId);
  }
  return state;
}

export function cancelAllRetries(state: OrchestratorState): void {
  for (const entry of state.retry_attempts.values()) {
    clearTimeout(entry.timer_handle);
  }
  state.retry_attempts.clear();
}
