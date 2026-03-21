import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promises as fs } from "node:fs";
import type {
  AgentEvent,
  AgentRunner,
  AgentSession,
  CodexConfig,
  Issue,
  TurnResult,
} from "../types.js";
import { AgentRunnerError } from "../errors.js";
import { log } from "../logging/logger.js";

/**
 * Codex CLI runner.
 * Uses `codex exec --json` to run a single-turn session.
 */
export class CodexCliRunner implements AgentRunner {
  async startSession(
    workspacePath: string,
    config: CodexConfig,
  ): Promise<AgentSession> {
    return new CodexCliSession(workspacePath, config);
  }
}

class CodexCliSession implements AgentSession {
  thread_id = "";
  turn_id = "";
  pid: string | null = null;

  private child: ChildProcess | null = null;
  private readonly workspacePath: string;
  private readonly config: CodexConfig;
  private turnCount = 0;

  constructor(workspacePath: string, config: CodexConfig) {
    this.workspacePath = workspacePath;
    this.config = config;
  }

  async runTurn(
    prompt: string,
    issue: Issue,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    this.turnCount += 1;
    const turnId = `turn-${this.turnCount}`;
    const outputPath = join(
      tmpdir(),
      `symphony-codex-last-message-${process.pid}-${Date.now()}-${this.turnCount}.txt`,
    );

    const child = spawn(
      "bash",
      [
        "-lc",
        `${this.config.command} exec --json --skip-git-repo-check --color never -o "${outputPath}" -`,
      ],
      {
        cwd: this.workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      },
    );

    this.child = child;
    this.pid = child.pid ? String(child.pid) : null;
    this.turn_id = turnId;

    if (!child.pid) {
      throw new AgentRunnerError(
        "codex_not_found",
        `Failed to spawn codex CLI: ${this.config.command}`,
      );
    }

    onEvent({
      event: "session_started",
      timestamp: new Date(),
      codex_app_server_pid: this.pid ?? undefined,
      payload: {
        session_id: turnId,
        thread_id: this.thread_id,
        turn_id: this.turn_id,
        runner: "codex-cli",
        issue: `${issue.identifier}: ${issue.title}`,
      },
    });

    child.stdin!.write(prompt);
    child.stdin!.end();

    return this.streamOutput(child, outputPath, onEvent);
  }

  private async streamOutput(
    child: ChildProcess,
    outputPath: string,
    onEvent: (event: AgentEvent) => void,
  ): Promise<TurnResult> {
    return new Promise<TurnResult>((resolve) => {
      const rl = createInterface({ input: child.stdout! });
      let lastContent = "";
      let completed = false;

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ status: "timeout" });
      }, this.config.turn_timeout_ms);

      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          log.debug(`codex stderr: ${text.slice(0, 500)}`);
        }
      });

      rl.on("line", (line) => {
        if (!line.trim().startsWith("{")) return;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }

        const type = String(msg.type ?? "");
        const payload = msg.item && typeof msg.item === "object"
          ? (msg.item as Record<string, unknown>)
          : msg;

        if (type === "thread.started") {
          this.thread_id = String(msg.thread_id ?? "");
        }

        if (type === "item.completed") {
          const itemType = String(payload.type ?? "");
          if (itemType === "assistant_message") {
            lastContent = extractAssistantText(payload) || lastContent;
          }
          if (itemType === "error") {
            onEvent({
              event: "turn_failed",
              timestamp: new Date(),
              payload: { error: String(payload.message ?? "codex error") },
            });
          }
        }

        if (type === "turn.completed") {
          completed = true;
        }

        onEvent({
          event: type || "other_message",
          timestamp: new Date(),
          payload,
        });
      });

      child.on("exit", async (code) => {
        clearTimeout(timer);
        rl.close();

        const fileContent = await readOutputFile(outputPath);
        if (fileContent) {
          lastContent = fileContent;
        }

        if (code === 0) {
          onEvent({
            event: "turn_completed",
            timestamp: new Date(),
            payload: { content: lastContent.slice(0, 500) },
          });
          resolve({ status: "completed" });
          return;
        }

        if (completed) {
          onEvent({
            event: "turn_completed",
            timestamp: new Date(),
            payload: { content: lastContent.slice(0, 500) },
          });
          resolve({ status: "completed" });
          return;
        }

        resolve({
          status: "failed",
          error: `codex exited with code ${code}`,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        rl.close();
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

function extractAssistantText(
  payload: Record<string, unknown>,
): string {
  const raw = payload.text;
  if (typeof raw === "string") return raw;

  const content = payload.content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const text = (item as Record<string, unknown>).text;
    if (typeof text === "string") {
      parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

async function readOutputFile(path: string): Promise<string> {
  try {
    const text = await fs.readFile(path, "utf8");
    await fs.unlink(path).catch(() => undefined);
    return text.trim();
  } catch {
    return "";
  }
}
