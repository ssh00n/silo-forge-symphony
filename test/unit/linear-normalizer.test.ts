import { describe, it, expect } from "vitest";
import { normalizeIssue } from "../../src/tracker/linear/linear-normalizer.js";

describe("linear-normalizer", () => {
  it("normalizes a full issue node", () => {
    const issue = normalizeIssue({
      id: "abc",
      identifier: "PRJ-1",
      title: "Fix bug",
      description: "A bug description",
      priority: 2,
      branchName: "fix/bug",
      url: "https://linear.app/issue/PRJ-1",
      createdAt: "2026-03-01T10:00:00Z",
      updatedAt: "2026-03-02T10:00:00Z",
      state: { name: "Todo" },
      labels: { nodes: [{ name: "Bug" }, { name: "URGENT" }] },
      inverseRelations: { nodes: [] },
    });

    expect(issue.id).toBe("abc");
    expect(issue.identifier).toBe("PRJ-1");
    expect(issue.title).toBe("Fix bug");
    expect(issue.priority).toBe(2);
    expect(issue.state).toBe("Todo");
    expect(issue.labels).toEqual(["bug", "urgent"]); // lowercase
    expect(issue.blocked_by).toEqual([]);
    expect(issue.created_at).toBeInstanceOf(Date);
  });

  it("normalizes blockers from inverse relations", () => {
    const issue = normalizeIssue({
      id: "abc",
      identifier: "PRJ-1",
      state: { name: "Todo" },
      inverseRelations: {
        nodes: [
          {
            type: "blocks",
            issue: {
              id: "def",
              identifier: "PRJ-2",
              state: { name: "In Progress" },
            },
          },
          {
            type: "related",
            issue: {
              id: "ghi",
              identifier: "PRJ-3",
              state: { name: "Todo" },
            },
          },
        ],
      },
    });

    expect(issue.blocked_by).toHaveLength(1);
    expect(issue.blocked_by[0]!.identifier).toBe("PRJ-2");
    expect(issue.blocked_by[0]!.state).toBe("In Progress");
  });

  it("handles null/missing optional fields", () => {
    const issue = normalizeIssue({
      id: "abc",
      identifier: "PRJ-1",
    });

    expect(issue.title).toBe("");
    expect(issue.description).toBeNull();
    expect(issue.priority).toBeNull();
    expect(issue.state).toBe("");
    expect(issue.branch_name).toBeNull();
    expect(issue.labels).toEqual([]);
    expect(issue.blocked_by).toEqual([]);
    expect(issue.created_at).toBeNull();
  });

  it("normalizes non-integer priority to null", () => {
    const issue = normalizeIssue({
      id: "abc",
      identifier: "PRJ-1",
      priority: 1.5 as unknown as number,
    });
    expect(issue.priority).toBeNull();
  });
});
