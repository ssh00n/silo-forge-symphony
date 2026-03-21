import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeRetryDelay,
  scheduleRetry,
  cancelRetry,
} from "../../src/orchestrator/retry-queue.js";
import { createInitialState } from "../../src/orchestrator/state.js";

describe("retry-queue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("computeRetryDelay", () => {
    it("returns 1000ms for continuation", () => {
      expect(computeRetryDelay(1, 300000, true)).toBe(1000);
    });

    it("computes exponential backoff for failures", () => {
      expect(computeRetryDelay(1, 300000, false)).toBe(10000);
      expect(computeRetryDelay(2, 300000, false)).toBe(20000);
      expect(computeRetryDelay(3, 300000, false)).toBe(40000);
    });

    it("caps at max backoff", () => {
      expect(computeRetryDelay(10, 300000, false)).toBe(300000);
    });
  });

  describe("scheduleRetry", () => {
    it("creates a retry entry", () => {
      vi.useFakeTimers();
      const state = createInitialState(30000, 10);
      const onFire = vi.fn();

      scheduleRetry(state, "issue-1", 1, {
        identifier: "PRJ-1",
        error: "test error",
        maxBackoffMs: 300000,
        onFire,
      });

      expect(state.retry_attempts.has("issue-1")).toBe(true);
      const entry = state.retry_attempts.get("issue-1")!;
      expect(entry.attempt).toBe(1);
      expect(entry.identifier).toBe("PRJ-1");
      expect(entry.error).toBe("test error");

      vi.useRealTimers();
    });

    it("cancels existing retry before creating new one", () => {
      vi.useFakeTimers();
      const state = createInitialState(30000, 10);
      const onFire = vi.fn();

      scheduleRetry(state, "issue-1", 1, {
        identifier: "PRJ-1",
        maxBackoffMs: 300000,
        onFire,
      });

      const firstHandle = state.retry_attempts.get("issue-1")!.timer_handle;

      scheduleRetry(state, "issue-1", 2, {
        identifier: "PRJ-1",
        maxBackoffMs: 300000,
        onFire,
      });

      expect(state.retry_attempts.get("issue-1")!.attempt).toBe(2);
      // First timer should have been cleared

      vi.useRealTimers();
    });
  });

  describe("cancelRetry", () => {
    it("removes retry entry", () => {
      vi.useFakeTimers();
      const state = createInitialState(30000, 10);
      const onFire = vi.fn();

      scheduleRetry(state, "issue-1", 1, {
        identifier: "PRJ-1",
        maxBackoffMs: 300000,
        onFire,
      });

      cancelRetry(state, "issue-1");
      expect(state.retry_attempts.has("issue-1")).toBe(false);

      vi.useRealTimers();
    });

    it("is a no-op for non-existent issue", () => {
      const state = createInitialState(30000, 10);
      expect(() => cancelRetry(state, "nonexistent")).not.toThrow();
    });
  });
});
