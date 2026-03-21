import type {
  AgentEvent,
  AgentRunner,
  AgentSession,
  CodexConfig,
  Issue,
  TurnResult,
} from "../types.js";
import { ClaudeCodeRunner } from "./claude-code-runner.js";
import { CodexCliRunner } from "./codex-cli-runner.js";
import { CodexAppServerRunner } from "./codex-app-server-runner.js";
import { log } from "../logging/logger.js";

type RunnerKind = "auto" | "claude" | "codex-cli" | "codex-app-server";

function detectRunnerKind(command: string): Exclude<RunnerKind, "auto"> {
  if (command.includes("claude")) return "claude";
  if (command.includes("app-server")) return "codex-app-server";
  return "codex-cli";
}

function withCommand(config: CodexConfig, command: string): CodexConfig {
  return { ...config, command };
}

export class FallbackAgentRunner implements AgentRunner {
  constructor(private readonly mode: RunnerKind = "auto") {}

  async startSession(
    workspacePath: string,
    config: CodexConfig,
  ): Promise<AgentSession> {
    const primaryKind =
      this.mode === "auto" ? detectRunnerKind(config.command) : this.mode;
    const fallbackKind = config.fallback_command
      ? detectRunnerKind(config.fallback_command)
      : null;

    return FallbackAgentSession.create(
      workspacePath,
      config,
      primaryKind,
      fallbackKind,
    );
  }
}

class FallbackAgentSession implements AgentSession {
  thread_id = "";
  turn_id = "";
  pid: string | null = null;

  private currentSession: AgentSession | null = null;
  private activeKind: Exclude<RunnerKind, "auto">;

  private constructor(
    private readonly workspacePath: string,
    private readonly primaryConfig: CodexConfig,
    private readonly primaryKind: Exclude<RunnerKind, "auto">,
    private readonly fallbackKind: Exclude<RunnerKind, "auto"> | null,
  ) {
    this.activeKind = primaryKind;
  }

  static async create(
    workspacePath: string,
    config: CodexConfig,
    primaryKind: Exclude<RunnerKind, "auto">,
    fallbackKind: Exclude<RunnerKind, "auto"> | null,
  ): Promise<FallbackAgentSession> {
    const session = new FallbackAgentSession(
      workspacePath,
      config,
      primaryKind,
      fallbackKind,
    );
    await session.startInitialSession();
    return session;
  }

  async runTurn(
    prompt: string,
    issue: Issue,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    if (!this.currentSession) {
      throw new Error("runner session not initialized");
    }

    const result = await this.currentSession.runTurn(prompt, issue, onEvent);
    this.syncState();

    if (result.status === "completed" || !this.canFallback()) {
      return result;
    }

    log.warn(
      `Primary runner failed, switching from ${this.activeKind} to ${this.fallbackKind}`,
      { issue_id: issue.id, issue_identifier: issue.identifier },
    );

    onEvent({
      event: "runner_fallback",
      timestamp: new Date(),
      payload: {
        from: this.activeKind,
        to: this.fallbackKind ?? undefined,
        reason: "turn_failed",
        error:
          "error" in result
            ? result.error
            : "reason" in result
              ? result.reason
              : result.status,
      },
    });

    await this.currentSession.stop();
    await this.startFallbackSession();
    const fallbackResult = await this.currentSession!.runTurn(prompt, issue, onEvent);
    this.syncState();
    return fallbackResult;
  }

  async stop(): Promise<void> {
    if (this.currentSession) {
      await this.currentSession.stop();
      this.syncState();
    }
  }

  private async startInitialSession(): Promise<void> {
    try {
      this.currentSession = await this.startSessionForKind(
        this.primaryKind,
        this.primaryConfig.command,
      );
      this.activeKind = this.primaryKind;
      this.syncState();
    } catch (err) {
      if (!this.canFallback()) {
        throw err;
      }
      log.warn(
        `Primary runner startup failed, switching from ${this.primaryKind} to ${this.fallbackKind}`,
      );
      await this.startFallbackSession();
    }
  }

  private async startFallbackSession(): Promise<void> {
    if (!this.fallbackKind || !this.primaryConfig.fallback_command) {
      throw new Error("fallback runner is not configured");
    }

    this.currentSession = await this.startSessionForKind(
      this.fallbackKind,
      this.primaryConfig.fallback_command,
    );
    this.activeKind = this.fallbackKind;
    this.syncState();
  }

  private async startSessionForKind(
    kind: Exclude<RunnerKind, "auto">,
    command: string,
  ): Promise<AgentSession> {
    const config = withCommand(this.primaryConfig, command);
    const runner =
      kind === "claude"
        ? new ClaudeCodeRunner()
        : kind === "codex-app-server"
          ? new CodexAppServerRunner()
          : new CodexCliRunner();
    return runner.startSession(this.workspacePath, config);
  }

  private canFallback(): boolean {
    return (
      this.activeKind === this.primaryKind &&
      !!this.fallbackKind &&
      !!this.primaryConfig.fallback_command
    );
  }

  private syncState(): void {
    this.thread_id = this.currentSession?.thread_id ?? "";
    this.turn_id = this.currentSession?.turn_id ?? "";
    this.pid = this.currentSession?.pid ?? null;
  }
}
