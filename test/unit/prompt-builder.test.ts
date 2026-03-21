import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  renderPrompt,
  buildTurnPrompt,
} from "../../src/runner/prompt-builder.js";
import { TemplateRenderError } from "../../src/errors.js";
import type { Issue } from "../../src/types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "id-1",
    identifier: "PRJ-1",
    title: "Fix login bug",
    description: "Users cannot login",
    priority: 1,
    state: "Todo",
    branch_name: "fix/login",
    url: "https://linear.app/issue/PRJ-1",
    labels: ["bug", "auth"],
    blocked_by: [],
    created_at: new Date("2026-03-01"),
    updated_at: null,
    ...overrides,
  };
}

describe("prompt-builder", () => {
  describe("renderPrompt", () => {
    it("renders issue fields in template", () => {
      const template =
        "Work on {{ issue.identifier }}: {{ issue.title }}";
      const result = renderPrompt(template, makeIssue(), null);
      expect(result).toBe("Work on PRJ-1: Fix login bug");
    });

    it("renders attempt variable", () => {
      const template =
        "{% if attempt %}Retry #{{ attempt }}{% endif %}";
      const result = renderPrompt(template, makeIssue(), 3);
      expect(result).toBe("Retry #3");
    });

    it("renders labels array", () => {
      const template =
        "Labels: {% for label in issue.labels %}{{ label }}{% unless forloop.last %}, {% endunless %}{% endfor %}";
      const result = renderPrompt(template, makeIssue(), null);
      expect(result).toBe("Labels: bug, auth");
    });

    it("uses default prompt for empty template", () => {
      const result = renderPrompt("", makeIssue(), null);
      expect(result).toBe("You are working on an issue from Linear.");
    });

    it("fails on unknown variables in strict mode", () => {
      const template = "{{ unknown_var }}";
      expect(() => renderPrompt(template, makeIssue(), null)).toThrow(
        TemplateRenderError,
      );
    });
  });

  describe("buildTurnPrompt", () => {
    it("renders full template for first turn", () => {
      const template = "Work on {{ issue.identifier }}";
      const result = buildTurnPrompt(template, makeIssue(), null, 1);
      expect(result).toBe("Work on PRJ-1");
    });

    it("returns continuation prompt for later turns", () => {
      const template = "Work on {{ issue.identifier }}";
      const result = buildTurnPrompt(template, makeIssue(), null, 2);
      expect(result).toContain("Continue working on PRJ-1");
      expect(result).toContain("turn 2");
    });

    it("composes workflow prompt with SOUL and AGENTS contracts", () => {
      const dir = mkdtempSync(join(tmpdir(), "symphony-prompt-"));
      const soulPath = join(dir, "SOUL.md");
      const agentsPath = join(dir, "AGENTS.md");
      writeFileSync(soulPath, "# Soul\nFollow the role contract.");
      writeFileSync(agentsPath, "# Agents\nCoordinate with spawned agents.");

      const result = buildTurnPrompt(
        "Work on {{ issue.identifier }}",
        makeIssue(),
        null,
        1,
        { soul_path: soulPath, agents_path: agentsPath },
      );

      expect(result).toContain("## Operating Contract");
      expect(result).toContain("Follow the role contract.");
      expect(result).toContain("Coordinate with spawned agents.");
      expect(result).toContain("## Workflow Task Contract");
      expect(result).toContain("Work on PRJ-1");

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
