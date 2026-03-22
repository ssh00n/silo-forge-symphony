import type {
  ExecutionCallbackPayload,
  ExecutionCallbackPayloadStatus,
  ExecutionDispatchAcceptance,
  ExecutionDispatchAcceptanceAdapterMode,
  ExecutionDispatchRequest,
} from "../contracts/generated/schemas.js";

export type MissionControlCallbackStatus = ExecutionCallbackPayloadStatus;
export type MissionControlDispatchAdapterMode = ExecutionDispatchAcceptanceAdapterMode;
export type MissionControlDispatchRequest = ExecutionDispatchRequest;
export type MissionControlDispatchAcceptance = ExecutionDispatchAcceptance;
export type MissionControlCallbackPayload = ExecutionCallbackPayload;

export interface MissionControlRunBinding {
  execution_run_id: string;
  callback_url: string;
  external_run_id: string;
  workspace_path: string;
  branch_name: string;
}
