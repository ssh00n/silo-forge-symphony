import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { SharedMemoryConfig } from "../types.js";
import { log } from "../logging/logger.js";

export class SharedMemoryCoordinator {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly getConfig: () => SharedMemoryConfig,
  ) {}

  syncBeforeDispatch(): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.sync_before_dispatch || !config.path) {
      return Promise.resolve();
    }
    return this.enqueue("before_dispatch", async () => {
      if (!existsSync(config.path!)) return;
      await runGit(config.path!, ["pull", "--rebase", "--quiet"]);
    });
  }

  syncAfterRun(): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.sync_after_run || !config.path) {
      return Promise.resolve();
    }
    return this.enqueue("after_run", async () => {
      if (!existsSync(config.path!)) return;

      const status = await runGit(config.path!, ["status", "--porcelain"]);
      if (!status.trim()) return;

      await runGit(config.path!, ["add", "-A"]);
      await runGit(config.path!, [
        "commit",
        "-m",
        `auto: symphony shared-memory sync (${new Date().toISOString()})`,
        "--quiet",
      ]);
      await runGit(config.path!, ["push", "--quiet"]);
    });
  }

  private enqueue(label: string, work: () => Promise<void>): Promise<void> {
    const next = this.queue
      .catch(() => undefined)
      .then(async () => {
        try {
          await work();
        } catch (err) {
          log.warn(
            `Shared memory sync failed (${label}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    this.queue = next;
    return next;
  }
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `git ${args.join(" ")} exited with code ${code}`));
    });
  });
}
