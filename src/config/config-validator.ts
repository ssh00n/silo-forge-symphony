import type { ServiceConfig, ValidationResult } from "../types.js";

export function validateDispatchConfig(
  config: ServiceConfig,
): ValidationResult {
  const errors: string[] = [];

  if (!config.tracker.kind) {
    errors.push("tracker.kind is required");
  } else if (config.tracker.kind !== "linear") {
    errors.push(
      `tracker.kind "${config.tracker.kind}" is not supported (expected "linear")`,
    );
  }

  if (!config.tracker.api_key) {
    errors.push("tracker.api_key is missing or empty after $VAR resolution");
  }

  if (config.tracker.kind === "linear" && !config.tracker.project_slug) {
    errors.push("tracker.project_slug is required when tracker.kind=linear");
  }

  if (!config.codex.command) {
    errors.push("codex.command is required and must not be empty");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
