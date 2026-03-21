import { describe, it, expect } from "vitest";
import {
  sanitizeIdentifier,
  validatePathContainment,
  validateWorkspaceCwd,
} from "../../src/workspace/workspace-safety.js";
import { WorkspaceSafetyError } from "../../src/errors.js";

describe("workspace-safety", () => {
  describe("sanitizeIdentifier", () => {
    it("passes through safe identifiers", () => {
      expect(sanitizeIdentifier("PRJ-123")).toBe("PRJ-123");
      expect(sanitizeIdentifier("abc.def")).toBe("abc.def");
      expect(sanitizeIdentifier("test_name")).toBe("test_name");
    });

    it("replaces unsafe characters with underscore", () => {
      expect(sanitizeIdentifier("ABC/123")).toBe("ABC_123");
      expect(sanitizeIdentifier("hello world")).toBe("hello_world");
      expect(sanitizeIdentifier("a@b#c")).toBe("a_b_c");
    });
  });

  describe("validatePathContainment", () => {
    it("allows paths inside root", () => {
      expect(() =>
        validatePathContainment("/ws/root/PRJ-1", "/ws/root"),
      ).not.toThrow();
    });

    it("rejects path equal to root", () => {
      expect(() =>
        validatePathContainment("/ws/root", "/ws/root"),
      ).toThrow(WorkspaceSafetyError);
    });

    it("rejects path outside root", () => {
      expect(() =>
        validatePathContainment("/other/path", "/ws/root"),
      ).toThrow(WorkspaceSafetyError);
    });

    it("rejects path traversal", () => {
      expect(() =>
        validatePathContainment("/ws/root/../etc/passwd", "/ws/root"),
      ).toThrow(WorkspaceSafetyError);
    });
  });

  describe("validateWorkspaceCwd", () => {
    it("passes when cwd matches workspace path", () => {
      expect(() =>
        validateWorkspaceCwd("/ws/root/PRJ-1", "/ws/root/PRJ-1"),
      ).not.toThrow();
    });

    it("fails when cwd does not match", () => {
      expect(() =>
        validateWorkspaceCwd("/other/path", "/ws/root/PRJ-1"),
      ).toThrow(WorkspaceSafetyError);
    });
  });
});
