import { describe, expect, it } from "bun:test";
import { invocationCommand, preflightCommand } from "./commands.ts";
import type { LaneTarget, RunnerOptions } from "./types.ts";

function options(
  target: LaneTarget = {
    harness: "codex",
    apiProvider: "openai",
    model: "gpt-5.6-sol",
    effort: "max",
  },
  overrides: Partial<Omit<RunnerOptions, "target">> = {}
): RunnerOptions {
  return {
    parentHarness: "claude",
    target,
    mode: "read-only",
    promptPath: "/tmp/prompt.md",
    cwd: "/tmp/worktree",
    outputPath: "/tmp/output.md",
    receiptPath: "/tmp/receipt.json",
    timeoutMs: null,
    ...overrides,
  };
}

describe("preflightCommand", () => {
  it("uses Codex login for OpenAI and defers custom-provider auth", () => {
    expect(preflightCommand(options().target)).toEqual({
      command: "codex",
      args: ["login", "status"],
      stdin: "none",
    });
    expect(
      preflightCommand({
        harness: "codex",
        apiProvider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        effort: "high",
      })
    ).toEqual({
      command: "codex",
      args: ["--version"],
      stdin: "none",
    });
  });

  it("defers OMP provider authentication to the model invocation", () => {
    expect(
      preflightCommand({
        harness: "omp",
        apiProvider: "openrouter",
        model: "z-ai/glm-5.3-flash",
        effort: "high",
      })
    ).toEqual({
      command: "omp",
      args: ["--version"],
      stdin: "none",
    });
  });
});

describe("invocationCommand", () => {
  it("pins the Codex provider, model, effort, sandbox, cwd, and JSONL output", () => {
    const spec = invocationCommand(options());
    expect(spec.command).toBe("codex");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual([
      "exec",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_provider="openai"',
      "--config",
      'model_reasoning_effort="max"',
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/worktree",
      "--skip-git-repo-check",
      "--ephemeral",
      "--disable",
      "plugins",
      "--disable",
      "multi_agent",
      "--disable",
      "hooks",
      "--disable",
      "memories",
      "--json",
      "-",
    ]);
    expect(spec.args).not.toContain("danger-full-access");
  });

  it("pins an OpenRouter provider and slash-bearing model as separate argv", () => {
    const spec = invocationCommand(
      options({
        harness: "codex",
        apiProvider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
        effort: "high",
      })
    );
    expect(spec.args).toEqual(
      expect.arrayContaining([
        "--model",
        "anthropic/claude-sonnet-4.5",
        "--config",
        'model_provider="openrouter"',
        "--config",
        'model_reasoning_effort="high"',
      ])
    );
    expect(spec.args).not.toContain("--config model_provider=\"openrouter\"");
  });

  it("pins an OMP provider, model, effort, tools, and no-fallback overlay", () => {
    const spec = invocationCommand(
      options(
        {
          harness: "omp",
          apiProvider: "openrouter",
          model: "z-ai/glm-5.3-flash",
          effort: "high",
        },
        { parentHarness: "omp" }
      )
    );
    expect(spec.command).toBe("omp");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual([
      "-p",
      "--mode",
      "json",
      "--model",
      "openrouter/z-ai/glm-5.3-flash",
      "--thinking",
      "high",
      "--cwd",
      "/tmp/worktree",
      "--no-session",
      "--no-title",
      "--no-extensions",
      "--no-skills",
      "--no-prewalk",
      "--no-lsp",
      "--tools",
      "read,grep,glob",
      "--approval-mode",
      "yolo",
      "--config",
      expect.stringContaining("runner/omp-lane.yml"),
    ]);
    expect(spec.args).not.toContain("--no-rules");
  });

  it("pins Claude model, effort, permissions, and no-recursion controls", () => {
    const spec = invocationCommand(
      options({
        harness: "claude",
        apiProvider: "anthropic",
        model: "claude-fable-5",
        effort: "max",
      }, { parentHarness: "codex" })
    );
    expect(spec.command).toBe("claude");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual([
      "-p",
      "--model",
      "claude-fable-5",
      "--effort",
      "max",
      "--permission-mode",
      "plan",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--tools",
      "Read,Grep,Glob,Bash",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--disallowed-tools",
      "Agent,Task,WebSearch,WebFetch,Edit,Write,NotebookEdit",
      "--output-format",
      "json",
    ]);
    expect(spec.args).not.toContain("bypassPermissions");
  });

  it("limits Grok to the assigned cwd and disables recursive agents", () => {
    const spec = invocationCommand(
      options({
        harness: "grok",
        apiProvider: "xai",
        model: "grok-4.6",
        effort: "xhigh",
      })
    );
    expect(spec.command).toBe("grok");
    expect(spec.stdin).toBe("none");
    expect(spec.args).toEqual([
      "--prompt-file",
      "/tmp/prompt.md",
      "--model",
      "grok-4.6",
      "--reasoning-effort",
      "xhigh",
      "--permission-mode",
      "plan",
      "--sandbox",
      "read-only",
      "--tools",
      "read_file,grep,list_dir,run_terminal_cmd",
      "--disallowed-tools",
      "Agent,search_tool,use_tool",
      "--output-format",
      "streaming-messages-json",
      "--cwd",
      "/tmp/worktree",
      "--no-subagents",
      "--disable-web-search",
      "--verbatim",
    ]);
  });

  it("uses bounded write modes without blanket bypasses", () => {
    const codex = invocationCommand(options(undefined, { mode: "isolated-write" }));
    expect(codex.args).toEqual(
      expect.arrayContaining(["--sandbox", "workspace-write"])
    );
    const grok = invocationCommand(
      options({
        harness: "grok",
        apiProvider: "xai",
        model: "grok-4.6",
        effort: "xhigh",
      }, { mode: "isolated-write" })
    );
    expect(grok.args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--sandbox",
        "workspace",
        "--tools",
        "read_file,grep,list_dir,run_terminal_cmd,search_replace",
      ])
    );
    expect(grok.args).not.toContain("--always-approve");

    const claude = invocationCommand(
      options({
        harness: "claude",
        apiProvider: "anthropic",
        model: "claude-fable-5",
        effort: "max",
      }, { mode: "isolated-write" })
    );
    expect(claude.args).toEqual(
      expect.arrayContaining([
        "--permission-mode",
        "acceptEdits",
        "--tools",
        "Read,Write,Edit,Grep,Glob,Bash",
      ])
    );

    const omp = invocationCommand(
      options(
        {
          harness: "omp",
          apiProvider: "openrouter",
          model: "z-ai/glm-5.3-flash",
          effort: "high",
        },
        { mode: "isolated-write", parentHarness: "omp" }
      )
    );
    expect(omp.args).toEqual(
      expect.arrayContaining([
        "--tools",
        "read,write,edit,grep,glob,bash",
        "--approval-mode",
        "yolo",
      ])
    );
  });
});
