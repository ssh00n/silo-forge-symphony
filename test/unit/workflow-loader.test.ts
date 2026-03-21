import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { loadWorkflow, parseWorkflowContent } from "../../src/config/workflow-loader.js";
import {
  MissingWorkflowFile,
  WorkflowParseError,
  WorkflowFrontMatterNotAMap,
} from "../../src/errors.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

describe("workflow-loader", () => {
  describe("loadWorkflow", () => {
    it("loads a basic workflow with front matter and prompt", () => {
      const wf = loadWorkflow(join(FIXTURES, "workflow-basic.md"));
      expect(wf.config).toBeDefined();
      expect((wf.config.tracker as Record<string, unknown>).kind).toBe(
        "linear",
      );
      expect(wf.prompt_template).toContain("{{ issue.identifier }}");
    });

    it("loads a workflow without front matter", () => {
      const wf = loadWorkflow(join(FIXTURES, "workflow-no-frontmatter.md"));
      expect(wf.config).toEqual({});
      expect(wf.prompt_template).toContain("{{ issue.identifier }}");
    });

    it("loads workflow with empty body", () => {
      const wf = loadWorkflow(join(FIXTURES, "workflow-empty-body.md"));
      expect((wf.config.tracker as Record<string, unknown>).kind).toBe(
        "linear",
      );
      expect(wf.prompt_template).toBe("");
    });

    it("throws MissingWorkflowFile for nonexistent path", () => {
      expect(() => loadWorkflow("/nonexistent/WORKFLOW.md")).toThrow(
        MissingWorkflowFile,
      );
    });
  });

  describe("parseWorkflowContent", () => {
    it("parses front matter with closing delimiter", () => {
      const raw = `---
key: value
---
Hello {{ issue.title }}`;
      const wf = parseWorkflowContent(raw);
      expect(wf.config).toEqual({ key: "value" });
      expect(wf.prompt_template).toBe("Hello {{ issue.title }}");
    });

    it("treats entire content as prompt when no front matter", () => {
      const raw = "Just a prompt\nwith multiple lines";
      const wf = parseWorkflowContent(raw);
      expect(wf.config).toEqual({});
      expect(wf.prompt_template).toBe(raw);
    });

    it("throws on unclosed front matter", () => {
      const raw = `---
key: value
No closing delimiter`;
      expect(() => parseWorkflowContent(raw)).toThrow(WorkflowParseError);
    });

    it("throws on non-map front matter (array)", () => {
      const raw = `---
- item1
- item2
---
prompt`;
      expect(() => parseWorkflowContent(raw)).toThrow(
        WorkflowFrontMatterNotAMap,
      );
    });

    it("handles empty front matter as empty config", () => {
      const raw = `---
---
prompt body`;
      const wf = parseWorkflowContent(raw);
      expect(wf.config).toEqual({});
      expect(wf.prompt_template).toBe("prompt body");
    });

    it("trims prompt body", () => {
      const raw = `---
key: val
---

  prompt with whitespace

`;
      const wf = parseWorkflowContent(raw);
      expect(wf.prompt_template).toBe("prompt with whitespace");
    });
  });
});
