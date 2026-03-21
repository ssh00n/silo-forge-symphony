import type {
  OrchestratorState,
  ServiceConfig,
  WorkflowDefinition,
  Issue,
  AgentEvent,
  AgentRunner,
  IssueTracker,
  RunningEntry,
} from "../types.js";
import { loadWorkflow } from "../config/workflow-loader.js";
import { buildServiceConfig } from "../config/config-layer.js";
import { validateDispatchConfig } from "../config/config-validator.js";
import { ConfigWatcher } from "../config/config-watcher.js";
import { createInitialState, addRuntimeSeconds, getSnapshotTotals } from "./state.js";
import { selectCandidates, shouldDispatch } from "./scheduler.js";
import { scheduleRetry, cancelRetry, cancelAllRetries } from "./retry-queue.js";
import { detectStalledRuns, reconcileTrackerStates } from "./reconciler.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { runWorker, type WorkerResult } from "../runner/worker.js";
import { SharedMemoryCoordinator } from "./shared-memory-coordinator.js";
import { log } from "../logging/logger.js";
import { sendMissionControlCallback } from "../control-plane/mission-control-callbacks.js";
import type {
  MissionControlDispatchAcceptance,
  MissionControlDispatchRequest,
  MissionControlRunBinding,
} from "../control-plane/mission-control-types.js";

export class Orchestrator {
  private state!: OrchestratorState;
  private config!: ServiceConfig;
  private workflow!: WorkflowDefinition;
  private workflowPath: string;
  private tracker!: IssueTracker;
  private runner!: AgentRunner;
  private workspaceManager!: WorkspaceManager;
  private sharedMemory!: SharedMemoryCoordinator;
  private configWatcher = new ConfigWatcher();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdownRequested = false;
  private workerPromises = new Map<string, Promise<WorkerResult>>();
  private missionControlBindings = new Map<string, MissionControlRunBinding>();

  constructor(
    workflowPath: string,
    private trackerFactory: (config: ServiceConfig) => IssueTracker,
    private runnerFactory: (config: ServiceConfig) => AgentRunner,
  ) {
    this.workflowPath = workflowPath;
  }

  /**
   * Start the orchestrator service.
   */
  async start(): Promise<void> {
    log.info("Symphony starting...");

    // Load and validate workflow
    this.reloadWorkflow();

    const validation = validateDispatchConfig(this.config);
    if (!validation.ok) {
      for (const err of validation.errors) {
        log.error(`Startup validation failed: ${err}`);
      }
      throw new Error(
        `Startup validation failed: ${validation.errors.join("; ")}`,
      );
    }

    // Create tracker and runner
    this.tracker = this.trackerFactory(this.config);
    this.runner = this.runnerFactory(this.config);
    this.workspaceManager = new WorkspaceManager(() => ({
      root: this.config.workspace.root,
      hooks: this.config.hooks,
    }));
    this.sharedMemory = new SharedMemoryCoordinator(() => this.config.shared_memory);

    // Initialize state
    this.state = createInitialState(
      this.config.polling.interval_ms,
      this.config.agent.max_concurrent_agents,
    );

    // Start watching workflow file
    await this.configWatcher.start(this.workflowPath, () => {
      this.handleWorkflowChange();
    });

    // Startup terminal workspace cleanup
    await this.startupCleanup();

    // Schedule first tick immediately
    log.info(
      `Symphony started. Polling every ${this.state.poll_interval_ms}ms`,
    );
    this.scheduleTick(0);
  }

  /**
   * Stop the orchestrator gracefully.
   */
  async stop(): Promise<void> {
    log.info("Symphony shutting down...");
    this.shutdownRequested = true;

    // Cancel tick timer
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }

    // Cancel all retries
    cancelAllRetries(this.state);

    // Stop config watcher
    await this.configWatcher.stop();

    // Wait for active workers to finish (with timeout)
    if (this.workerPromises.size > 0) {
      log.info(`Waiting for ${this.workerPromises.size} active workers...`);
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, 30000),
      );
      await Promise.race([
        Promise.allSettled(this.workerPromises.values()),
        timeout,
      ]);
    }

    log.info("Symphony stopped.");
  }

  /**
   * Get a snapshot of current state (for monitoring/API).
   */
  getSnapshot() {
    const totals = getSnapshotTotals(this.state);
    const running = [...this.state.running.entries()].map(
      ([issueId, entry]) => ({
        issue_id: issueId,
        issue_identifier: entry.identifier,
        state: entry.issue.state,
        session_id: entry.session_id,
        turn_count: entry.turn_count,
        last_event: entry.last_codex_event,
        last_message: entry.last_codex_message,
        started_at: entry.started_at.toISOString(),
        last_event_at: entry.last_codex_timestamp?.toISOString() ?? null,
        tokens: {
          input_tokens: entry.codex_input_tokens,
          output_tokens: entry.codex_output_tokens,
          total_tokens: entry.codex_total_tokens,
        },
      }),
    );
    const retrying = [...this.state.retry_attempts.entries()].map(
      ([_, entry]) => ({
        issue_id: entry.issue_id,
        issue_identifier: entry.identifier,
        attempt: entry.attempt,
        due_at: new Date(entry.due_at_ms).toISOString(),
        error: entry.error,
      }),
    );

    return {
      generated_at: new Date().toISOString(),
      counts: {
        running: running.length,
        retrying: retrying.length,
      },
      running,
      retrying,
      codex_totals: totals,
      rate_limits: this.state.codex_rate_limits,
    };
  }

  /**
   * Trigger an immediate poll tick.
   */
  triggerRefresh(): void {
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.scheduleTick(0);
  }

  // ── Private Methods ──

  private reloadWorkflow(): void {
    this.workflow = loadWorkflow(this.workflowPath);
    this.config = buildServiceConfig(this.workflow.config);
  }

  private handleWorkflowChange(): void {
    try {
      this.reloadWorkflow();

      // Re-apply dynamic settings
      this.state.poll_interval_ms = this.config.polling.interval_ms;
      this.state.max_concurrent_agents =
        this.config.agent.max_concurrent_agents;

      // Recreate tracker in case endpoint/auth changed
      this.tracker = this.trackerFactory(this.config);

      log.info("Workflow reloaded successfully");
    } catch (err) {
      log.error(
        `Workflow reload failed, keeping last good config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async startupCleanup(): Promise<void> {
    try {
      const terminalIssues = await this.tracker.fetchIssuesByStates(
        this.config.tracker.terminal_states,
      );
      for (const issue of terminalIssues) {
        await this.workspaceManager.removeWorkspace(issue.identifier);
      }
      if (terminalIssues.length > 0) {
        log.info(
          `Startup cleanup: removed ${terminalIssues.length} terminal workspaces`,
        );
      }
    } catch (err) {
      log.warn(
        `Startup terminal cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private scheduleTick(delayMs: number): void {
    if (this.shutdownRequested) return;
    this.tickTimer = setTimeout(() => this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.shutdownRequested) return;

    try {
      // 1. Reconcile running issues
      await this.reconcile();

      // 2. Validate dispatch config
      // Re-read workflow defensively
      try {
        this.reloadWorkflow();
        this.state.poll_interval_ms = this.config.polling.interval_ms;
        this.state.max_concurrent_agents =
          this.config.agent.max_concurrent_agents;
      } catch {
        // Keep last known good config
      }

      const validation = validateDispatchConfig(this.config);
      if (!validation.ok) {
        for (const err of validation.errors) {
          log.error(`Dispatch validation failed: ${err}`);
        }
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 3. Fetch candidates
      let candidates: Issue[];
      try {
        candidates = await this.tracker.fetchCandidateIssues();
      } catch (err) {
        log.error(
          `Candidate fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.scheduleTick(this.state.poll_interval_ms);
        return;
      }

      // 4. Sort and dispatch
      const eligible = selectCandidates(candidates, this.state, this.config);
      if (eligible.length > 0) {
        await this.sharedMemory.syncBeforeDispatch();
      }
      for (const issue of eligible) {
        if (!shouldDispatch(issue, this.state, this.config)) break;
        this.dispatchIssue(issue, null);
      }

      log.debug(
        `Tick complete: running=${this.state.running.size} retrying=${this.state.retry_attempts.size}`,
      );
    } catch (err) {
      log.error(
        `Tick error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Schedule next tick
    this.scheduleTick(this.state.poll_interval_ms);
  }

  private async reconcile(): Promise<void> {
    // Part A: Stall detection
    const stalledIds = detectStalledRuns(
      this.state,
      this.config.codex.stall_timeout_ms,
    );
    for (const issueId of stalledIds) {
      await this.terminateRunningIssue(issueId, false, "stalled");
      const entry = this.state.running.get(issueId);
      scheduleRetry(this.state, issueId, 1, {
        identifier: entry?.identifier ?? issueId,
        error: "session stalled",
        maxBackoffMs: this.config.agent.max_retry_backoff_ms,
        onFire: (id) => this.handleRetryFired(id),
      });
    }

    // Part B: Tracker state refresh
    const actions = await reconcileTrackerStates(
      this.state,
      this.tracker,
      this.config,
    );

    for (const action of actions.terminate) {
      await this.terminateRunningIssue(
        action.issueId,
        action.cleanupWorkspace,
        action.reason,
      );
    }

    for (const update of actions.updateIssues) {
      const entry = this.state.running.get(update.issueId);
      if (entry) {
        entry.issue = { ...entry.issue, state: update.state };
      }
    }
  }

  private dispatchIssue(issue: Issue, attempt: number | null): void {
    this.dispatchIssueWithOptions(issue, attempt, {});
  }

  async dispatchMissionControl(
    request: MissionControlDispatchRequest,
  ): Promise<MissionControlDispatchAcceptance> {
    const availableSlots = this.state.max_concurrent_agents - this.state.running.size;
    if (availableSlots <= 0) {
      throw new Error("no available orchestrator slots");
    }

    const issue: Issue = {
      id: request.issue.id,
      identifier: request.issue.identifier,
      title: request.issue.title,
      description: request.issue.description,
      priority: request.issue.priority,
      state: request.issue.state,
      branch_name: request.issue.branch_name,
      url: request.issue.url,
      labels: request.issue.labels,
      blocked_by: request.issue.blocked_by,
      created_at: request.issue.created_at ? new Date(request.issue.created_at) : null,
      updated_at: request.issue.updated_at ? new Date(request.issue.updated_at) : null,
    };
    const externalRunId = `mc-${request.execution_run_id}`;
    const workspacePath =
      `${request.workspace_root.replace(/\/$/, "")}/mission-control/${issue.identifier}`;
    const branchName = issue.branch_name ?? "task/dispatch";

    this.dispatchIssueWithOptions(issue, null, {
      missionControlBinding: {
        execution_run_id: request.execution_run_id,
        callback_url: request.callback_url,
        external_run_id: externalRunId,
        workspace_path: workspacePath,
        branch_name: branchName,
      },
    });

    return {
      accepted: true,
      adapter_mode: "http",
      external_run_id: externalRunId,
      workspace_path: workspacePath,
      branch_name: branchName,
      summary: "Symphony accepted Mission Control dispatch.",
    };
  }

  private dispatchIssueWithOptions(
    issue: Issue,
    attempt: number | null,
    options: {
      missionControlBinding?: MissionControlRunBinding;
    },
  ): void {
    const ctx = {
      issue_id: issue.id,
      issue_identifier: issue.identifier,
    };

    log.info(
      `Dispatching: ${issue.identifier} "${issue.title}" (attempt=${attempt ?? "first"})`,
      ctx,
    );

    // Mark as claimed and add to running
    this.state.claimed.add(issue.id);

    // Remove from retry queue if present
    cancelRetry(this.state, issue.id);

    if (options.missionControlBinding) {
      this.missionControlBindings.set(issue.id, options.missionControlBinding);
    } else {
      this.missionControlBindings.delete(issue.id);
    }

    // Create running entry
    this.state.running.set(issue.id, {
      worker_handle: null,
      identifier: issue.identifier,
      issue,
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
      retry_attempt: attempt,
      started_at: new Date(),
      turn_count: 0,
    });

    // Launch worker
    const workerPromise = runWorker({
      issue,
      attempt,
      runner: this.runner,
      tracker: this.tracker,
      workspaceManager: this.workspaceManager,
      getConfig: () => this.config,
      getWorkflow: () => this.workflow,
      callbacks: {
        onEvent: (issueId, event) => this.handleAgentEvent(issueId, event),
      },
    });

    this.workerPromises.set(issue.id, workerPromise);

    // Handle worker completion
    workerPromise.then((result) => {
      this.workerPromises.delete(issue.id);
      this.handleWorkerExit(issue.id, result);
    }).catch((err) => {
      this.workerPromises.delete(issue.id);
      this.handleWorkerExit(issue.id, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private runtimeDurationMs(entry: RunningEntry): number {
    return Math.max(0, Date.now() - entry.started_at.getTime());
  }

  private missionControlResultPayload(
    entry: RunningEntry,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      issue_identifier: entry.identifier,
      last_event: entry.last_codex_event,
      last_message: entry.last_codex_message,
      session_id: entry.session_id,
      turn_count: entry.turn_count,
      duration_ms: this.runtimeDurationMs(entry),
      ...extra,
    };
  }

  private handleAgentEvent(issueId: string, event: AgentEvent): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;
    const missionControlBinding = this.missionControlBindings.get(issueId);

    entry.last_codex_event = event.event;
    entry.last_codex_timestamp = event.timestamp;

    if (event.codex_app_server_pid) {
      entry.codex_app_server_pid = event.codex_app_server_pid;
    }

    if (event.payload?.session_id) {
      entry.session_id = String(event.payload.session_id);
    }

    if (event.payload?.content) {
      entry.last_codex_message = String(event.payload.content).slice(0, 200);
    }

    if (event.event === "session_started") {
      entry.turn_count++;
      if (missionControlBinding) {
        void sendMissionControlCallback(missionControlBinding, entry, {
          status: "running",
          external_run_id: missionControlBinding.external_run_id,
          workspace_path: missionControlBinding.workspace_path,
          branch_name: missionControlBinding.branch_name,
          summary: "Symphony worker session started.",
          issue_identifier: entry.identifier,
          duration_ms: this.runtimeDurationMs(entry),
          result_payload: this.missionControlResultPayload(entry, {
            last_event: event.event,
          }),
        });
      }
    }

    // Update token counts from absolute totals
    if (event.usage) {
      const input = event.usage.input_tokens ?? 0;
      const output = event.usage.output_tokens ?? 0;
      const total = event.usage.total_tokens ?? 0;

      // Compute deltas from last reported
      const deltaInput = Math.max(0, input - entry.last_reported_input_tokens);
      const deltaOutput = Math.max(
        0,
        output - entry.last_reported_output_tokens,
      );
      const deltaTotal = Math.max(0, total - entry.last_reported_total_tokens);

      entry.codex_input_tokens += deltaInput;
      entry.codex_output_tokens += deltaOutput;
      entry.codex_total_tokens += deltaTotal;
      entry.last_reported_input_tokens = input;
      entry.last_reported_output_tokens = output;
      entry.last_reported_total_tokens = total;

      // Accumulate to global totals
      this.state.codex_totals.input_tokens += deltaInput;
      this.state.codex_totals.output_tokens += deltaOutput;
      this.state.codex_totals.total_tokens += deltaTotal;

      if (missionControlBinding) {
        void sendMissionControlCallback(missionControlBinding, entry, {
          status: "running",
          external_run_id: missionControlBinding.external_run_id,
          workspace_path: missionControlBinding.workspace_path,
          branch_name: missionControlBinding.branch_name,
          summary: entry.last_codex_message ?? "Symphony worker is running.",
          issue_identifier: entry.identifier,
          duration_ms: this.runtimeDurationMs(entry),
          result_payload: this.missionControlResultPayload(entry, {
            last_event: event.event,
            usage: {
              input_tokens: entry.codex_input_tokens,
              output_tokens: entry.codex_output_tokens,
              total_tokens: entry.codex_total_tokens,
            },
          }),
        });
      }
    }
  }

  private handleWorkerExit(issueId: string, result: WorkerResult): void {
    const entry = this.state.running.get(issueId);
    if (!entry) return;
    const missionControlBinding = this.missionControlBindings.get(issueId);

    const ctx = {
      issue_id: issueId,
      issue_identifier: entry.identifier,
    };

    // Add runtime seconds to totals
    this.state.codex_totals = addRuntimeSeconds(
      this.state.codex_totals,
      entry,
    );

    // Remove from running
    this.state.running.delete(issueId);
    this.missionControlBindings.delete(issueId);

    if (result.status === "normal") {
      log.info(`Worker completed normally`, ctx);
      this.state.completed.add(issueId);
      void this.sharedMemory.syncAfterRun();

      if (missionControlBinding) {
        void sendMissionControlCallback(missionControlBinding, entry, {
          status: "succeeded",
          external_run_id: missionControlBinding.external_run_id,
          workspace_path: missionControlBinding.workspace_path,
          branch_name: missionControlBinding.branch_name,
          summary: `Symphony worker completed normally after ${entry.turn_count} turn${entry.turn_count === 1 ? "" : "s"}.`,
          issue_identifier: entry.identifier,
          completion_kind: "normal",
          duration_ms: this.runtimeDurationMs(entry),
          result_payload: this.missionControlResultPayload(entry, {
            completion_kind: "normal",
            usage: {
              input_tokens: entry.codex_input_tokens,
              output_tokens: entry.codex_output_tokens,
              total_tokens: entry.codex_total_tokens,
            },
          }),
        });
        return;
      }

      // Schedule continuation retry
      scheduleRetry(this.state, issueId, 1, {
        identifier: entry.identifier,
        isContinuation: true,
        maxBackoffMs: this.config.agent.max_retry_backoff_ms,
        onFire: (id) => this.handleRetryFired(id),
      });
    } else {
      log.warn(`Worker failed: ${result.error}`, ctx);
      void this.sharedMemory.syncAfterRun();

      if (missionControlBinding) {
        void sendMissionControlCallback(missionControlBinding, entry, {
          status: "failed",
          external_run_id: missionControlBinding.external_run_id,
          workspace_path: missionControlBinding.workspace_path,
          branch_name: missionControlBinding.branch_name,
          summary: "Symphony worker failed.",
          error_message: result.error,
          issue_identifier: entry.identifier,
          completion_kind: "error",
          duration_ms: this.runtimeDurationMs(entry),
          result_payload: this.missionControlResultPayload(entry, {
            completion_kind: "error",
            usage: {
              input_tokens: entry.codex_input_tokens,
              output_tokens: entry.codex_output_tokens,
              total_tokens: entry.codex_total_tokens,
            },
          }),
        });
        return;
      }

      const nextAttempt = (entry.retry_attempt ?? 0) + 1;
      scheduleRetry(this.state, issueId, nextAttempt, {
        identifier: entry.identifier,
        error: result.error,
        maxBackoffMs: this.config.agent.max_retry_backoff_ms,
        onFire: (id) => this.handleRetryFired(id),
      });
    }
  }

  private async handleRetryFired(issueId: string): Promise<void> {
    const retryEntry = this.state.retry_attempts.get(issueId);
    if (!retryEntry) return;

    // Remove from retry queue
    this.state.retry_attempts.delete(issueId);

    const ctx = {
      issue_id: issueId,
      issue_identifier: retryEntry.identifier,
    };

    log.info(`Retry fired: attempt=${retryEntry.attempt}`, ctx);

    // Fetch candidates to check if still eligible
    let candidates: Issue[];
    try {
      candidates = await this.tracker.fetchCandidateIssues();
    } catch (err) {
      log.warn(
        `Retry poll failed: ${err instanceof Error ? err.message : String(err)}`,
        ctx,
      );
      scheduleRetry(this.state, issueId, retryEntry.attempt + 1, {
        identifier: retryEntry.identifier,
        error: "retry poll failed",
        maxBackoffMs: this.config.agent.max_retry_backoff_ms,
        onFire: (id) => this.handleRetryFired(id),
      });
      return;
    }

    const issue = candidates.find((c) => c.id === issueId);
    if (!issue) {
      log.info(`Issue no longer a candidate, releasing claim`, ctx);
      this.state.claimed.delete(issueId);
      return;
    }

    // Check slots
    const runningCount = this.state.running.size;
    if (runningCount >= this.state.max_concurrent_agents) {
      scheduleRetry(this.state, issueId, retryEntry.attempt + 1, {
        identifier: issue.identifier,
        error: "no available orchestrator slots",
        maxBackoffMs: this.config.agent.max_retry_backoff_ms,
        onFire: (id) => this.handleRetryFired(id),
      });
      return;
    }

    // Dispatch
    this.dispatchIssue(issue, retryEntry.attempt);
  }

  private async terminateRunningIssue(
    issueId: string,
    cleanupWorkspace: boolean,
    reason: string,
  ): Promise<void> {
    const entry = this.state.running.get(issueId);
    if (!entry) return;

    log.info(`Terminating run: ${reason}`, {
      issue_id: issueId,
      issue_identifier: entry.identifier,
    });

    // Add runtime to totals
    this.state.codex_totals = addRuntimeSeconds(
      this.state.codex_totals,
      entry,
    );

    // Remove from running and claimed
    this.state.running.delete(issueId);
    this.missionControlBindings.delete(issueId);
    this.state.claimed.delete(issueId);
    cancelRetry(this.state, issueId);

    // Cancel the worker promise (best effort)
    const wp = this.workerPromises.get(issueId);
    if (wp) {
      this.workerPromises.delete(issueId);
    }

    // Cleanup workspace if needed
    if (cleanupWorkspace) {
      await this.workspaceManager.removeWorkspace(entry.identifier);
    }
  }
}
