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

export interface WorkerResult {
  status: "normal" | "error";
  error?: string;
}

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
    return { status: "error", error: "workspace error" };
  }

  // 2. Run before_run hook
  try {
    await workspaceManager.runBeforeRun(workspace.path);
  } catch (err) {
    log.error(
      `before_run hook failed: ${err instanceof Error ? err.message : String(err)}`,
      ctx,
    );
    return { status: "error", error: "before_run hook error" };
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
    return { status: "error", error: "agent session startup error" };
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
        return { status: "error", error: "prompt error" };
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
        return { status: "error", error: `agent turn error: ${error}` };
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
          return { status: "error", error: "issue state refresh error" };
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
    };
  }

  // Clean exit
  await session.stop();
  await workspaceManager.runAfterRun(workspace.path);
  log.info(`Worker completed normally`, ctx);
  return { status: "normal" };
}
