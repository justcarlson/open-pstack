# Provider dispatch

Pstack supports Codex and OpenCode 2 parents. Both use Codex CLI for external workers. Read the parent's model sheet before choosing a route: `~/.codex/pstack-models.md` or `~/.config/opencode/pstack-models.md`. The shipped map is [`config/pstack-models.md`](../../../config/pstack-models.md).

## Routes and defaults

The descriptor grammar is `<harness>[<api-provider>]:<model>@<effort>`. Parse effort from the last `@`. Normalize legacy `codex:<model>@<effort>` to `codex[openai]:<model>@<effort>`.

The public launcher accepts:

- `codex[openai]:<gpt-model>@<effort>`, with effort `low`, `medium`, `high`, `xhigh`, or `max`.
- `codex[openrouter]:z-ai/glm-5.3-flash@max`, exclusively through the scoped paid gateway.

Reject other providers, models, and execution harnesses. Never substitute a route after failure.

Defaults use Sol high for implementation, Astra high for judgment and explanation, Astra xhigh for the hardest work, and Luna max for bounded exploration. Panels contain Sol high and Astra high. These are different models from one provider; do not claim cross-provider independence. For current-model recommendations, refresh the sources in [the model-selection guide](model-selection.md).

Use Pro first. When reliable remaining-quota evidence is available, reserve the last 25% for leadership and review and use GLM for suitable bounded overflow. If quota is unknown, remain on Pro until an actual limit is reported. Never infer remaining quota from token estimates. Run at most two workers concurrently.

## Parent capabilities

Use native `spawn_agent` only when the parent can verify OpenAI as its provider and pin the exact requested model and effort. Otherwise use the external launcher. OpenCode 2 uses the external launcher for explicit routes. Read [OpenCode tools](opencode-tools.md) for installed skill names and parent tools.

`inherit-parent` and `auto` are permitted only when the parent is verified to use OpenAI. They preserve the parent's MCP tools for Why and Reflect and consume one lane. Otherwise record a dropout for an MCP-dependent role. External workers do not inherit parent MCP tools.

Children receive an assigned route, access mode, prompt, working directory, and output path. They never select routes or launch nested agents. Give each writer a dedicated worktree or output directory.

## External lanes

Use the installed `skills/poteto-mode/scripts/runner/pstack-runner`:

```text
pstack-runner \
  --parent-harness <codex|opencode2> \
  --harness codex --api-provider openai \
  --model <gpt-model> --effort <low|medium|high|xhigh|max> \
  --mode <read-only|isolated-write> \
  --prompt <unique prompt file> --cwd <repository or dedicated worktree> \
  --output <unique final-response file> --receipt <unique receipt file> \
  [--timeout <seconds>]
```

Pass flags and values as separate arguments. Never interpolate prompt text into shell commands. The launcher refuses to overwrite outputs or receipts. Retain each process handle and drain every worker before judging.

OpenAI lanes require ChatGPT login, force subscription authentication and standard service tier, and strip API-key environment variables from children. They ignore ambient user configuration and disable recursive agents, apps, plugins, and hosted web search. Read-only lanes use the Codex read-only sandbox; isolated writers use workspace-write.

Paid lanes replace the provider/model flags with `--api-provider openrouter --model z-ai/glm-5.3-flash --effort max` and require `--task-id <stable-task-id>`. Reuse the same task ID across every lane and retry belonging to one task. The launcher owns a loopback gateway with a random per-lane token. Paid tool commands use a permissions profile that denies the configured Codex auth file, OpenCode credential directory, and budget-state directory, disables their direct network access, and refuses approval escalation. Keep paid workspaces outside those private state directories. The paid child receives an allowlisted environment and a scoped token. These controls protect known routing credentials and accounting state; they are not a complete isolation boundary for unrelated secrets elsewhere on the host. Only the gateway reads the OpenRouter credential, from `OPENROUTER_API_KEY` or the existing OpenCode credential store.

The gateway pins `z-ai/fp8`, disables provider fallbacks, caps prices at $0.15/M input and $0.50/M output, and reserves a conservative charge before every upstream request. A process-safe SQLite ledger enforces $5 per UTC month and $0.50 per task. Unresolved charges remain reserved. This budget covers pstack gateway traffic; direct OpenRouter use outside pstack is outside its scope. There are no automatic upstream retries.

The parent command context must allow Codex runtime-state writes and model-network access. A restricted parent can use a matching native route or its normal approved external-execution mechanism; otherwise record a dropout. Worker access remains bounded by its assigned mode.

The runner has no implicit timeout. Supply one only for a real deadline. Cancellation shuts down the child and gateway, settles known charges, retains unknown reservations, and writes a dropout receipt.

## Completion and dropouts

A successful external lane requires a zero process exit, a nonempty final output, and a schema-4 receipt with status `complete` and the exact requested target. Codex receipts use `modelEvidence: "pinned-argv"` and `apiProviderEvidence: "pinned-argv"` when its JSONL omits model identity. Pinned arguments establish the request; they do not prove private upstream routing.

Paid receipts also contain request count, charges, unresolved reservations, generation IDs, reported models, the pinned endpoint, and any gateway failure. A lane with no paid requests, an unresolved reservation, or a gateway failure is not complete.

A rejected descriptor is a configuration error. Missing CLI, authentication failure, unavailable model, budget refusal, timeout, cancellation, nonzero child exit, malformed result, or model mismatch is a receipt-bearing dropout. Preserve its receipt and follow the calling skill's dropout policy. Never silently change provider, model, or effort.
