import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  it("accepts the budgeted Flash route only at max with a shared task id", () => {
    const route = { parentHarness: "opencode2", harness: "codex", apiProvider: "openrouter", model: "z-ai/glm-5.3-flash", effort: "max" };
    expect(parseArgs(argv(route, ["--task-id", "repo:issue-1"]))).toMatchObject({
      parentHarness: "opencode2", taskId: "repo:issue-1", target: { apiProvider: "openrouter", effort: "max" },
    });
    expect(() => parseArgs(argv(route))).toThrow("require --task-id");
    expect(() => parseArgs(argv({ ...route, effort: "high" }, ["--task-id", "issue-1"]))).toThrow("at max");
  });

  it.each([
    ["gpt-6-astra", "high"],
    ["gpt-5.6-terra", "max"],
    ["gpt-5.6-sol", "max"],
  ])("accepts OpenAI %s at %s from every parent harness", (model, effort) => {
    for (const parentHarness of ["claude", "codex", "omp", "opencode2"]) {
      expect(
        parseArgs(argv({
          parentHarness,
          harness: "codex",
          apiProvider: "openai",
          model,
          effort,
        }))
      ).toMatchObject({
        parentHarness,
        target: { harness: "codex", apiProvider: "openai", model, effort },
      });
    }
  });

  it.each([
    ["claude", "anthropic", "claude-fable-5"],
    ["grok", "xai", "grok-4.6"],
    ["omp", "openai", "gpt-6-astra"],
    ["omp", "openrouter", "z-ai/glm-5.3-flash"],
    ["codex", "openrouter", "gpt-6-astra"],
    ["codex", "openai", "claude-opus-5"],
    ["codex", "openai", "anthropic/claude-sonnet-4.5"],
    ["codex", "openai", "gpt-"],
    ["codex", "openai", "gpt-openai/other"],
  ])("rejects external route %s[%s]:%s", (harness, apiProvider, model) => {
    expect(() =>
      parseArgs(argv({ harness, apiProvider, model, effort: "high" }))
    ).toThrow("external lanes require Codex with an OpenAI GPT model or openrouter/z-ai/glm-5.3-flash at max");
  });

  it("rejects a forbidden route through the executable before launching a child or creating artifacts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pstack-cli-policy-"));
    const marker = join(directory, "child-started");
    const prompt = join(directory, "prompt.md");
    const output = join(directory, "output.md");
    const receipt = join(directory, "receipt.json");
    try {
      writeFileSync(prompt, "Return a short answer.");
      writeFileSync(join(directory, "codex"), `#!/bin/sh\ntouch '${marker}'\n`, {
        mode: 0o755,
      });
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          join(import.meta.dir, "pstack-runner"),
          ...argv({
            harness: "codex",
            apiProvider: "openrouter",
            model: "gpt-6-astra",
            effort: "high",
          }),
          "--prompt", prompt,
          "--cwd", directory,
          "--output", output,
          "--receipt", receipt,
        ],
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(64);
      expect(stdout).toBe("");
      expect(stderr).toContain("external lanes require Codex with an OpenAI GPT model");
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(output)).toBe(false);
      expect(existsSync(receipt)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
