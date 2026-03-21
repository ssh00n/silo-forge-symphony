import { describe, it, expect, vi } from "vitest";
import {
  detectStalledRuns,
  reconcileTrackerStates,
} from "../../src/orchestrator/reconciler.js";
import { createInitialState } from "../../src/orchestrator/state.js";
import { buildServiceConfig } from "../../src/config/config-layer.js";
import type { Issue, IssueTracker, RunningEntry } from "../../src/types.js";

function makeRunningEntry(
  overrides: Partial<RunningEntry> = {},
): RunningEntry {
  return {
    worker_handle: null,
    identifier: "PRJ-1",
    issue: {
      id: "id-1",
      identifier: "PRJ-1",
      title: "Test",
      description: null,
      priority: null,
      state: "In Progress",
      branch_name: null,
      url: null,
      labels: [],
      blocked_by: [],
      created_at: null,
      updated_at: null,
    },
    session_id: null,
    codex_app_server_pid: null,
    last_codex_message: null,
    last_codex_event: null,
    last_codex_timestamp: null,
    codex_input_tokens: 0,
    codex_output_tokens: 0,
    codex_total_tokens: 0,
    last_reported_input_tokens: 0,
    last_reported_output_tokens: 0,
    last_reported_total_tokens: 0,
    retry_attempt: null,
    started_at: new Date(),
    turn_count: 0,
    ...overrides,
  };
}

describe("reconciler", () => {
  describe("detectStalledRuns", () => {
    it("detects stalled runs", () => {
      const state = createInitialState(30000, 10);
      state.running.set(
        "id-1",
        makeRunningEntry({
          started_at: new Date(Date.now() - 600000), // 10min ago
          last_codex_timestamp: null,
        }),
      );

      const stalled = detectStalledRuns(state, 300000); // 5min timeout
      expect(stalled).toEqual(["id-1"]);
    });

    it("does not detect active runs as stalled", () => {
      const state = createInitialState(30000, 10);
      state.running.set(
        "id-1",
        makeRunningEntry({
          started_at: new Date(Date.now() - 60000), // 1min ago
          last_codex_timestamp: new Date(), // just now
        }),
      );

      const stalled = detectStalledRuns(state, 300000);
      expect(stalled).toEqual([]);
    });

    it("skips stall detection when timeout <= 0", () => {
      const state = createInitialState(30000, 10);
      state.running.set(
        "id-1",
        makeRunningEntry({
          started_at: new Date(Date.now() - 600000),
        }),
      );

      expect(detectStalledRuns(state, 0)).toEqual([]);
      expect(detectStalledRuns(state, -1)).toEqual([]);
    });

    it("returns empty for no running issues", () => {
      const state = createInitialState(30000, 10);
      expect(detectStalledRuns(state, 300000)).toEqual([]);
    });
  });

  describe("reconcileTrackerStates", () => {
    const config = buildServiceConfig({
      tracker: {
        kind: "linear",
        api_key: "key",
        project_slug: "prj",
        active_states: ["Todo", "In Progress"],
        terminal_states: ["Done", "Closed"],
      },
    });

    it("returns no actions for empty running map", async () => {
      const state = createInitialState(30000, 10);
      const tracker: IssueTracker = {
        fetchCandidateIssues: vi.fn(),
        fetchIssuesByStates: vi.fn(),
        fetchIssueStatesByIds: vi.fn(),
      };

      const actions = await reconcileTrackerStates(state, tracker, config);
      expect(actions.terminate).toEqual([]);
      expect(actions.updateIssues).toEqual([]);
      expect(tracker.fetchIssueStatesByIds).not.toHaveBeenCalled();
    });

    it("terminates issues in terminal states with workspace cleanup", async () => {
      const state = createInitialState(30000, 10);
      state.running.set("id-1", makeRunningEntry());

      const tracker: IssueTracker = {
        fetchCandidateIssues: vi.fn(),
        fetchIssuesByStates: vi.fn(),
        fetchIssueStatesByIds: vi.fn().mockResolvedValue([
          { id: "id-1", identifier: "PRJ-1", state: "Done" } as Issue,
        ]),
      };

      const actions = await reconcileTrackerStates(state, tracker, config);
      expect(actions.terminate).toHaveLength(1);
      expect(actions.terminate[0]!.issueId).toBe("id-1");
      expect(actions.terminate[0]!.cleanupWorkspace).toBe(true);
    });

    it("updates issue state for active issues", async () => {
      const state = createInitialState(30000, 10);
      state.running.set("id-1", makeRunningEntry());

      const tracker: IssueTracker = {
        fetchCandidateIssues: vi.fn(),
        fetchIssuesByStates: vi.fn(),
        fetchIssueStatesByIds: vi.fn().mockResolvedValue([
          { id: "id-1", identifier: "PRJ-1", state: "In Progress" } as Issue,
        ]),
      };

      const actions = await reconcileTrackerStates(state, tracker, config);
      expect(actions.updateIssues).toHaveLength(1);
      expect(actions.updateIssues[0]!.state).toBe("In Progress");
    });

    it("terminates non-active, non-terminal issues without cleanup", async () => {
      const state = createInitialState(30000, 10);
      state.running.set("id-1", makeRunningEntry());

      const tracker: IssueTracker = {
        fetchCandidateIssues: vi.fn(),
        fetchIssuesByStates: vi.fn(),
        fetchIssueStatesByIds: vi.fn().mockResolvedValue([
          {
            id: "id-1",
            identifier: "PRJ-1",
            state: "Human Review",
          } as Issue,
        ]),
      };

      const actions = await reconcileTrackerStates(state, tracker, config);
      expect(actions.terminate).toHaveLength(1);
      expect(actions.terminate[0]!.cleanupWorkspace).toBe(false);
    });

    it("keeps workers running on state refresh failure", async () => {
      const state = createInitialState(30000, 10);
      state.running.set("id-1", makeRunningEntry());

      const tracker: IssueTracker = {
        fetchCandidateIssues: vi.fn(),
        fetchIssuesByStates: vi.fn(),
        fetchIssueStatesByIds: vi
          .fn()
          .mockRejectedValue(new Error("network error")),
      };

      const actions = await reconcileTrackerStates(state, tracker, config);
      expect(actions.terminate).toEqual([]);
      expect(actions.updateIssues).toEqual([]);
    });
  });
});
