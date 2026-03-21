export class SymphonyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SymphonyError";
  }
}

export class MissingWorkflowFile extends SymphonyError {
  constructor(path: string) {
    super("missing_workflow_file", `Workflow file not found: ${path}`);
  }
}

export class WorkflowParseError extends SymphonyError {
  constructor(message: string, cause?: unknown) {
    super("workflow_parse_error", message, cause);
  }
}

export class WorkflowFrontMatterNotAMap extends SymphonyError {
  constructor() {
    super(
      "workflow_front_matter_not_a_map",
      "YAML front matter must be a map/object",
    );
  }
}

export class TemplateParseError extends SymphonyError {
  constructor(message: string, cause?: unknown) {
    super("template_parse_error", message, cause);
  }
}

export class TemplateRenderError extends SymphonyError {
  constructor(message: string, cause?: unknown) {
    super("template_render_error", message, cause);
  }
}

export class LinearApiRequestError extends SymphonyError {
  constructor(message: string, cause?: unknown) {
    super("linear_api_request", message, cause);
  }
}

export class LinearApiStatusError extends SymphonyError {
  constructor(
    public readonly statusCode: number,
    body: string,
  ) {
    super("linear_api_status", `Linear API returned ${statusCode}: ${body}`);
  }
}

export class LinearGraphQLError extends SymphonyError {
  constructor(
    public readonly errors: unknown[],
  ) {
    super(
      "linear_graphql_errors",
      `Linear GraphQL errors: ${JSON.stringify(errors)}`,
    );
  }
}

export class LinearUnknownPayload extends SymphonyError {
  constructor(message: string) {
    super("linear_unknown_payload", message);
  }
}

export class LinearMissingEndCursor extends SymphonyError {
  constructor() {
    super(
      "linear_missing_end_cursor",
      "Linear pagination: hasNextPage=true but endCursor is missing",
    );
  }
}

export class UnsupportedTrackerKind extends SymphonyError {
  constructor(kind: string) {
    super("unsupported_tracker_kind", `Unsupported tracker kind: ${kind}`);
  }
}

export class MissingTrackerApiKey extends SymphonyError {
  constructor() {
    super("missing_tracker_api_key", "Tracker API key is missing or empty");
  }
}

export class MissingTrackerProjectSlug extends SymphonyError {
  constructor() {
    super(
      "missing_tracker_project_slug",
      "Tracker project_slug is required for Linear",
    );
  }
}

export class WorkspaceSafetyError extends SymphonyError {
  constructor(message: string) {
    super("workspace_safety", message);
  }
}

export class AgentRunnerError extends SymphonyError {
  constructor(code: string, message: string, cause?: unknown) {
    super(code, message, cause);
  }
}
