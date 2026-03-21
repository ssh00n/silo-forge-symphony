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

/**
 * Claude Code CLI runner.
 * Uses `claude --print --output-format stream-json` to run a single-turn session.
 */
export class ClaudeCodeRunner implements AgentRunner {
  async startSession(
    workspacePath: string,
    config: CodexConfig,
  ): Promise<AgentSession> {
    return new ClaudeCodeSession(workspacePath, config);
  }
}

class ClaudeCodeSession implements AgentSession {
  thread_id = "";
  turn_id = "";
  pid: string | null = null;

  private workspacePath: string;
  private config: CodexConfig;
  private child: ChildProcess | null = null;
  private turnCount = 0;

  constructor(workspacePath: string, config: CodexConfig) {
    this.workspacePath = workspacePath;
    this.config = config;
    this.thread_id = `claude-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async runTurn(
    prompt: string,
    issue: Issue,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    this.turnCount++;
    this.turn_id = `turn-${this.turnCount}`;

    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--max-turns",
      String(this.config.turn_timeout_ms > 0 ? 50 : 10),
      "--verbose",
    ];

    // Determine the command to run
    const command = this.config.command.includes("claude")
      ? this.config.command
      : "claude";

    const child = spawn(command, args, {
      cwd: this.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.child = child;
    this.pid = child.pid ? String(child.pid) : null;

    if (!child.pid) {
      throw new AgentRunnerError(
        "codex_not_found",
        "Failed to spawn claude process",
      );
    }

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

    // Write the prompt to stdin
    child.stdin!.write(prompt);
    child.stdin!.end();

    return this.streamOutput(child, onEvent);
  }

  private async streamOutput(
    child: ChildProcess,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    return new Promise<TurnResult>((resolve) => {
      const rl = createInterface({ input: child.stdout! });
      let lastContent = "";

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ status: "timeout" });
      }, this.config.turn_timeout_ms);

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          log.debug(`claude stderr: ${text.slice(0, 500)}`);
        }
      });

      rl.on("line", (line) => {
        if (!line.trim()) return;

        try {
          const msg = JSON.parse(line);

          if (msg.type === "content_block_delta" && msg.delta?.text) {
            lastContent += msg.delta.text;
          }

          if (msg.type === "message_stop" || msg.type === "result") {
            onEvent({
              event: "turn_completed",
              timestamp: new Date(),
              usage: msg.usage
                ? {
                    input_tokens: msg.usage.input_tokens ?? 0,
                    output_tokens: msg.usage.output_tokens ?? 0,
                    total_tokens:
                      (msg.usage.input_tokens ?? 0) +
                      (msg.usage.output_tokens ?? 0),
                  }
                : undefined,
              payload: { content: lastContent.slice(0, 500) },
            });
          }

          // Forward other events
          if (msg.type) {
            onEvent({
              event: msg.type,
              timestamp: new Date(),
              payload: { raw_type: msg.type },
            });
          }
        } catch {
          // Not JSON, ignore
        }
      });

      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ status: "completed" });
        } else {
          resolve({
            status: "failed",
            error: `claude exited with code ${code}`,
          });
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ status: "failed", error: err.message });
      });
    });
  }

  async stop(): Promise<void> {
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.child?.kill("SIGKILL");
            resolve();
          }, 5000);
          this.child!.on("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } catch {
        // Already dead
      }
      this.child = null;
    }
  }
}
