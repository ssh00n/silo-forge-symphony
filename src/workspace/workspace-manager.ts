import { mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Workspace, HooksConfig } from "../types.js";
import {
  sanitizeIdentifier,
  validatePathContainment,
} from "./workspace-safety.js";
import { executeHook } from "./workspace-hooks.js";
import { log } from "../logging/logger.js";

export class WorkspaceManager {
  constructor(private getConfig: () => { root: string; hooks: HooksConfig }) {}

  /**
   * Create or reuse a workspace for the given issue identifier.
   */
  async createForIssue(issueIdentifier: string): Promise<Workspace> {
    const config = this.getConfig();
    const workspaceKey = sanitizeIdentifier(issueIdentifier);
    const workspacePath = resolve(join(config.root, workspaceKey));

    validatePathContainment(workspacePath, config.root);

    // Ensure workspace root exists
    mkdirSync(config.root, { recursive: true });

    let createdNow = false;

    if (existsSync(workspacePath)) {
      const stat = statSync(workspacePath);
      if (!stat.isDirectory()) {
        // Non-directory at workspace location: remove and recreate
        log.warn(
          `Non-directory found at workspace path, removing: ${workspacePath}`,
        );
        rmSync(workspacePath, { force: true });
        mkdirSync(workspacePath, { recursive: true });
        createdNow = true;
      }
    } else {
      mkdirSync(workspacePath, { recursive: true });
      createdNow = true;
    }

    // Run after_create hook only for new workspaces
    if (createdNow && config.hooks.after_create) {
      const result = await executeHook(
        "after_create",
        config.hooks.after_create,
        workspacePath,
        config.hooks.timeout_ms,
      );
      if (!result.ok) {
        // Fatal: remove partially created workspace
        try {
          rmSync(workspacePath, { recursive: true, force: true });
        } catch {
          // Best effort
        }
        throw new Error(
          `after_create hook failed: ${result.error}`,
        );
      }
    }

    return {
      path: workspacePath,
      workspace_key: workspaceKey,
      created_now: createdNow,
    };
  }

  /**
   * Run the before_run hook if configured.
   */
  async runBeforeRun(workspacePath: string): Promise<void> {
    const config = this.getConfig();
    if (!config.hooks.before_run) return;

    const result = await executeHook(
      "before_run",
      config.hooks.before_run,
      workspacePath,
      config.hooks.timeout_ms,
    );
    if (!result.ok) {
      throw new Error(`before_run hook failed: ${result.error}`);
    }
  }

  /**
   * Run the after_run hook if configured. Failures are logged and ignored.
   */
  async runAfterRun(workspacePath: string): Promise<void> {
    const config = this.getConfig();
    if (!config.hooks.after_run) return;

    await executeHook(
      "after_run",
      config.hooks.after_run,
      workspacePath,
      config.hooks.timeout_ms,
    );
  }

  /**
   * Remove a workspace directory, running before_remove hook first.
   */
  async removeWorkspace(issueIdentifier: string): Promise<void> {
    const config = this.getConfig();
    const workspaceKey = sanitizeIdentifier(issueIdentifier);
    const workspacePath = resolve(join(config.root, workspaceKey));

    if (!existsSync(workspacePath)) return;

    // Run before_remove hook (failure ignored)
    if (config.hooks.before_remove) {
      await executeHook(
        "before_remove",
        config.hooks.before_remove,
        workspacePath,
        config.hooks.timeout_ms,
      );
    }

    try {
      rmSync(workspacePath, { recursive: true, force: true });
      log.info(`Workspace removed: ${workspacePath}`);
    } catch (err) {
      log.error(
        `Failed to remove workspace: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
