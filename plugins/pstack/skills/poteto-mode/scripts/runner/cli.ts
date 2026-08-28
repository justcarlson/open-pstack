import { parseArgs as parseNodeArgs } from "node:util";
import { resolvedOptions, runLane } from "./run.ts";
import {
  ACCESS_MODES,
  EFFORTS,
  EXECUTION_HARNESSES,
  PARENT_HARNESSES,
  type AccessMode,
  type Effort,
  type ExecutionHarness,
  type LaneTarget,
  type ParentHarness,
  type RunnerOptions,
  UsageError,
} from "./types.ts";

const HELP = `Usage: pstack-runner --parent-harness <claude|codex|omp> \\
  --harness <claude|codex|grok|omp> --api-provider <id> --model <slug> \\
  --effort <level> --mode <read-only|isolated-write> --prompt <file> \\
  --cwd <dir> --output <file> --receipt <file> [--timeout <seconds>]

Runs exactly one external model lane. The parent resolves native versus external
dispatch before invoking this runner. Output and receipt paths must not already
exist. There is no implicit timeout. Pass --timeout only when the user or task
supplies a real deadline; it is one end-to-end launcher deadline shared by
setup, preflight, and model execution.
`;

interface Io {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: Io = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  choices: readonly T[]
): T {
  if (value === undefined || !choices.includes(value as T)) {
    throw new UsageError(`${name} must be one of: ${choices.join(", ")}`);
  }
  return value as T;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new UsageError(`${name} is required`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function apiProvider(value: string | undefined): string {
  const provider = required("api-provider", value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(provider)) {
    throw new UsageError(
      "api-provider must contain only letters, digits, underscores, and hyphens"
    );
  }
  return provider;
}

function laneTarget(
  harness: ExecutionHarness,
  provider: string,
  model: string,
  effort: Effort
): LaneTarget {
  switch (harness) {
    case "claude":
      if (provider !== "anthropic") {
        throw new UsageError("claude harness requires api-provider anthropic");
      }
      return { harness, apiProvider: provider, model, effort };
    case "codex":
      return { harness, apiProvider: provider, model, effort };
    case "omp":
      return { harness, apiProvider: provider, model, effort };
    case "grok":
      if (provider !== "xai") {
        throw new UsageError("grok harness requires api-provider xai");
      }
      return { harness, apiProvider: provider, model, effort };
  }
}

export function parseArgs(argv: readonly string[]): RunnerOptions | null {
  let parsed: ReturnType<typeof parseNodeArgs>;
  try {
    parsed = parseNodeArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        "parent-harness": { type: "string" },
        harness: { type: "string" },
        "api-provider": { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        mode: { type: "string" },
        prompt: { type: "string" },
        cwd: { type: "string" },
        output: { type: "string" },
        receipt: { type: "string" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (parsed.values.help) return null;
  const mode = oneOf(
    "mode",
    stringValue(parsed.values.mode),
    ACCESS_MODES
  ) as AccessMode;
  const timeoutValue = stringValue(parsed.values.timeout);
  const timeoutSeconds = timeoutValue === undefined ? null : Number(timeoutValue);
  if (
    timeoutSeconds !== null &&
    (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
  ) {
    throw new UsageError("timeout must be a number greater than zero");
  }
  const harness = oneOf(
    "harness",
    stringValue(parsed.values.harness),
    EXECUTION_HARNESSES
  ) as ExecutionHarness;
  const target = laneTarget(
    harness,
    apiProvider(stringValue(parsed.values["api-provider"])),
    required("model", stringValue(parsed.values.model)),
    oneOf("effort", stringValue(parsed.values.effort), EFFORTS) as Effort
  );
  return resolvedOptions({
    parentHarness: oneOf(
      "parent-harness",
      stringValue(parsed.values["parent-harness"]),
      PARENT_HARNESSES
    ) as ParentHarness,
    target,
    mode,
    promptPath: required("prompt", stringValue(parsed.values.prompt)),
    cwd: required("cwd", stringValue(parsed.values.cwd)),
    outputPath: required("output", stringValue(parsed.values.output)),
    receiptPath: required("receipt", stringValue(parsed.values.receipt)),
    timeoutMs: timeoutSeconds === null ? null : timeoutSeconds * 1_000,
  });
}

export async function main(
  argv: readonly string[],
  startedAt: number = Date.now(),
  io: Io = defaultIo
): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (options === null) {
      io.stdout(HELP);
      return 0;
    }
    const result = await runLane(options, startedAt);
    const rendered = `${JSON.stringify(result.receipt)}\n`;
    if (result.exitCode === 0) io.stdout(rendered);
    else io.stderr(rendered);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    io.stderr(HELP);
    return 64;
  }
}
