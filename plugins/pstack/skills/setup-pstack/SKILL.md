---
name: setup-pstack
description: Configure pstack models, execution harnesses, API providers, and effort per role in Codex or OpenCode 2. Verifies each route before writing the model sheet.
---

# Setup pstack

Configure one parent-specific model sheet. Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before probing or writing. It defines the descriptor grammar, harness capabilities, routing rules, launcher, and receipt contract.

Codex stores the sheet at `~/.codex/pstack-models.md`; OpenCode 2 stores it at `~/.config/opencode/pstack-models.md`. Each harness copies the sheet's exact bytes into one bounded block in its `AGENTS.md`:

```text
<!-- pstack:models:begin -->
<exact contents of the model sheet>
<!-- pstack:models:end -->
```

Use the repository installer with `--harness all --configure-defaults` for the shipped defaults. It creates an explicit Codex `pstack` profile and OpenCode `pstack` agent.

When the operator asks for a recommended mix or the current flagship, read [the model-selection guide](../poteto-mode/references/model-selection.md) and verify its dated sources before choosing routes. Keep explicit user assignments unless the user asks to revise them.

## Configure the sheet

### 1. Establish the parent

Use the harness and tool set running this skill: Codex or OpenCode 2. A child cannot determine the parent because child processes inherit parent environment markers.

### 2. Load and normalize the current sheet

Read the parent-specific sheet when it exists. Overlay its rows on the complete first-run role map in [`config/pstack-models.md`](../../config/pstack-models.md) so the next successful write restores any missing documented role.

A schema-2 descriptor has this form:

```text
<harness>[<api-provider>]:<model>@<effort>
```

Normalize legacy `codex:<model>@<effort>` descriptors to `codex[openai]:<model>@<effort>`. Accept OpenAI GPT routes and the exact overflow descriptor `codex[openrouter]:z-ai/glm-5.3-flash@max`. Deduplicate identical panel routes while preserving order.

Reject unknown or duplicate roles and malformed bounded markers. If no bounded block exists, preserve unrelated instructions and create one; replace an existing unbounded pstack routing section only after identifying its complete extent.

### 3. Collect route changes

Apply the user's requested assignments. If no assignments were supplied, show the normalized map and ask which roles to change. Do not request approval again for assignments already authorized in the conversation.

A role can use one descriptor, a comma-separated descriptor list, `inherit-parent`, or `auto`. Every explicit route must satisfy the provider-dispatch allowlist. Keep Why and Reflect on `inherit-parent` only for a verified OpenAI parent because they need the parent's MCP tools. Otherwise report those roles unavailable. Each distinct panel entry creates one lane. The default panel has Sol high and Astra high.

### 4. Validate the intended map

Before probing or writing, require every documented role exactly once. OpenAI descriptors must match `codex[openai]:<gpt-model>@<effort>`; the sole paid descriptor is `codex[openrouter]:z-ai/glm-5.3-flash@max`. Allowed efforts are `low`, `medium`, `high`, `xhigh`, and `max`. Parse effort from the last `@`. Reject every other provider or model before execution.

### 5. Probe every distinct target

Group identical `(harness, api provider, model, effort)` targets. Probe each distinct target once through the route that the current parent will use.

Use a native probe only when the parent can prove an exact OpenAI provider, model, and effort match. Otherwise use the Codex external runner. Use a small read-only prompt that returns a unique marker. External receipts must satisfy the schema-4 completion contract. Probe the requested route without substitution. Paid probes require the shared task ID and consume the same enforced budget as paid workers.

A failed probe writes nothing. Report the failing descriptor and keep the active sheet and parent integration unchanged. Never substitute another provider, model, or effort.

### 6. Confirm the final map

Show the parent route for every descriptor and the exact rendered sheet. Existing user authorization is sufficient to write those assignments after successful probes. Ask only about an unresolved preference. State which lanes are native, external, or inherited and that all panels use one provider.

The first-run map is maintained in [`config/pstack-models.md`](../../config/pstack-models.md).

Use this map only on a first run. On a rerun, preserve every normalized role assignment and lane order unless the operator changes it.

### 7. Write both targets atomically

Render the sheet and parent integration in memory. Snapshot every target's bytes. Write only after all probes pass and the operator has authorized the assignments.

On Codex or OpenCode 2, replace the complete bounded block in that parent's `AGENTS.md`. If only one marker exists, either marker is duplicated, or their order is reversed, stop instead of guessing.

Read both targets back and compare them with the in-memory render. If a write or readback fails, restore every snapshot. An unchanged rerun must produce byte-identical output.

Do not copy a model sheet between parent harnesses without rerunning the probes. Route availability can differ on the same host.

### 8. Run a behavioral smoke

Run one read-only lane for every distinct final target, then run an independent cross-judge from the configured pool. Start all lanes together with unique output and receipt paths. Drain every lane before starting the judge.

Verify native transcript metadata and each external schema-4 receipt. A structural configuration check or unit test does not replace this smoke.

Report the sheet path, normalized changes, route table, probe results, smoke results, and external elapsed time, token, and cost fields. Do not claim that pinned arguments reveal a custom provider's private upstream routing.
