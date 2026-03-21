import { describe, it, expect } from "vitest";
import {
  sortForDispatch,
  shouldDispatch,
} from "../../src/orchestrator/scheduler.js";
import { createInitialState } from "../../src/orchestrator/state.js";
import { buildServiceConfig } from "../../src/config/config-layer.js";
import type { Issue } from "../../src/types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "id-1",
    identifier: "PRJ-1",
    title: "Test Issue",
    description: null,
    priority: null,
    state: "Todo",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    created_at: new Date("2026-03-01"),
    updated_at: null,
    ...overrides,
  };
}

describe("scheduler", () => {
  describe("sortForDispatch", () => {
    it("sorts by priority ascending, null last", () => {
      const issues = [
        makeIssue({ id: "a", priority: 3 }),
        makeIssue({ id: "b", priority: 1 }),
        makeIssue({ id: "c", priority: null }),
        makeIssue({ id: "d", priority: 2 }),
      ];
      const sorted = sortForDispatch(issues);
      expect(sorted.map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
    });

    it("breaks ties by created_at oldest first", () => {
      const issues = [
        makeIssue({
          id: "a",
          priority: 1,
          created_at: new Date("2026-03-03"),
        }),
        makeIssue({
          id: "b",
          priority: 1,
          created_at: new Date("2026-03-01"),
        }),
      ];
      const sorted = sortForDispatch(issues);
      expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
    });

    it("breaks ties by identifier lexicographic", () => {
      const issues = [
        makeIssue({
          id: "a",
          identifier: "PRJ-2",
          priority: 1,
          created_at: new Date("2026-03-01"),
        }),
        makeIssue({
          id: "b",
          identifier: "PRJ-1",
          priority: 1,
          created_at: new Date("2026-03-01"),
        }),
      ];
      const sorted = sortForDispatch(issues);
      expect(sorted.map((i) => i.id)).toEqual(["b", "a"]);
    });
  });

  describe("shouldDispatch", () => {
    const config = buildServiceConfig({
      tracker: {
        kind: "linear",
        api_key: "key",
        project_slug: "prj",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Closed"],
      },
    });

    it("dispatches eligible issue", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({ state: "Todo" });
      expect(shouldDispatch(issue, state, config)).toBe(true);
    });

    it("rejects issue already in running", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({ id: "id-1", state: "Todo" });
      state.running.set("id-1", {} as never);
      expect(shouldDispatch(issue, state, config)).toBe(false);
    });

    it("rejects issue already claimed", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({ id: "id-1", state: "Todo" });
      state.claimed.add("id-1");
      expect(shouldDispatch(issue, state, config)).toBe(false);
    });

    it("rejects issue in non-active state", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({ state: "Backlog" });
      expect(shouldDispatch(issue, state, config)).toBe(false);
    });

    it("rejects issue in terminal state", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({ state: "Done" });
      expect(shouldDispatch(issue, state, config)).toBe(false);
    });

    it("rejects when no global slots available", () => {
      const state = createInitialState(30000, 0);
      const issue = makeIssue({ state: "Todo" });
      expect(shouldDispatch(issue, state, config)).toBe(false);
    });

    it("rejects Todo issue with non-terminal blockers", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({
        state: "Todo",
        blocked_by: [
          { id: "b1", identifier: "PRJ-5", state: "In Progress" },
        ],
      });
      expect(shouldDispatch(issue, state, config)).toBe(false);
    });

    it("dispatches Todo issue when all blockers are terminal", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({
        state: "Todo",
        blocked_by: [{ id: "b1", identifier: "PRJ-5", state: "Done" }],
      });
      expect(shouldDispatch(issue, state, config)).toBe(true);
    });

    it("rejects issue missing required fields", () => {
      const state = createInitialState(30000, 10);
      const issue = makeIssue({ title: "" });
      expect(shouldDispatch(issue, state, config)).toBe(false);
    });
  });
});
