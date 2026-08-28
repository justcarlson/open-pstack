---
name: setup-pstack
description: Configure pstack models, execution harnesses, API providers, and effort per role in Claude Code, Codex, or Oh My Pi. Verifies each route before writing the model sheet.
---

# Setup pstack

Configure one parent-specific model sheet. Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before probing or writing. It defines the descriptor grammar, harness capabilities, routing rules, launcher, and receipt contract.

Claude Code stores the sheet at `~/.claude/pstack-models.md` and includes it from `~/.claude/CLAUDE.md`:

```text
@~/.claude/pstack-models.md
```

Codex stores the sheet at `~/.codex/pstack-models.md`. Codex has no file include, so copy the sheet's exact bytes into one bounded block in `~/.codex/AGENTS.md`:

```text
<!-- pstack:models:begin -->
<exact contents of ~/.codex/pstack-models.md>
<!-- pstack:models:end -->
```

OMP stores the sheet at `~/.omp/agent/pstack-models.md` and copies the same bounded block into `~/.omp/agent/AGENTS.md`.

## Configure the sheet

### 1. Establish the parent

Use the harness and tool set running this skill: Claude Code, Codex, or OMP. A child cannot determine the parent because child processes inherit parent environment markers.

### 2. Load and normalize the current sheet

Read the parent-specific sheet when it exists. Overlay its rows on the complete first-run role map below so the next successful write restores any missing documented role.

A schema-2 descriptor has this form:

```text
<harness>[<api-provider>]:<model>@<effort>
```

Accept schema-1 descriptors only for migration. Normalize them in memory:

- `claude:<model>@<effort>` becomes `claude[anthropic]:<model>@<effort>`.
- `codex:<model>@<effort>` becomes `codex[openai]:<model>@<effort>`.
- `grok:<model>@<effort>` becomes `grok[xai]:<model>@<effort>`.

Do not keep schema-1 aliases after the write. If a line is not a known role, a supported alias, a schema-1 descriptor, or a schema-2 descriptor, stop and show the line. Do the same for duplicate roles or malformed bounded markers.

### 3. Collect route changes

Show the normalized role map. Ask whether to keep it or change named roles. Keeping it is the default.

A role can use one descriptor, a comma-separated descriptor list, `inherit-parent`, or `auto`. Do not restrict the operator to the first-run models. The operator can choose any model accepted by the selected harness and API provider.

Custom API providers can use Codex or OMP routes:

```text
codex[openrouter]:anthropic/claude-sonnet-4.5@high
omp[openrouter]:z-ai/glm-5.3-flash@high
```

The provider ID must already exist in trusted user-level harness configuration or the harness's built-in catalog. Never ask for its base URL, key, token, or headers. Do not write those values to the sheet.

Keep Why and Reflect roles on `inherit-parent` or `auto` because those roles need the parent's MCP tools. Each list entry creates one panel lane. List length controls fan-out.

### 4. Validate the intended map

Validate the complete in-memory map before any probe or write:

- Every documented role appears exactly once.
- A descriptor uses `<harness>[<api-provider>]:<model>@<effort>`.
- The harness is `claude`, `codex`, `grok`, or `omp`.
- The provider ID starts with a letter or digit and contains only letters, digits, underscores, and hyphens.
- The model is not empty. Preserve `/` and other harness-owned model characters.
- The effort is `low`, `medium`, `high`, `xhigh`, or `max`.
- Claude uses `anthropic`, Grok uses `xai`, and Codex and OMP can use any valid provider ID.

Parse the effort from the last `@`. Parse the API provider between `[` and `]`. Do not infer a provider from a model name.

### 5. Probe every distinct target

Group identical `(harness, api provider, model, effort)` targets. Probe each distinct target once through the route that the current parent will use.

Use a native probe only when the parent can prove an exact match for the API provider, model, and effort. Otherwise use the external runner. A same-harness custom-provider route is external. Every explicit OMP route is external because OMP task items cannot select an arbitrary model per call.

Use a small read-only prompt that returns a unique marker. The external receipt must match the schema-3 completion contract. A custom Codex provider and OMP run only a version preflight. The model invocation proves that the harness accepted the configured provider, credentials, model, and output protocol.

A failed probe writes nothing. Report the failing descriptor and keep the active sheet and parent integration unchanged. Never substitute another provider, model, or effort.

### 6. Confirm the final map

Show the parent route for every descriptor and the exact rendered sheet. Ask for confirmation before writing. State which lanes are native, which are external, and which aliases reduce panel diversity.

On an OMP parent, offer `omp[openrouter]:z-ai/glm-5.3-flash@high` as a concrete alternate route when that model is available. Do not add it silently to roles the operator did not name.

The first-run map is:

```markdown
# pstack model configuration

Schema: 2

Each route is `<harness>[<api-provider>]:<model>@<effort>`. Read the installed pstack provider-dispatch reference before launching a configured role. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.

feature, refactoring: grok[xai]:grok-4.6@xhigh
bug-fix: codex[openai]:gpt-5.6-sol@max
perf-issue: codex[openai]:gpt-5.6-sol@max
hillclimb: codex[openai]:gpt-5.6-sol@max
judgment and prose: claude[anthropic]:claude-fable-5@max
hardest tasks: claude[anthropic]:claude-fable-5@max
how explorer: grok[xai]:grok-4.6@xhigh
how explainer: claude[anthropic]:claude-fable-5@max
how critics: claude[anthropic]:claude-fable-5@max, codex[openai]:gpt-5.6-sol@max, grok[xai]:grok-4.6@xhigh, claude[anthropic]:claude-opus-5@xhigh
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: claude[anthropic]:claude-fable-5@max, codex[openai]:gpt-5.6-sol@max, grok[xai]:grok-4.6@xhigh, claude[anthropic]:claude-opus-5@xhigh
arena cross-judge pool: claude[anthropic]:claude-fable-5@max, codex[openai]:gpt-5.6-sol@max, grok[xai]:grok-4.6@xhigh, claude[anthropic]:claude-opus-5@xhigh
swarm workers: grok[xai]:grok-4.6@xhigh
architect runners: claude[anthropic]:claude-fable-5@max, codex[openai]:gpt-5.6-sol@max, grok[xai]:grok-4.6@xhigh, claude[anthropic]:claude-opus-5@xhigh
interrogate reviewers: claude[anthropic]:claude-fable-5@max, codex[openai]:gpt-5.6-sol@max, grok[xai]:grok-4.6@xhigh, claude[anthropic]:claude-opus-5@xhigh
```

Use this map only on a first run. On a rerun, preserve every normalized role assignment and lane order unless the operator changes it.

### 7. Write both targets atomically

Render the sheet and parent integration in memory. Snapshot every target's bytes. Write only after all probes pass and the operator confirms.

On Claude Code, keep exactly one `@~/.claude/pstack-models.md` include. On Codex or OMP, replace the complete bounded block in that parent's `AGENTS.md`. If either marker is missing, duplicated, or reversed, stop instead of guessing.

Read both targets back and compare them with the in-memory render. If a write or readback fails, restore every snapshot. An unchanged rerun must produce byte-identical output.

Do not copy a model sheet between parent harnesses without rerunning the probes. Route availability can differ on the same host.

### 8. Run a behavioral smoke

Run one read-only lane for every distinct final target, then run an independent cross-judge from the configured pool. Start all lanes together with unique output and receipt paths. Drain every lane before starting the judge.

Verify native transcript metadata and each external schema-3 receipt. A structural configuration check or unit test does not replace this smoke.

Report the sheet path, normalized changes, route table, probe results, smoke results, and external elapsed time, token, and cost fields. Do not claim that pinned arguments reveal a custom provider's private upstream routing.
