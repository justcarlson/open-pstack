import { join } from "node:path";
import type { GatewayBinding } from "./gateway.ts";
import { UsageError } from "./types.ts";
import type {
  AccessMode,
  Effort,
  LaneTarget,
  RunnerOptions,
} from "./types.ts";

const OMP_LANE_CONFIG = join(import.meta.dir, "omp-lane.yml");

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: "prompt" | "none";
}

export function preflightCommand(target: LaneTarget): CommandSpec {
  switch (target.harness) {
    case "claude":
      return {
        command: "claude",
        args: ["auth", "status", "--json"],
        stdin: "none",
      };
    case "codex":
      return target.apiProvider === "openai"
        ? {
            command: "codex",
            args: ["login", "status", "--config", 'forced_login_method="chatgpt"'],
            stdin: "none",
          }
        : {
            command: "codex",
            args: ["--version"],
            stdin: "none",
          };
    case "omp":
      return { command: "omp", args: ["--version"], stdin: "none" };
    case "grok":
      return { command: "grok", args: ["models"], stdin: "none" };
  }
}

function claudeDeniedTools(mode: AccessMode): string {
  const always = ["Agent", "Task", "WebSearch", "WebFetch"];
  const readonly = ["Edit", "Write", "NotebookEdit"];
  return [...always, ...(mode === "read-only" ? readonly : [])].join(",");
}

function claudeTools(mode: AccessMode): string {
  return mode === "read-only"
    ? "Read,Grep,Glob,Bash"
    : "Read,Write,Edit,Grep,Glob,Bash";
}

function codexSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace-write";
}

function grokSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace";
}

function grokTools(mode: AccessMode): string {
  const readonly = ["read_file", "grep", "list_dir", "run_terminal_cmd"];
  return [...readonly, ...(mode === "isolated-write" ? ["search_replace"] : [])].join(",");
}

function ompTools(mode: AccessMode): string {
  return mode === "read-only"
    ? "read,grep,glob"
    : "read,write,edit,grep,glob,bash";
}

function permissionMode(mode: AccessMode): string {
  return mode === "read-only" ? "plan" : "acceptEdits";
}

function effortOverride(effort: Effort): string {
  return `model_reasoning_effort=${JSON.stringify(effort)}`;
}

function codexAccess(options: RunnerOptions, gateway: GatewayBinding | null): string[] {
  if (gateway === null) return ["--sandbox", codexSandbox(options.mode)];
  const base = options.mode === "read-only" ? ":read-only" : ":workspace";
  const denied = gateway.protectedPaths.map((path) => `${JSON.stringify(path)}="deny"`).join(",");
  return [
    "--config", 'approval_policy="never"',
    "--config", 'default_permissions="pstack_paid"',
    "--config", `permissions.pstack_paid={extends=${JSON.stringify(base)},filesystem={${denied}},network={enabled=false}}`,
  ];
}

export function invocationCommand(
  options: RunnerOptions,
  gateway: GatewayBinding | null = null
): CommandSpec {
  const target = options.target;
  if (target.harness === "codex" && target.apiProvider === "openrouter" && gateway === null) {
    throw new UsageError("OpenRouter execution requires the budget gateway");
  }
  switch (target.harness) {
    case "claude":
      return {
        command: "claude",
        args: [
          "-p",
          "--model",
          target.model,
          "--effort",
          target.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--setting-sources",
          "project",
          "--strict-mcp-config",
          "--tools",
          claudeTools(options.mode),
          "--no-session-persistence",
          "--disable-slash-commands",
          "--disallowed-tools",
          claudeDeniedTools(options.mode),
          "--output-format",
          "json",
        ],
        stdin: "prompt",
      };
    case "codex":
      return {
        command: "codex",
        args: [
          "exec",
          "--ignore-user-config",
          "--config",
          'web_search="disabled"',
          "--model",
          target.model,
          "--config",
          `model_provider=${JSON.stringify(gateway === null ? target.apiProvider : "pstack_openrouter")}`,
          ...(gateway === null
            ? target.apiProvider === "openai"
              ? ["--config", 'forced_login_method="chatgpt"']
              : []
            : [
                "--config", 'model_providers.pstack_openrouter.name="Pstack OpenRouter"',
                "--config", `model_providers.pstack_openrouter.base_url=${JSON.stringify(gateway.baseUrl)}`,
                "--config", 'model_providers.pstack_openrouter.env_key="PSTACK_GATEWAY_TOKEN"',
                "--config", 'model_providers.pstack_openrouter.wire_api="responses"',
                "--config", "model_providers.pstack_openrouter.requires_openai_auth=false",
                "--config", "model_providers.pstack_openrouter.supports_websockets=false",
                "--config", "model_providers.pstack_openrouter.request_max_retries=1",
                "--config", "model_providers.pstack_openrouter.stream_max_retries=0",
              ]),
          "--config",
          'service_tier="default"',
          "--config",
          effortOverride(target.effort),
          ...codexAccess(options, gateway),
          "--cd",
          options.cwd,
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
        ],
        stdin: "prompt",
      };
    case "omp":
      return {
        command: "omp",
        args: [
          "-p",
          "--mode",
          "json",
          "--model",
          `${target.apiProvider}/${target.model}`,
          "--thinking",
          target.effort,
          "--cwd",
          options.cwd,
          "--no-session",
          "--no-title",
          "--no-extensions",
          "--no-skills",
          "--no-prewalk",
          "--no-lsp",
          "--tools",
          ompTools(options.mode),
          "--approval-mode",
          "yolo",
          "--config",
          OMP_LANE_CONFIG,
        ],
        stdin: "prompt",
      };
    case "grok":
      return {
        command: "grok",
        args: [
          "--prompt-file",
          options.promptPath,
          "--model",
          target.model,
          "--reasoning-effort",
          target.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--sandbox",
          grokSandbox(options.mode),
          "--tools",
          grokTools(options.mode),
          "--disallowed-tools",
          "Agent,search_tool,use_tool",
          "--output-format",
          "streaming-messages-json",
          "--cwd",
          options.cwd,
          "--no-subagents",
          "--disable-web-search",
          "--verbatim",
        ],
        stdin: "none",
      };
  }
}
