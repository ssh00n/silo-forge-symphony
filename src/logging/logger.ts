export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  issue_id?: string;
  issue_identifier?: string;
  session_id?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatContext(ctx: LogContext): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined && v !== null) {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

function emit(level: LogLevel, message: string, ctx: LogContext = {}): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const prefix = level.toUpperCase().padEnd(5);
  const contextStr = formatContext(ctx);
  const line = `${ts} ${prefix}${contextStr} ${message}`;
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stderr.write(line + "\n");
  }
}

export const log = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
};
