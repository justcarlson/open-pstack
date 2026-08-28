import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseArgs } from "./cli.ts";

interface TargetArgs {
  readonly parentHarness?: string;
  readonly harness: string;
  readonly apiProvider: string;
  readonly model: string;
  readonly effort: string;
}

function argv(
  target: TargetArgs = {
    harness: "codex",
    apiProvider: "openai",
    model: "gpt-5.6-sol",
    effort: "max",
  },
  extra: readonly string[] = []
): string[] {
  return [
    "--parent-harness",
    target.parentHarness ?? "claude",
    "--harness",
    target.harness,
    "--api-provider",
    target.apiProvider,
    "--model",
    target.model,
    "--effort",
    target.effort,
    "--mode",
    "read-only",
    "--prompt",
    join(process.cwd(), "prompt.md"),
    "--cwd",
    process.cwd(),
    "--output",
    join(process.cwd(), "output.md"),
    "--receipt",
    join(process.cwd(), "receipt.json"),
    ...extra,
  ];
}

describe("runner CLI parsing", () => {
  it("constructs a Codex OpenRouter target with a slash-bearing model", () => {
    expect(
      parseArgs(
        argv({
          harness: "codex",
          apiProvider: "openrouter",
          model: "anthropic/claude-sonnet-4.5",
          effort: "high",
        })
      )?.target
    ).toEqual({
      harness: "codex",
      apiProvider: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
      effort: "high",
    });
  });

  it("constructs an OMP parent and GLM execution target", () => {
    const parsed = parseArgs(
      argv({
        parentHarness: "omp",
        harness: "omp",
        apiProvider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        effort: "high",
      })
    );
    expect(parsed).toMatchObject({
      parentHarness: "omp",
      target: {
        harness: "omp",
        apiProvider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        effort: "high",
      },
    });
  });

  it("rejects unsupported fixed-harness providers", () => {
    expect(() =>
      parseArgs(
        argv({
          harness: "claude",
          apiProvider: "openrouter",
          model: "anthropic/claude-sonnet-4.5",
          effort: "high",
        })
      )
    ).toThrow("claude harness requires api-provider anthropic");
  });

  it("rejects provider IDs that cannot be bare Codex config keys", () => {
    expect(() =>
      parseArgs(
        argv({
          harness: "codex",
          apiProvider: "openrouter.example",
          model: "anthropic/claude-sonnet-4.5",
          effort: "high",
        })
      )
    ).toThrow("letters, digits, underscores, and hyphens");
  });

  it("does not invent a timeout", () => {
    expect(parseArgs(argv())?.timeoutMs).toBeNull();
  });

  it("honors an explicit positive timeout", () => {
    expect(parseArgs(argv(undefined, ["--timeout", "5400"]))?.timeoutMs).toBe(
      5_400_000
    );
  });

  it("rejects a non-positive timeout", () => {
    expect(() => parseArgs(argv(undefined, ["--timeout", "0"]))).toThrow(
      "greater than zero"
    );
  });
});
