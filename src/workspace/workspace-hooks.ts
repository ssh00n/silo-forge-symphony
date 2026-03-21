import { spawn } from "node:child_process";
import { log } from "../logging/logger.js";

export interface HookResult {
  ok: boolean;
  error?: string;
}

/**
 * Execute a hook script in the workspace directory using bash -lc.
 */
export async function executeHook(
  hookName: string,
  script: string,
  cwd: string,
  timeoutMs: number,
): Promise<HookResult> {
  log.info(`Hook ${hookName} starting`, { cwd });

  return new Promise<HookResult>((resolve) => {
    const child = spawn("bash", ["-lc", script], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      // Truncate to prevent memory issues
      if (stdout.length > 10000) stdout = stdout.slice(-10000);
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 10000) stderr = stderr.slice(-10000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      log.error(`Hook ${hookName} error: ${err.message}`, { cwd });
      resolve({ ok: false, error: err.message });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        log.error(`Hook ${hookName} timed out after ${timeoutMs}ms`, { cwd });
        resolve({ ok: false, error: `Hook timed out after ${timeoutMs}ms` });
        return;
      }
      if (code !== 0) {
        const msg = `Hook ${hookName} exited with code ${code}`;
        log.error(msg, { cwd });
        if (stderr) log.error(`Hook stderr: ${stderr.slice(0, 500)}`, { cwd });
        resolve({ ok: false, error: msg });
        return;
      }
      log.info(`Hook ${hookName} completed successfully`, { cwd });
      resolve({ ok: true });
    });
  });
}
