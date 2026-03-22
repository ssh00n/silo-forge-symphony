import { log } from "../logging/logger.js";
import { executionCallbackPayloadSchemaJson } from "../contracts/generated/schemas.js";
import { validateContractPayload, ContractValidationError } from "../contracts/json-schema.js";
import type { RunningEntry } from "../types.js";
import type {
  MissionControlCallbackPayload,
  MissionControlRunBinding,
} from "./mission-control-types.js";

function resolveCallbackToken(): string | null {
  const explicit = process.env.MISSION_CONTROL_CALLBACK_TOKEN?.trim();
  if (explicit) return explicit;
  const fallback = process.env.MISSION_CONTROL_BRIDGE_TOKEN?.trim();
  return fallback || null;
}

export async function sendMissionControlCallback(
  binding: MissionControlRunBinding,
  entry: RunningEntry,
  payload: MissionControlCallbackPayload,
): Promise<void> {
  try {
    validateContractPayload(
      executionCallbackPayloadSchemaJson as Record<string, unknown>,
      payload,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      `Mission Control callback payload failed contract validation: ${message}`,
      {
        issue_id: entry.issue.id,
        issue_identifier: entry.identifier,
        callback_url: binding.callback_url,
      },
    );
    if (err instanceof ContractValidationError) {
      return;
    }
    throw err;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = resolveCallbackToken();
  if (token) {
    headers["X-Symphony-Token"] = token;
  }

  try {
    const response = await fetch(binding.callback_url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      log.warn(`Mission Control callback failed: ${response.status} ${response.statusText}`, {
        issue_id: entry.issue.id,
        issue_identifier: entry.identifier,
        callback_url: binding.callback_url,
      });
    }
  } catch (err) {
    log.warn(
      `Mission Control callback request failed: ${err instanceof Error ? err.message : String(err)}`,
      {
        issue_id: entry.issue.id,
        issue_identifier: entry.identifier,
        callback_url: binding.callback_url,
      },
    );
  }
}
