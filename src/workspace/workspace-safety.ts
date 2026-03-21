import { resolve } from "node:path";
import { WorkspaceSafetyError } from "../errors.js";

const SAFE_CHARS = /^[A-Za-z0-9._-]+$/;

/**
 * Sanitize an issue identifier for use as a workspace directory name.
 * Replaces any character not in [A-Za-z0-9._-] with '_'.
 */
export function sanitizeIdentifier(identifier: string): string {
  if (SAFE_CHARS.test(identifier)) return identifier;
  return identifier.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Validate that a workspace path stays inside the workspace root.
 */
export function validatePathContainment(
  workspacePath: string,
  workspaceRoot: string,
): void {
  const absRoot = resolve(workspaceRoot);
  const absPath = resolve(workspacePath);

  // Path must be under root (not equal to root itself)
  if (!absPath.startsWith(absRoot + "/") && absPath !== absRoot) {
    throw new WorkspaceSafetyError(
      `Workspace path "${absPath}" is outside workspace root "${absRoot}"`,
    );
  }

  // Path must not be exactly the root
  if (absPath === absRoot) {
    throw new WorkspaceSafetyError(
      `Workspace path cannot be the workspace root itself`,
    );
  }
}

/**
 * Validate that a cwd matches the expected workspace path.
 */
export function validateWorkspaceCwd(
  cwd: string,
  expectedPath: string,
): void {
  const absCwd = resolve(cwd);
  const absExpected = resolve(expectedPath);
  if (absCwd !== absExpected) {
    throw new WorkspaceSafetyError(
      `Agent cwd "${absCwd}" does not match workspace path "${absExpected}"`,
    );
  }
}
