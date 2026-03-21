import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { WorkflowDefinition } from "../types.js";
import {
  MissingWorkflowFile,
  WorkflowParseError,
  WorkflowFrontMatterNotAMap,
} from "../errors.js";

const FRONT_MATTER_DELIMITER = "---";

export function loadWorkflow(filePath: string): WorkflowDefinition {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new MissingWorkflowFile(filePath);
    }
    throw new WorkflowParseError(
      `Failed to read workflow file: ${filePath}`,
      err,
    );
  }

  return parseWorkflowContent(raw);
}

export function parseWorkflowContent(raw: string): WorkflowDefinition {
  const lines = raw.split("\n");

  if (lines[0]?.trim() !== FRONT_MATTER_DELIMITER) {
    // No front matter — entire content is prompt body
    return {
      config: {},
      prompt_template: raw.trim(),
    };
  }

  // Find closing delimiter
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FRONT_MATTER_DELIMITER) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    throw new WorkflowParseError(
      "YAML front matter opening '---' found but no closing '---'",
    );
  }

  const yamlBlock = lines.slice(1, endIdx).join("\n");
  const promptBody = lines.slice(endIdx + 1).join("\n").trim();

  let config: unknown;
  try {
    config = parseYaml(yamlBlock);
  } catch (err) {
    throw new WorkflowParseError("Failed to parse YAML front matter", err);
  }

  // Empty YAML block parses to null
  if (config === null || config === undefined) {
    config = {};
  }

  if (typeof config !== "object" || Array.isArray(config)) {
    throw new WorkflowFrontMatterNotAMap();
  }

  return {
    config: config as Record<string, unknown>,
    prompt_template: promptBody,
  };
}
