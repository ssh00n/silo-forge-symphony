import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { log } from "../logging/logger.js";
import type {
  MissionControlDispatchAcceptance,
  MissionControlDispatchRequest,
} from "./mission-control-types.js";
import type { Orchestrator } from "../orchestrator/orchestrator.js";

function resolveBridgeToken(): string | null {
  return process.env.MISSION_CONTROL_BRIDGE_TOKEN?.trim() || null;
}

function unauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "unauthorized" }));
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function isDispatchRequest(value: unknown): value is MissionControlDispatchRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.execution_run_id === "string" &&
    typeof v.silo_slug === "string" &&
    typeof v.role_slug === "string" &&
    typeof v.workspace_root === "string" &&
    typeof v.callback_url === "string" &&
    typeof v.issue === "object" &&
    v.issue !== null
  );
}

function authorized(req: IncomingMessage): boolean {
  const expected = resolveBridgeToken();
  if (!expected) return true;
  const header = req.headers.authorization;
  if (!header) return false;
  const value = header.trim();
  if (!value.toLowerCase().startsWith("bearer ")) return false;
  return value.split(" ", 2)[1]?.trim() === expected;
}

export async function startMissionControlServer(opts: {
  port: number;
  orchestrator: Orchestrator;
}): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (req, res) => {
    if (!req.url) {
      json(res, 404, { error: "not_found" });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/api/v1/mission-control/dispatches") {
      if (!authorized(req)) {
        unauthorized(res);
        return;
      }
      try {
        const body = await readJson(req);
        if (!isDispatchRequest(body)) {
          json(res, 400, { error: "invalid_dispatch_request" });
          return;
        }
        const acceptance: MissionControlDispatchAcceptance =
          await opts.orchestrator.dispatchMissionControl(body);
        json(res, 200, acceptance);
        return;
      } catch (err) {
        log.error(
          `Mission Control dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        json(res, 500, {
          error: "dispatch_failed",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }

    json(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, () => resolve());
  });
  log.info(`Mission Control bridge listening on port ${opts.port}`);
  return server;
}
