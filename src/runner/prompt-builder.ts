import { Liquid } from "liquidjs";
import type { Issue, PromptContractConfig } from "../types.js";
import { TemplateParseError, TemplateRenderError } from "../errors.js";
import { composePromptTemplate } from "./prompt-contract.js";

const engine = new Liquid({
  strictVariables: true,
  strictFilters: true,
});

const DEFAULT_PROMPT = "You are working on an issue from Linear.";

/**
 * Build the prompt for a turn.
 * For the first turn, renders the full template.
 * For continuation turns, returns continuation guidance.
 */
export function buildTurnPrompt(
  promptTemplate: string,
  issue: Issue,
  attempt: number | null,
  turnNumber: number,
  contractConfig?: PromptContractConfig,
): string {
  if (turnNumber > 1) {
    return buildContinuationPrompt(issue, attempt, turnNumber);
  }

  return renderPrompt(promptTemplate, issue, attempt, contractConfig);
}

/**
 * Render the workflow prompt template with issue data.
 */
export function renderPrompt(
  promptTemplate: string,
  issue: Issue,
  attempt: number | null,
  contractConfig?: PromptContractConfig,
): string {
  const baseTemplate = promptTemplate || DEFAULT_PROMPT;
  const template = contractConfig
    ? composePromptTemplate(baseTemplate, contractConfig)
    : baseTemplate;

  // Convert issue to template-friendly object with string keys
  const issueObj: Record<string, unknown> = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    state: issue.state,
    branch_name: issue.branch_name,
    url: issue.url,
    labels: issue.labels,
    blocked_by: issue.blocked_by.map((b) => ({
      id: b.id,
      identifier: b.identifier,
      state: b.state,
    })),
    created_at: issue.created_at?.toISOString() ?? null,
    updated_at: issue.updated_at?.toISOString() ?? null,
  };

  try {
    const rendered = engine.parseAndRenderSync(template, {
      issue: issueObj,
      attempt,
    });
    return rendered;
  } catch (err) {
    if (err instanceof Error && err.message.includes("parse")) {
      throw new TemplateParseError(err.message, err);
    }
    throw new TemplateRenderError(
      `Prompt rendering failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

function buildContinuationPrompt(
  issue: Issue,
  attempt: number | null,
  turnNumber: number,
): string {
  return [
    `Continue working on ${issue.identifier}: ${issue.title}.`,
    `This is turn ${turnNumber} of the current session.`,
    `The issue is currently in state "${issue.state}".`,
    attempt !== null ? `This is retry attempt ${attempt}.` : "",
    `Check the current state and continue where you left off.`,
  ]
    .filter(Boolean)
    .join(" ");
}
