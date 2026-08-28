export const PARENT_HARNESSES = ["claude", "codex", "omp"] as const;
export const EXECUTION_HARNESSES = ["claude", "codex", "grok", "omp"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const ACCESS_MODES = ["read-only", "isolated-write"] as const;

export type ParentHarness = (typeof PARENT_HARNESSES)[number];
export type ExecutionHarness = (typeof EXECUTION_HARNESSES)[number];
export type Effort = (typeof EFFORTS)[number];
export type AccessMode = (typeof ACCESS_MODES)[number];

export type LaneTarget =
  | {
      readonly harness: "claude";
      readonly apiProvider: "anthropic";
      readonly model: string;
      readonly effort: Effort;
    }
  | {
      readonly harness: "codex";
      readonly apiProvider: string;
      readonly model: string;
      readonly effort: Effort;
    }
  | {
      readonly harness: "omp";
      readonly apiProvider: string;
      readonly model: string;
      readonly effort: Effort;
    }
  | {
      readonly harness: "grok";
      readonly apiProvider: "xai";
      readonly model: string;
      readonly effort: Effort;
    };

export interface RunnerOptions {
  readonly parentHarness: ParentHarness;
  readonly target: LaneTarget;
  readonly mode: AccessMode;
  readonly promptPath: string;
  readonly cwd: string;
  readonly outputPath: string;
  readonly receiptPath: string;
  readonly timeoutMs: number | null;
}

export type ReceiptStatus =
  | "complete"
  | "cancelled"
  | "unavailable-cli"
  | "unauthenticated"
  | "unavailable-model"
  | "timed-out"
  | "child-failed"
  | "malformed-output";

export interface NormalizedUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface ParsedOutput {
  readonly text: string;
  readonly reportedApiProvider: string | null;
  readonly reportedModel: string | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
}

export interface RunnerReceipt {
  readonly schemaVersion: 3;
  readonly status: ReceiptStatus;
  readonly parentHarness: ParentHarness;
  readonly target: LaneTarget;
  readonly mode: AccessMode;
  readonly cwd: string;
  readonly promptPath: string;
  readonly outputPath: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly elapsedMs: number;
  readonly executable: string | null;
  readonly preflight: {
    readonly argv: readonly string[];
    readonly status: "passed" | "failed" | "timed-out" | "cancelled" | "not-run";
    readonly evidence: string;
  };
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly reportedApiProvider: string | null;
  readonly reportedModel: string | null;
  readonly modelVerified: boolean;
  readonly modelEvidence: "provider-report" | "pinned-argv" | null;
  readonly apiProviderEvidence:
    | "adapter-fixed"
    | "pinned-argv"
    | "provider-report"
    | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
  readonly error: {
    readonly message: string;
    readonly evidence: string;
  } | null;
}

export class UsageError extends Error {}
