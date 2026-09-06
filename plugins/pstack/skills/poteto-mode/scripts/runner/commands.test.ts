import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { invocationCommand, preflightCommand } from "./commands.ts";
import { openScopedGateway } from "./gateway.ts";
import { childEnvironment } from "./run.ts";
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
    taskId: null,
    ...overrides,
  };
}

describe("preflightCommand", () => {
  it("uses Codex login for OpenAI and defers custom-provider auth", () => {
    expect(preflightCommand(options().target)).toEqual({
      command: "codex",
      args: ["login", "status", "--config", 'forced_login_method="chatgpt"'],
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
      "--ignore-user-config",
      "--config",
      'web_search="disabled"',
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_provider="openai"',
      "--config",
      'forced_login_method="chatgpt"',
      "--config",
      'service_tier="default"',
      "--config",
      'model_reasoning_effort="max"',
      "--sandbox",
      "read-only",
      "--cd",
      "/tmp/worktree",
      "--skip-git-repo-check",
      "--ephemeral",
      "--disable",
      "apps",
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
        model: "z-ai/glm-5.3-flash",
        effort: "max",
      }),
      { baseUrl: "http://127.0.0.1:12345/v1", token: "scoped-test-token", protectedPaths: ["/tmp/credentials", "/proc"] }
    );
    expect(spec.args).toEqual(
      expect.arrayContaining([
        "--model",
        "z-ai/glm-5.3-flash",
        "--config",
        'model_provider="pstack_openrouter"',
        "--config",
        'model_reasoning_effort="max"',
      ])
    );
    expect(spec.args).not.toContain("--config model_provider=\"openrouter\"");
    expect(spec.args.join(" ")).not.toContain("scoped-test-token");
    expect(spec.args).not.toContain("--sandbox");
    expect(spec.args).toContain('approval_policy="never"');
    expect(spec.args).toContain('model_providers.pstack_openrouter.env_key="PSTACK_GATEWAY_TOKEN"');
    expect(spec.args).toContain('model_providers.pstack_openrouter.base_url="http://127.0.0.1:12345/v1"');
  });

  it.skipIf(process.platform !== "linux" || Bun.which("codex") === null)("denies paid tools credential and ledger access in the real sandbox", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "pstack-paid-access-"));
    const workspace = join(scratch, "workspace");
    const credentialDirectory = join(scratch, "credentials");
    const ledgerDirectory = join(scratch, "ledger");
    const credential = join(credentialDirectory, "auth.json");
    const ledger = join(ledgerDirectory, "budget.sqlite3");
    mkdirSync(workspace);
    mkdirSync(credentialDirectory);
    mkdirSync(ledgerDirectory);
    writeFileSync(credential, "fake credential sentinel");
    const dataHome = join(scratch, "data");
    const openCodeAuth = join(dataHome, "opencode", "auth.json");
    mkdirSync(join(dataHome, "opencode"), {recursive: true});
    writeFileSync(openCodeAuth, "fake OpenCode credential sentinel");
    const gateway = await openScopedGateway({taskId: "test", laneId: "test", ledgerPath: ledger, env: {OPENROUTER_API_KEY: "fake", CODEX_HOME: credentialDirectory, XDG_DATA_HOME: dataHome}});
    await gateway.close();
    const ledgerBefore = readFileSync(ledger);
    try {
      const spec = invocationCommand(options({harness: "codex", apiProvider: "openrouter", model: "z-ai/glm-5.3-flash", effort: "max"}, {cwd: workspace, mode: "isolated-write"}), gateway.binding);
      const policy = spec.args.find((arg) => arg.startsWith("permissions.pstack_paid="));
      expect(policy).toBeDefined();
      const child = Bun.spawn(["codex", "sandbox", "-C", workspace, "-c", policy!, "-P", "pstack_paid", "--", "/bin/sh", "-c",
        'test ! -r "$1" && test ! -r "$2" && test ! -e "/proc/$3/environ" && test ! -r "$4" && test -z "$OTHER_API_KEY$PRIVATE_VALUE" && printf verified > proof.txt',
        "paid-boundary", credential, ledger, String(process.pid), openCodeAuth], {stdout: "pipe", stderr: "pipe", env: childEnvironment({...process.env, OTHER_API_KEY: "fake-secret", PRIVATE_VALUE: "fake-private"}, {harness: "codex", apiProvider: "openrouter", model: "z-ai/glm-5.3-flash", effort: "max"}, gateway.binding)});
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(readFileSync(join(workspace, "proof.txt"), "utf8")).toBe("verified");
      expect(readFileSync(ledger)).toEqual(ledgerBefore);
    } finally { rmSync(scratch, {recursive: true, force: true}); }
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
