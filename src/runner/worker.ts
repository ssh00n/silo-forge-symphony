import type {
  Issue,
  AgentRunner,
  AgentEvent,
  ServiceConfig,
  WorkflowDefinition,
  IssueTracker,
} from "../types.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { buildTurnPrompt } from "./prompt-builder.js";
import { log } from "../logging/logger.js";

export type WorkerResult =
  | { status: "normal" }
  | {
      status: "error";
      error: string;
      completion_kind?: string;
      failure_reason?: string;
    }
  | {
      status: "cancelled";
      reason: string;
      completion_kind?: string;
      cancel_reason?: string;
    }
  | {
      status: "timeout";
      reason: string;
      completion_kind?: string;
      failure_reason?: string;
      stall_reason?: string;
    }
  | {
      status: "blocked";
      reason: string;
      completion_kind?: string;
      block_reason?: string;
    };

export interface WorkerCallbacks {
  onEvent: (issueId: string, event: AgentEvent) => void;
}

/**
 * Run a full agent attempt for a single issue.
 * Manages workspace → hooks → session → multi-turn loop.
 */
export async function runWorker(opts: {
  issue: Issue;
  attempt: number | null;
  runner: AgentRunner;
  tracker: IssueTracker;
  workspaceManager: WorkspaceManager;
  getConfig: () => ServiceConfig;
  getWorkflow: () => WorkflowDefinition;
  callbacks: WorkerCallbacks;
}): Promise<WorkerResult> {
  const { issue, attempt, runner, tracker, workspaceManager, getConfig, getWorkflow, callbacks } =
    opts;

  const ctx = {
    issue_id: issue.id,
    issue_identifier: issue.identifier,
  };

  // 1. Create/reuse workspace
  let workspace;
  try {
    workspace = await workspaceManager.createForIssue(issue.identifier);
    log.info(
      `Workspace ready: ${workspace.path} (created=${workspace.created_now})`,
      ctx,
    );
  } catch (err) {
    log.error(
      `Workspace creation failed: ${err instanceof Error ? err.message : String(err)}`,
      ctx,
    );
    return {
      status: "error",
      error: "workspace error",
      completion_kind: "workspace_error",
      failure_reason: "Workspace creation failed before the run could start.",
    };
  }

  // 2. Run before_run hook
  try {
    await workspaceManager.runBeforeRun(workspace.path);
  } catch (err) {
    log.error(
      `before_run hook failed: ${err instanceof Error ? err.message : String(err)}`,
      ctx,
    );
    return {
      status: "error",
      error: "before_run hook error",
      completion_kind: "before_run_error",
      failure_reason: "The before_run hook failed before execution started.",
    };
  }

  // 3. Start agent session
  const config = getConfig();
  let session;
  try {
    session = await runner.startSession(workspace.path, config.codex);
  } catch (err) {
    log.error(
      `Agent session startup failed: ${err instanceof Error ? err.message : String(err)}`,
      ctx,
    );
    await workspaceManager.runAfterRun(workspace.path);
    return {
      status: "error",
      error: "agent session startup error",
      completion_kind: "session_start_error",
      failure_reason: "The runtime session could not start.",
    };
  }

  // 4. Multi-turn loop
  const maxTurns = config.agent.max_turns;
  let currentIssue = issue;

  try {
    for (let turnNumber = 1; turnNumber <= maxTurns; turnNumber++) {
      const workflow = getWorkflow();

      // Build prompt
      let prompt: string;
      try {
        prompt = buildTurnPrompt(
          workflow.prompt_template,
          currentIssue,
          attempt,
          turnNumber,
          config.prompt_contract,
        );
      } catch (err) {
        log.error(
          `Prompt build failed: ${err instanceof Error ? err.message : String(err)}`,
          ctx,
        );
        await session.stop();
        await workspaceManager.runAfterRun(workspace.path);
        return {
          status: "error",
          error: "prompt error",
          completion_kind: "prompt_error",
          failure_reason: "The runtime prompt could not be built.",
        };
      }

      log.info(
        `Starting turn ${turnNumber}/${maxTurns}`,
        { ...ctx, session_id: `${session.thread_id}-${session.turn_id}` },
      );

      // Run turn
      const turnResult = await session.runTurn(
        prompt,
        currentIssue,
        (event) => callbacks.onEvent(issue.id, event),
      );

      if (turnResult.status !== "completed") {
        const error =
          turnResult.status === "failed"
            ? turnResult.error
            : turnResult.status;
        log.warn(`Turn ended: status=${turnResult.status}`, ctx);
        await session.stop();
        await workspaceManager.runAfterRun(workspace.path);
        if (turnResult.status === "cancelled") {
          return {
            status: "cancelled",
            reason: turnResult.reason,
            completion_kind: "cancelled",
            cancel_reason: turnResult.reason,
          };
        }
        if (turnResult.status === "timeout") {
          return {
            status: "timeout",
            reason: "Runner timed out before completing the turn.",
            completion_kind: "timeout",
            failure_reason: "Runner timed out before completing the turn.",
            stall_reason: "No terminal callback arrived before the runtime timeout.",
          };
        }
        if (turnResult.status === "input_required") {
          return {
            status: "blocked",
            reason: "Runner requires operator input before continuing.",
            completion_kind: "input_required",
            block_reason: "Runner requires operator input before continuing.",
          };
        }
        return {
          status: "error",
          error: `agent turn error: ${error}`,
          completion_kind: "error",
          failure_reason: `Agent turn failed: ${error}`,
        };
      }

      log.info(`Turn ${turnNumber} completed`, ctx);

      // Check if issue is still active
      if (turnNumber < maxTurns) {
        try {
          const refreshed = await tracker.fetchIssueStatesByIds([issue.id]);
          if (refreshed.length > 0) {
            currentIssue = refreshed[0]!;
          }
        } catch (err) {
          log.warn(
            `Issue state refresh failed: ${err instanceof Error ? err.message : String(err)}`,
            ctx,
          );
          await session.stop();
          await workspaceManager.runAfterRun(workspace.path);
          return {
            status: "error",
            error: "issue state refresh error",
            completion_kind: "state_refresh_error",
            failure_reason: "The issue state could not be refreshed between turns.",
          };
        }

        const normalizedState = currentIssue.state.trim().toLowerCase();
        const activeStates = config.tracker.active_states.map((s) =>
          s.trim().toLowerCase(),
        );

        if (!activeStates.includes(normalizedState)) {
          log.info(
            `Issue state "${currentIssue.state}" is no longer active, stopping`,
            ctx,
          );
          break;
        }
      }
    }
  } catch (err) {
    log.error(
      `Worker error: ${err instanceof Error ? err.message : String(err)}`,
      ctx,
    );
    await session.stop();
    await workspaceManager.runAfterRun(workspace.path);
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      completion_kind: "worker_error",
      failure_reason: err instanceof Error ? err.message : String(err),
    };
  }

  // Clean exit
  await session.stop();
  await workspaceManager.runAfterRun(workspace.path);
  log.info(`Worker completed normally`, ctx);
  return { status: "normal" };
}
