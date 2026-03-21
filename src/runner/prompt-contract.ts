import { existsSync, readFileSync } from "node:fs";
import type { PromptContractConfig } from "../types.js";

function readSection(path: string | null): string {
  if (!path || !existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

export function composePromptTemplate(
  workflowPrompt: string,
  contractConfig: PromptContractConfig,
): string {
  const soul = readSection(contractConfig.soul_path);
  const agents = readSection(contractConfig.agents_path);
  const sections = [
    soul
      ? ["## Operating Contract", "### SOUL.md", soul].join("\n\n")
      : "",
    agents
      ? ["### AGENTS.md", agents].join("\n\n")
      : "",
    workflowPrompt
      ? ["## Workflow Task Contract", workflowPrompt.trim()].join("\n\n")
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}
