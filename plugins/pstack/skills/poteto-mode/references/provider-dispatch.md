# Provider dispatch

A pstack route separates the execution harness from the API provider:

```text
<harness>[<api-provider>]:<model>@<effort>
```

For example, `codex[openrouter]:anthropic/claude-sonnet-4.5@high` uses the Codex CLI and its `openrouter` configuration. `omp[openrouter]:z-ai/glm-5.3-flash@high` uses OMP's model registry. A model can contain `/`. Parse the effort from the last `@`.

The API provider ID must start with a letter or digit and contain only letters, digits, underscores, and hyphens. It names trusted user configuration. A pstack model sheet never contains a base URL, credential, executable, or command template.

## Default routes

| Family | Upstream pstack choice | Harness | API provider | Model | Default effort | Claude-native agent stem |
|---|---|---|---|---|---|---|
| fable | claude-fable-5-thinking-max | claude | anthropic | claude-fable-5 | max | fable |
| sol | gpt-5.6-sol-max | codex | openai | gpt-5.6-sol | max | - |
| grok | grok-4.6-fast-xhigh | grok | xai | grok-4.6 | xhigh | - |
| opus | claude-opus-5-thinking-xhigh | claude | anthropic | claude-opus-5 | xhigh | opus |

The effort must be `low`, `medium`, `high`, `xhigh`, or `max`. The defaults above seed a first-run model sheet. They do not restrict later choices.

`fast` belongs to Cursor's Grok selector. It is not a Grok Build CLI model or effort flag. The default portable Grok route uses `grok-4.6` at `xhigh`.

## Harness capabilities

| Harness | API providers | Provider selection |
|---|---|---|
| Claude CLI | `anthropic` | Fixed by the adapter |
| Codex CLI | Any valid ID | `--config model_provider="<id>"` |
| Grok Build CLI | `xai` | Fixed by the adapter |
| Oh My Pi | Any valid ID | `--model <provider>/<model>` |

Configure a custom Codex provider in the trusted user-level Codex configuration. For example:

```toml
[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"
```

Codex reads the key from the named environment variable. OMP reads providers and models from its built-in catalog or `~/.omp/agent/models.yml`. Pstack passes only the provider ID and model. It does not read or copy credentials.

Adding another execution harness requires a code-owned adapter. The adapter must define its executable, preflight, access controls, output parser, model proof, and receipt evidence. Do not make these values configurable command templates.

## The parent resolves the route

The top-level harness resolves each route once. A child receives an assigned execution harness, API provider, model, effort, access mode, prompt, working directory, and output path. A child never detects the parent or chooses another route.

Use a native lane only when the parent can prove that its native primitive runs the requested API provider, model, and effort. Otherwise, use the external runner. This rule permits same-harness external lanes. A Codex parent runs `codex[openrouter]:...` externally because `spawn_agent` cannot pin a per-lane `model_provider`. Every explicit `omp[...]` route runs externally because OMP task items cannot select an arbitrary model per call.

Claude Code can run a matching shipped `pstack-<stem>-<effort>` agent natively. Codex can run a `codex[openai]:...` route natively only when the current parent uses OpenAI and `spawn_agent` can pin the requested model and effort. OMP uses its native task tool only for `inherit-parent` and `auto`. If the parent cannot prove an exact native match, route the lane externally and pin every field.

`inherit-parent` and `auto` remain aliases. They use the current parent model and effort through the native subagent primitive. In a panel, each alias consumes one lane and reduces provider diversity. Record that fact in the synthesis.

## External lanes

The launcher lives at `skills/poteto-mode/scripts/runner/pstack-runner` under the installed plugin. The parent writes the complete prompt to a unique file, chooses a working directory and unique result paths, then invokes the launcher directly.

```text
pstack-runner \
  --parent-harness <claude|codex|omp> \
  --harness <claude|codex|grok|omp> \
  --api-provider <id> \
  --model <real CLI model> \
  --effort <low|medium|high|xhigh|max> \
  --mode <read-only|isolated-write> \
  --prompt <unique prompt file> \
  --cwd <repository or dedicated worktree> \
  --output <unique final-response file> \
  --receipt <unique receipt file> \
  [--timeout <seconds>]
```

Pass each flag and value as a separate argument. Never interpolate prompt text into a shell command. The launcher invokes one model process, disables recursive agents and ambient skills, restricts the built-in tools, and records the exact route arguments. It never falls back.

The OMP adapter sends the prompt on stdin and runs `omp -p --mode json` with the exact provider, model, and effort. It preserves repository rules, disables extensions, skills, prewalk, sessions, and LSP, and applies the shipped `omp-lane.yml`. That code-owned overlay disables OMP model fallback, context promotion, automatic compaction, and Anthropic server-side fallback. Read-only OMP lanes expose only `read`, `grep`, and `glob`. Isolated-write lanes add `write`, `edit`, and `bash` and require a dedicated worktree.

The Claude and Grok adapters run their existing authentication and model preflights. The Codex OpenAI adapter runs `codex login status`. A custom Codex provider and OMP run their harness version command before the model call. The one model invocation proves that the harness accepted the provider, credentials, model, and output protocol.

Grok authentication preflight has one bounded retry. If the first `grok models` result appears unauthenticated, the runner waits five seconds and repeats that preflight. A second failure is terminal. The delay and both attempts share the runner's absolute deadline. Model execution is never retried.

The parent invocation must be resumable background work:

- In Claude Code, run the launcher through a background Bash tool call and retain its task ID.
- In Codex, run the launcher in a persistent exec session and retain its session ID.
- In OMP, run the launcher through an asynchronous Bash tool call and retain its job ID.

Start native and external lanes in the same fan-out phase. Drain every lane before judging.

The runner has no implicit timeout. Pass `--timeout` only when the user, an external service, or the task sets a real deadline. The value is one deadline from wrapper entry through preflight, model execution, and output capture. Cancel through the retained process handle. The runner then removes the empty output reservation and writes a `cancelled` receipt.

Read-only mode maps to Claude plan mode, the Codex read-only sandbox, the Grok read-only sandbox, or OMP's file-reading tool set. `isolated-write` maps to Claude `acceptEdits`, Codex `workspace-write`, Grok `acceptEdits` with its workspace sandbox, or OMP's explicit write tool set. Give each writer a dedicated worktree or output directory. Do not route a writer into a protected checkout.

Every concurrent external lane needs unique prompt, output, and receipt paths. The launcher reserves output and receipt paths and refuses to overwrite them. External lanes do not receive the parent's MCP tools. Keep MCP-dependent Why and Reflect roles on `inherit-parent` or `auto`.

## Completion and dropouts

A successful external lane satisfies all of these conditions:

1. The process exits with status `0`.
2. The schema-3 receipt has status `complete` and contains the exact requested `target`.
3. Claude and Grok report the requested model and use `apiProviderEvidence: "adapter-fixed"`.
4. Codex uses `modelEvidence: "pinned-argv"` when its JSONL omits the model and always uses `apiProviderEvidence: "pinned-argv"`.
5. OMP reports the requested API provider and model and uses `apiProviderEvidence: "provider-report"`.
6. The output file is not empty.

Pinned arguments prove what pstack asked the harness to run. They do not prove how a custom provider routed the request behind its API.

A missing CLI, failed authentication, unavailable model, explicit timeout, cancellation, non-zero child exit, malformed result, or model mismatch is a receipt-bearing dropout. Preserve the receipt and apply the calling skill's dropout policy. Never substitute the parent model, retry another provider, or reinterpret an external route as a native model slug.
