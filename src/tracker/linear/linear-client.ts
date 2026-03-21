import type { Issue, IssueTracker, TrackerConfig } from "../../types.js";
import {
  LinearApiRequestError,
  LinearApiStatusError,
  LinearGraphQLError,
  LinearUnknownPayload,
  LinearMissingEndCursor,
} from "../../errors.js";
import {
  CANDIDATE_ISSUES_QUERY,
  ISSUES_BY_STATES_QUERY,
  ISSUE_STATES_BY_IDS_QUERY,
} from "./linear-queries.js";
import { normalizeIssue } from "./linear-normalizer.js";
import { log } from "../../logging/logger.js";

const NETWORK_TIMEOUT_MS = 30000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GqlData = any;

export class LinearClient implements IssueTracker {
  constructor(private getConfig: () => TrackerConfig) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    const config = this.getConfig();
    const all: Issue[] = [];
    let cursor: string | null = null;

    while (true) {
      const variables: Record<string, unknown> = {
        projectSlug: config.project_slug,
        stateNames: config.active_states,
      };
      if (cursor) variables.after = cursor;

      const data: GqlData = await this.executeQuery(
        CANDIDATE_ISSUES_QUERY,
        variables,
      );
      const issues = data?.issues;
      if (!issues?.nodes) {
        throw new LinearUnknownPayload(
          "Missing issues.nodes in candidate response",
        );
      }

      for (const node of issues.nodes) {
        all.push(normalizeIssue(node));
      }

      if (!issues.pageInfo?.hasNextPage) break;
      if (!issues.pageInfo.endCursor) {
        throw new LinearMissingEndCursor();
      }
      cursor = issues.pageInfo.endCursor;
    }

    log.debug(`Fetched ${all.length} candidate issues from Linear`);
    return all;
  }

  async fetchIssuesByStates(stateNames: string[]): Promise<Issue[]> {
    if (stateNames.length === 0) return [];

    const config = this.getConfig();
    const all: Issue[] = [];
    let cursor: string | null = null;

    while (true) {
      const variables: Record<string, unknown> = {
        projectSlug: config.project_slug,
        stateNames,
      };
      if (cursor) variables.after = cursor;

      const data: GqlData = await this.executeQuery(
        ISSUES_BY_STATES_QUERY,
        variables,
      );
      const issues = data?.issues;
      if (!issues?.nodes) {
        throw new LinearUnknownPayload(
          "Missing issues.nodes in by-states response",
        );
      }

      for (const node of issues.nodes) {
        all.push(normalizeIssue(node));
      }

      if (!issues.pageInfo?.hasNextPage) break;
      if (!issues.pageInfo.endCursor) {
        throw new LinearMissingEndCursor();
      }
      cursor = issues.pageInfo.endCursor;
    }

    return all;
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]> {
    if (issueIds.length === 0) return [];

    const data: GqlData = await this.executeQuery(ISSUE_STATES_BY_IDS_QUERY, {
      issueIds,
    });

    const issues = data?.issues;
    if (!issues?.nodes || !Array.isArray(issues.nodes)) {
      throw new LinearUnknownPayload(
        "Missing issues.nodes in state-by-ids response",
      );
    }

    return issues.nodes
      .filter(
        (n: GqlData) =>
          n !== null && typeof n === "object" && "id" in n,
      )
      .map((n: GqlData) => normalizeIssue(n));
  }

  private async executeQuery(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const config = this.getConfig();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: config.api_key,
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LinearApiRequestError(
        `Linear API request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "(unreadable)");
      throw new LinearApiStatusError(resp.status, body);
    }

    let json: Record<string, unknown>;
    try {
      json = (await resp.json()) as Record<string, unknown>;
    } catch {
      throw new LinearUnknownPayload(
        "Failed to parse Linear API response as JSON",
      );
    }

    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      throw new LinearGraphQLError(json.errors);
    }

    return (json.data ?? json) as Record<string, unknown>;
  }
}
