import { describe, it, expect } from "vitest";
import {
  createInitialState,
  getAvailableSlots,
  getAvailableSlotsByState,
  addRuntimeSeconds,
} from "../../src/orchestrator/state.js";
import type { RunningEntry } from "../../src/types.js";

describe("state", () => {
  describe("createInitialState", () => {
    it("creates state with correct defaults", () => {
      const state = createInitialState(30000, 10);
      expect(state.poll_interval_ms).toBe(30000);
      expect(state.max_concurrent_agents).toBe(10);
      expect(state.running.size).toBe(0);
      expect(state.claimed.size).toBe(0);
      expect(state.retry_attempts.size).toBe(0);
      expect(state.completed.size).toBe(0);
      expect(state.codex_totals.input_tokens).toBe(0);
      expect(state.codex_rate_limits).toBeNull();
    });
  });

  describe("getAvailableSlots", () => {
    it("returns max when nothing running", () => {
      const state = createInitialState(30000, 10);
      expect(getAvailableSlots(state)).toBe(10);
    });

    it("subtracts running count", () => {
      const state = createInitialState(30000, 10);
      state.running.set("a", {} as RunningEntry);
      state.running.set("b", {} as RunningEntry);
      expect(getAvailableSlots(state)).toBe(8);
    });

    it("never returns negative", () => {
      const state = createInitialState(30000, 1);
      state.running.set("a", {} as RunningEntry);
      state.running.set("b", {} as RunningEntry);
      expect(getAvailableSlots(state)).toBe(0);
    });
  });

  describe("getAvailableSlotsByState", () => {
    it("returns global slots when no per-state limit", () => {
      const state = createInitialState(30000, 10);
      expect(getAvailableSlotsByState(state, "todo", new Map())).toBe(10);
    });

    it("respects per-state limit", () => {
      const state = createInitialState(30000, 10);
      state.running.set("a", {
        issue: { state: "Todo" },
      } as RunningEntry);

      const map = new Map([["todo", 2]]);
      expect(getAvailableSlotsByState(state, "Todo", map)).toBe(1);
    });
  });

  describe("addRuntimeSeconds", () => {
    it("adds elapsed seconds from entry", () => {
      const entry = {
        started_at: new Date(Date.now() - 10000), // 10s ago
      } as RunningEntry;

      const totals = {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        seconds_running: 5,
      };

      const result = addRuntimeSeconds(totals, entry);
      expect(result.seconds_running).toBeGreaterThanOrEqual(14); // ~15s, with tolerance
      expect(result.seconds_running).toBeLessThan(20);
    });
  });
});
