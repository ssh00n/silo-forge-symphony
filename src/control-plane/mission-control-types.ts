import type { BlockerRef } from "../types.js";

export interface MissionControlDispatchIssue {
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
  created_at: string | null;
  updated_at: string | null;
}

export interface MissionControlDispatchRequest {
  execution_run_id: string;
  silo_slug: string;
  role_slug: string;
  workspace_root: string;
  callback_url: string;
  issue: MissionControlDispatchIssue;
  prompt_override: string | null;
  adapter_mode: string;
}

export interface MissionControlDispatchAcceptance {
  accepted: boolean;
  adapter_mode: "http";
  external_run_id: string;
  workspace_path: string;
  branch_name: string;
  summary: string;
}

export interface MissionControlCallbackPayload {
  status: "running" | "succeeded" | "failed" | "cancelled";
  external_run_id?: string;
  workspace_path?: string;
  branch_name?: string;
  pr_url?: string;
  summary?: string;
  error_message?: string;
  result_payload?: Record<string, unknown>;
  issue_identifier?: string;
  completion_kind?: string;
  duration_ms?: number;
}

export interface MissionControlRunBinding {
  execution_run_id: string;
  callback_url: string;
  external_run_id: string;
  workspace_path: string;
  branch_name: string;
}
