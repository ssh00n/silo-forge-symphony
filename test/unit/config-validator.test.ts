import { describe, it, expect } from "vitest";
import { validateDispatchConfig } from "../../src/config/config-validator.js";
import { buildServiceConfig } from "../../src/config/config-layer.js";

function makeValidConfig() {
  return buildServiceConfig({
    tracker: {
      kind: "linear",
      api_key: "lin_test_key",
      project_slug: "my-project",
    },
    codex: { command: "codex app-server" },
  });
}

describe("config-validator", () => {
  it("passes for valid config", () => {
    const result = validateDispatchConfig(makeValidConfig());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when tracker.kind is missing", () => {
    const config = buildServiceConfig({
      tracker: { api_key: "key", project_slug: "slug" },
      codex: { command: "cmd" },
    });
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("tracker.kind"))).toBe(true);
  });

  it("fails when tracker.kind is unsupported", () => {
    const config = buildServiceConfig({
      tracker: { kind: "jira", api_key: "key", project_slug: "slug" },
      codex: { command: "cmd" },
    });
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("not supported"))).toBe(true);
  });

  it("fails when api_key is missing", () => {
    const config = buildServiceConfig({
      tracker: { kind: "linear", project_slug: "slug" },
      codex: { command: "cmd" },
    });
    delete process.env.LINEAR_API_KEY;
    config.tracker.api_key = "";
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("api_key"))).toBe(true);
  });

  it("fails when project_slug is missing for linear", () => {
    const config = buildServiceConfig({
      tracker: { kind: "linear", api_key: "key" },
      codex: { command: "cmd" },
    });
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("project_slug"))).toBe(true);
  });

  it("fails when codex.command is empty", () => {
    const config = buildServiceConfig({
      tracker: { kind: "linear", api_key: "key", project_slug: "slug" },
      codex: { command: "" },
    });
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("codex.command"))).toBe(true);
  });

  it("collects multiple errors", () => {
    const config = buildServiceConfig({});
    config.tracker.api_key = "";
    const result = validateDispatchConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
