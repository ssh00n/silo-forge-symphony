// ── Domain Types ──

export interface BlockerRef {
  id: string | null;
  identifier: string | null;
  state: string | null;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number | null;
  state: string;
  branch_name: string | null;
  url: string | null;
  labels: string[];
  blocked_by: BlockerRef[];
  created_at: Date | null;
  updated_at: Date | null;
}

export interface WorkflowDefinition {
  config: Record<string, unknown>;
  prompt_template: string;
}

// ── Config Types ──

export interface TrackerConfig {
  kind: string;
  endpoint: string;
  api_key: string;
  project_slug: string;
  active_states: string[];
  terminal_states: string[];
}

export interface PollingConfig {
  interval_ms: number;
}

export interface WorkspaceConfig {
  root: string;
}

export interface HooksConfig {
  after_create: string | null;
  before_run: string | null;
  after_run: string | null;
  before_remove: string | null;
  timeout_ms: number;
}

export interface PromptContractConfig {
  soul_path: string | null;
  agents_path: string | null;
}

export interface SharedMemoryConfig {
  enabled: boolean;
  path: string | null;
  branch: string;
  sync_before_dispatch: boolean;
  sync_after_run: boolean;
}

export interface AgentConfig {
  max_concurrent_agents: number;
  max_turns: number;
  max_retry_backoff_ms: number;
  max_concurrent_agents_by_state: Map<string, number>;
}

export interface CodexConfig {
  command: string;
  fallback_command: string | null;
  approval_policy: string;
  thread_sandbox: string;
  turn_sandbox_policy: string;
  turn_timeout_ms: number;
  read_timeout_ms: number;
  stall_timeout_ms: number;
}

export interface ServiceConfig {
  tracker: TrackerConfig;
  polling: PollingConfig;
  workspace: WorkspaceConfig;
  hooks: HooksConfig;
  prompt_contract: PromptContractConfig;
  shared_memory: SharedMemoryConfig;
  agent: AgentConfig;
  codex: CodexConfig;
}

// ── Workspace Types ──

export interface Workspace {
  path: string;
  workspace_key: string;
  created_now: boolean;
}

// ── Session & Run Types ──

export interface LiveSession {
  session_id: string;
  thread_id: string;
  turn_id: string;
  codex_app_server_pid: string | null;
  last_codex_event: string | null;
  last_codex_timestamp: Date | null;
  last_codex_message: string | null;
  codex_input_tokens: number;
  codex_output_tokens: number;
  codex_total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  turn_count: number;
}

export interface RunningEntry {
  worker_handle: unknown;
  identifier: string;
  issue: Issue;
  session_id: string | null;
  codex_app_server_pid: string | null;
  last_codex_message: string | null;
  last_codex_event: string | null;
  last_codex_timestamp: Date | null;
  codex_input_tokens: number;
  codex_output_tokens: number;
  codex_total_tokens: number;
  last_reported_input_tokens: number;
  last_reported_output_tokens: number;
  last_reported_total_tokens: number;
  retry_attempt: number | null;
  started_at: Date;
  turn_count: number;
}

export interface RetryEntry {
  issue_id: string;
  identifier: string;
  attempt: number;
  due_at_ms: number;
  timer_handle: ReturnType<typeof setTimeout>;
  error: string | null;
}

export interface CodexTotals {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  seconds_running: number;
}

export interface OrchestratorState {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  running: Map<string, RunningEntry>;
  claimed: Set<string>;
  retry_attempts: Map<string, RetryEntry>;
  completed: Set<string>;
  codex_totals: CodexTotals;
  codex_rate_limits: Record<string, unknown> | null;
}

// ── Agent Runner Types ──

export interface AgentEvent {
  event: string;
  timestamp: Date;
  codex_app_server_pid?: string;
  usage?: Record<string, number>;
  payload?: Record<string, unknown>;
}

export interface AgentSession {
  thread_id: string;
  turn_id: string;
  pid: string | null;
  stop(): Promise<void>;
  runTurn(prompt: string, issue: Issue, onEvent: (event: AgentEvent) => void): Promise<TurnResult>;
}

export type TurnResult =
  | { status: "completed" }
  | { status: "failed"; error: string }
  | { status: "cancelled"; reason: string }
  | { status: "timeout" }
  | { status: "input_required" };

export interface AgentRunner {
  startSession(workspacePath: string, config: CodexConfig): Promise<AgentSession>;
}

// ── Tracker Interface ──

export interface IssueTracker {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]>;
}

// ── Validation ──

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
