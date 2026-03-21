#!/usr/bin/env node

import type { Server } from "node:http";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { LinearClient } from "./tracker/linear/linear-client.js";
import { FallbackAgentRunner } from "./runner/fallback-runner.js";
import { log, setLogLevel } from "./logging/logger.js";
import { startMissionControlServer } from "./control-plane/mission-control-server.js";
import type { ServiceConfig, IssueTracker, AgentRunner } from "./types.js";

function parseArgs(argv: string[]): {
  workflowPath: string;
  port: number | null;
  logLevel: string;
  runner: string;
} {
  let workflowPath = "";
  let port: number | null = null;
  let logLevel = "info";
  let runner = "auto";

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--port" && i + 1 < argv.length) {
      port = parseInt(argv[++i]!, 10);
    } else if (arg === "--log-level" && i + 1 < argv.length) {
      logLevel = argv[++i]!;
    } else if (arg === "--runner" && i + 1 < argv.length) {
      runner = argv[++i]!;
    } else if (!arg.startsWith("-")) {
      workflowPath = arg;
    }
  }

  if (!workflowPath) {
    workflowPath = "./WORKFLOW.md";
  }

  return { workflowPath, port, logLevel, runner };
}

function createTracker(config: ServiceConfig): IssueTracker {
  return new LinearClient(() => config.tracker);
}

function createRunner(runnerType: string): (_config: ServiceConfig) => AgentRunner {
  return (_config: ServiceConfig): AgentRunner => {
    const normalizedRunner =
      runnerType === "codex"
        ? "codex-cli"
        : runnerType === "claude"
          ? "claude"
          : "auto";
    return new FallbackAgentRunner(
      normalizedRunner,
    );
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (
    args.logLevel === "debug" ||
    args.logLevel === "info" ||
    args.logLevel === "warn" ||
    args.logLevel === "error"
  ) {
    setLogLevel(args.logLevel);
  }

  const workflowPath = resolve(args.workflowPath);

  if (!existsSync(workflowPath)) {
    log.error(`Workflow file not found: ${workflowPath}`);
    process.exit(1);
  }

  log.info(`Using workflow: ${workflowPath}`);
  log.info(`Using runner: ${args.runner}`);

  const orchestrator = new Orchestrator(
    workflowPath,
    createTracker,
    createRunner(args.runner),
  );
  let controlPlaneServer: Server | null = null;

  // Graceful shutdown
  let shutdownInProgress = false;

  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    log.info(`Received ${signal}, shutting down...`);
    try {
      if (controlPlaneServer) {
        await new Promise<void>((resolve, reject) => {
          controlPlaneServer?.close((err) => (err ? reject(err) : resolve()));
        });
        controlPlaneServer = null;
      }
      await orchestrator.stop();
      process.exit(0);
    } catch (err) {
      log.error(
        `Shutdown error: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await orchestrator.start();
    if (args.port !== null) {
      controlPlaneServer = await startMissionControlServer({
        port: args.port,
        orchestrator,
      });
    }
  } catch (err) {
    log.error(
      `Startup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
