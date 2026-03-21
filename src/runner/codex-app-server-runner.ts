import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentRunner,
  AgentSession,
  AgentEvent,
  TurnResult,
  Issue,
  CodexConfig,
} from "../types.js";
import { AgentRunnerError } from "../errors.js";
import { log } from "../logging/logger.js";

let nextRequestId = 1;

export class CodexAppServerRunner implements AgentRunner {
  async startSession(
    workspacePath: string,
    config: CodexConfig,
  ): Promise<AgentSession> {
    const child = spawn("bash", ["-lc", config.command], {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    if (!child.pid) {
      throw new AgentRunnerError(
        "codex_not_found",
        `Failed to spawn codex process: ${config.command}`,
      );
    }

    const session = new CodexSession(child, workspacePath, config);
    await session.initialize();
    return session;
  }
}

class CodexSession implements AgentSession {
  thread_id = "";
  turn_id = "";
  pid: string | null;

  private child: ChildProcess;
  private workspacePath: string;
  private config: CodexConfig;
  private lineBuffer: string[] = [];
  private lineResolvers: Array<(line: string) => void> = [];
  private closed = false;

  constructor(
    child: ChildProcess,
    workspacePath: string,
    config: CodexConfig,
  ) {
    this.child = child;
    this.workspacePath = workspacePath;
    this.config = config;
    this.pid = child.pid ? String(child.pid) : null;

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      if (this.lineResolvers.length > 0) {
        const resolve = this.lineResolvers.shift()!;
        resolve(line);
      } else {
        this.lineBuffer.push(line);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        log.debug(`codex stderr: ${text.slice(0, 500)}`);
      }
    });

    child.on("exit", () => {
      this.closed = true;
      // Reject any pending line readers
      for (const resolve of this.lineResolvers) {
        resolve("");
      }
      this.lineResolvers = [];
    });
  }

  private nextLine(timeoutMs: number): Promise<string> {
    if (this.lineBuffer.length > 0) {
      return Promise.resolve(this.lineBuffer.shift()!);
    }
    if (this.closed) {
      return Promise.reject(
        new AgentRunnerError("port_exit", "Codex process exited unexpectedly"),
      );
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.lineResolvers.indexOf(resolve);
        if (idx >= 0) this.lineResolvers.splice(idx, 1);
        reject(
          new AgentRunnerError(
            "response_timeout",
            `No response within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.lineResolvers.push((line: string) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
  ): number {
    const id = nextRequestId++;
    const msg = JSON.stringify({ id, method, params });
    this.child.stdin!.write(msg + "\n");
    return id;
  }

  private sendNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    const msg = JSON.stringify({ method, params });
    this.child.stdin!.write(msg + "\n");
  }

  private async readResponse(
    expectedId: number,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const line = await this.nextLine(Math.max(remaining, 100));
      if (!line) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // Skip malformed lines
      }

      if (parsed.id === expectedId) {
        if (parsed.error) {
          throw new AgentRunnerError(
            "response_error",
            `Request ${expectedId} failed: ${JSON.stringify(parsed.error)}`,
          );
        }
        return parsed;
      }
    }
    throw new AgentRunnerError(
      "response_timeout",
      `Timed out waiting for response to request ${expectedId}`,
    );
  }

  async initialize(): Promise<void> {
    // 1. initialize request
    const initId = this.sendRequest("initialize", {
      clientInfo: { name: "symphony", version: "1.0" },
      capabilities: {},
    });
    await this.readResponse(initId, this.config.read_timeout_ms);

    // 2. initialized notification
    this.sendNotification("initialized", {});

    // 3. thread/start request
    const threadId = this.sendRequest("thread/start", {
      approvalPolicy: this.config.approval_policy,
      sandbox: this.config.thread_sandbox,
      cwd: this.workspacePath,
    });
    const threadResp = await this.readResponse(
      threadId,
      this.config.read_timeout_ms,
    );

    const result = threadResp.result as Record<string, unknown> | undefined;
    const thread = result?.thread as Record<string, unknown> | undefined;
    this.thread_id = String(thread?.id ?? "");

    if (!this.thread_id) {
      throw new AgentRunnerError(
        "response_error",
        "No thread ID in thread/start response",
      );
    }

    log.info(`Codex session initialized: thread_id=${this.thread_id}`, {
      session_id: this.thread_id,
    });
  }

  async runTurn(
    prompt: string,
    issue: Issue,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    const turnId = this.sendRequest("turn/start", {
      threadId: this.thread_id,
      input: [{ type: "text", text: prompt }],
      cwd: this.workspacePath,
      title: `${issue.identifier}: ${issue.title}`,
      approvalPolicy: this.config.approval_policy,
      sandboxPolicy: { type: this.config.turn_sandbox_policy },
    });

    const turnResp = await this.readResponse(
      turnId,
      this.config.read_timeout_ms,
    );

    const turnResult = turnResp.result as Record<string, unknown> | undefined;
    const turn = turnResult?.turn as Record<string, unknown> | undefined;
    this.turn_id = String(turn?.id ?? "");

    onEvent({
      event: "session_started",
      timestamp: new Date(),
      codex_app_server_pid: this.pid ?? undefined,
      payload: {
        session_id: `${this.thread_id}-${this.turn_id}`,
        thread_id: this.thread_id,
        turn_id: this.turn_id,
      },
    });

    // Stream turn events until completion
    return this.streamTurn(onEvent);
  }

  private async streamTurn(
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    const deadline = Date.now() + this.config.turn_timeout_ms;

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let line: string;
      try {
        line = await this.nextLine(Math.min(remaining, 5000));
      } catch (err) {
        if (
          err instanceof AgentRunnerError &&
          err.code === "port_exit"
        ) {
          return { status: "failed", error: "Codex process exited" };
        }
        if (
          err instanceof AgentRunnerError &&
          err.code === "response_timeout"
        ) {
          continue; // Keep waiting until overall deadline
        }
        throw err;
      }

      if (!line) continue;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      const method = String(msg.method ?? "");
      const params = (msg.params ?? {}) as Record<string, unknown>;

      // Extract usage if present
      const usage = this.extractUsage(params);

      // Handle protocol messages
      if (method === "turn/completed") {
        onEvent({
          event: "turn_completed",
          timestamp: new Date(),
          usage,
        });
        return { status: "completed" };
      }

      if (method === "turn/failed") {
        const error = String(params.error ?? "unknown error");
        onEvent({
          event: "turn_failed",
          timestamp: new Date(),
          usage,
          payload: { error },
        });
        return { status: "failed", error };
      }

      if (method === "turn/cancelled") {
        onEvent({
          event: "turn_cancelled",
          timestamp: new Date(),
          usage,
        });
        return { status: "cancelled", reason: "cancelled by codex" };
      }

      // Handle approval requests (auto-approve)
      if (method === "item/approval/request" || method === "item/command/request") {
        const approvalId = msg.id;
        if (approvalId !== undefined) {
          this.child.stdin!.write(
            JSON.stringify({
              id: approvalId,
              result: { approved: true },
            }) + "\n",
          );
          onEvent({
            event: "approval_auto_approved",
            timestamp: new Date(),
            payload: { method },
          });
        }
        continue;
      }

      // Handle user input required (hard failure)
      if (
        method === "item/tool/requestUserInput" ||
        method === "turn/needsInput"
      ) {
        onEvent({
          event: "turn_input_required",
          timestamp: new Date(),
        });
        return { status: "input_required" };
      }

      // Handle unsupported tool calls
      if (method === "item/tool/call") {
        const toolCallId = msg.id;
        if (toolCallId !== undefined) {
          this.child.stdin!.write(
            JSON.stringify({
              id: toolCallId,
              result: { success: false, error: "unsupported_tool_call" },
            }) + "\n",
          );
          onEvent({
            event: "unsupported_tool_call",
            timestamp: new Date(),
            payload: { tool: params.name },
          });
        }
        continue;
      }

      // Generic event forwarding
      onEvent({
        event: method || "other_message",
        timestamp: new Date(),
        usage,
        payload: params,
      });
    }

    return { status: "timeout" };
  }

  private extractUsage(
    params: Record<string, unknown>,
  ): Record<string, number> | undefined {
    // Try various common shapes
    const usage =
      (params.usage as Record<string, number>) ??
      (params.total_token_usage as Record<string, number>) ??
      (params.tokenUsage as Record<string, number>);
    if (!usage || typeof usage !== "object") return undefined;
    return {
      input_tokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
      output_tokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? usage.totalTokens ?? 0),
    };
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.child.kill("SIGTERM");
      // Give it a moment then force
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.child.kill("SIGKILL");
          resolve();
        }, 5000);
        this.child.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch {
      // Already dead
    }
  }
}
