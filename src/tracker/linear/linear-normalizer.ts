import type { Issue, BlockerRef } from "../../types.js";

interface LinearIssueNode {
  id: string;
  identifier: string;
  title?: string;
  description?: string | null;
  priority?: number | null;
  branchName?: string | null;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  state?: { name: string } | null;
  labels?: { nodes: Array<{ name: string }> } | null;
  inverseRelations?: {
    nodes: Array<{
      type: string;
      issue: {
        id: string;
        identifier: string;
        state?: { name: string } | null;
      };
    }>;
  } | null;
}

function normalizeBlockers(node: LinearIssueNode): BlockerRef[] {
  if (!node.inverseRelations?.nodes) return [];
  return node.inverseRelations.nodes
    .filter((rel) => rel.type === "blocks")
    .map((rel) => ({
      id: rel.issue.id ?? null,
      identifier: rel.issue.identifier ?? null,
      state: rel.issue.state?.name ?? null,
    }));
}

function normalizePriority(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

function parseTimestamp(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function normalizeIssue(node: LinearIssueNode): Issue {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title ?? "",
    description: node.description ?? null,
    priority: normalizePriority(node.priority),
    state: node.state?.name ?? "",
    branch_name: node.branchName ?? null,
    url: node.url ?? null,
    labels: (node.labels?.nodes ?? []).map((l) => l.name.toLowerCase()),
    blocked_by: normalizeBlockers(node),
    created_at: parseTimestamp(node.createdAt),
    updated_at: parseTimestamp(node.updatedAt),
  };
}

/**
 * Normalize a minimal issue node (from state-refresh queries).
 */
export function normalizeMinimalIssue(node: {
  id: string;
  identifier: string;
  state?: { name: string } | null;
}): Pick<Issue, "id" | "identifier" | "state"> {
  return {
    id: node.id,
    identifier: node.identifier,
    state: node.state?.name ?? "",
  };
}
