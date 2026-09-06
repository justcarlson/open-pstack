# Subscription-first pstack routing design

Settled September 5, 2026. Goal: use the operator's ChatGPT Pro subscription efficiently, retain strong judgment, and minimize additional API spending. This records the settled design. Implementation and installed-harness evidence are tracked in [the release verification record](release-1.4.0-verification.md).

## Access and billing

Codex CLI can remain the orchestrating harness; OpenCode2 is not a prerequisite. Codex supports custom providers using the Responses protocol, and OpenRouter exposes a Responses endpoint. The installed release verification now demonstrates a bounded GLM tool loop through this integration. The fork extends its former OpenAI-only policy with a single bounded GLM route. Prefer a separate external worker process with explicit provider credentials; native mixed-provider subagent behavior has not been verified. An OpenCode2 worker adapter is another option if direct Codex-to-OpenRouter compatibility fails. [Codex provider configuration](https://learn.chatgpt.com/docs/config-file/config-reference), [OpenRouter Responses API](https://openrouter.ai/docs/api_reference/responses/overview)

Use Codex signed in with ChatGPT for all OpenAI routes. Local `codex login status` was checked and reports `Logged in using ChatGPT`. This confirms authentication mode, not the account's plan tier or remaining allowance. The operator identifies the plan as Pro.

Keep OpenRouter as a separate API-backed route for `z-ai/glm-5.3-flash`. Do not send subscription credentials to OpenRouter or replace the built-in OpenAI provider endpoint. API-key use is separately billed and does not consume included ChatGPT access. [Official authentication documentation](https://learn.chatgpt.com/docs/auth)

Use standard service, with fast mode off. Larger context, extra output and repeated agents consume usage; concurrency does not create separate subscription allowances. Read available usage indicators rather than converting DeepSWE dollar costs into subscription percentages. Official documentation describes token-based credits and exposes `/status` for remaining Codex CLI limits. [Official pricing documentation](https://learn.chatgpt.com/docs/pricing)

## Final role map

| Role | Primary model and effort | Escalation / backup |
|---|---|---|
| Daily parent, ordinary coding, features, refactoring, routine bugs | GPT-5.6 Sol high through ChatGPT | Astra high for ambiguity, failed diagnosis, or difficult integration |
| Architecture decisions, consequential review, hard diagnosis, demanding explanation | GPT-6 Astra high through ChatGPT | Astra xhigh for a specifically difficult unresolved problem |
| Bounded repository exploration, extraction, mechanical edits | GPT-5.6 Luna max through ChatGPT | GLM-5.3-Flash max through OpenRouter in conservation mode |
| Performance and hillclimbing | Sol high for initial measurement and a focused change | Sol max for a difficult local optimization; Astra high for redesign |
| Ordinary verification | Deterministic tests, tools, and parent review | One independent Sol or Astra reviewer when the risk warrants it |
| Requested arena / architect / interrogate / cross-model review | Sol high and Astra high, one independent lane each | Add GLM Flash max only when an external perspective is useful and the spending budget permits |
| Requested swarm | Bounded Luna max workers, at most two at once | GLM Flash max workers in conservation mode |
| Why / Reflect roles requiring parent MCP tools | Inherit the verified ChatGPT-backed parent | Preserve tool access; do not move these roles to an external runner without those tools |

Terra, Grok, full GLM, Kimi, and other external models are outside the default route set. GLM Flash takes the economical worker and optional external-panel role previously associated with Grok. It does not become the sole adjudicator for hard work. Explicit model assignments and explicitly requested panel sizes override these defaults.

The default daily parent is Sol high. The design does not assume a running conversation can change its own model: select the parent when starting a session and pin child models at dispatch. Existing sessions finish using their actual model unless explicitly restarted or changed through supported controls.

## Usage policy

1. **Normal:** use included ChatGPT access first. Work in the parent unless a child has a concrete independent task. Use Luna for bounded delegation. Avoid sending the full conversation to children; provide task, relevant paths, constraints, and acceptance criteria.
2. **Conserve:** when a reliable usage indicator reports 25% or less remaining in either applicable allowance window, or the operator explicitly selects conservation, send eligible bounded new worker jobs to GLM Flash. Reserve ChatGPT usage for parent synthesis, hard decisions, and final review. The 25% reserve is an operating choice, not a provider limit or measured optimum.
3. **Allowance exhausted:** GLM Flash may complete bounded, independently verifiable work within budget. Checkpoint complex work requiring stronger review until subscription access returns; do not silently buy premium OpenAI or external-model access.
4. **Usage unknown:** remain in normal mode with restrained delegation. Do not guess the remaining allowance or silently start paid overflow.

Do not lower every reasoning setting to save usage. Sol high is the efficient general starting point in the observed benchmark; Luna and Flash retain max for their bounded work. Escalate on evidence from the task rather than running every task through a fixed series of models. No automatic max setting for Astra.

## Paid overflow policy

Initial design limits: **$5 per calendar month and $0.50 per top-level task**, including all OpenRouter workers and retries. These are conservative chosen defaults, not estimates of how much the operator will spend. No automatic top-up. If the remaining budget cannot cover the next reserved call, checkpoint or use available subscription access.

Only allow `z-ai/glm-5.3-flash`, with max reasoning and required tool support. Budget using the undiscounted $0.15 input / $0.50 output / $0.03 cache-read rate per million tokens, not the temporary half-price promotion. Recheck live endpoint prices before dispatch and impose matching maximum prices. Restrict serving to evaluated endpoints; begin qualification with the official Z.ai FP8 endpoint. [OpenRouter listing](https://openrouter.ai/z-ai/glm-5.3-flash), [provider routing controls](https://openrouter.ai/docs/guides/routing/provider-selection)

Use one retry for transient transport failure, within the same reservation and model. A task-quality failure returns evidence to the parent rather than triggering repeated paid attempts. Model changes are explicit new assignments; provider failure must not invoke a more expensive model.

Implement budget enforcement with a shared atomic reservation ledger before starting a call, using known input size, maximum billable output, and the allowed maximum token rates. Reconcile against reported cost afterward. A post-hoc total alone is not a spending cap. The monthly and task limits apply across concurrent workers. Reserve for uncertain usage after interrupted calls until reconciled.

## Conservation mechanics

- Default to one working agent. When delegation is warranted, allow at most two workers alongside the parent; no recursive delegation. Explicit user requests for larger parallel work take precedence.
- Use tools to locate and validate facts before assigning another model to reread the repository. Reuse concise evidence and results.
- Give each worker only the context needed for its assignment, plus a bounded output contract. Keep stable instructions stable to improve cache reuse where supported.
- Run the smallest meaningful check and broaden it only for failures, changed behavior, or remaining uncertainty.
- Stop after acceptance checks pass. Do not add routine three-model reviews, repeated summaries, or a second implementation just for reassurance.

## Evidence and activation

The role choices are operating hypotheses supported by the dated [model-selection analysis](../plugins/pstack/skills/poteto-mode/references/model-selection.md) and [OpenRouter comparison](open-weight-alternatives.md). DeepSWE does not measure pstack role performance or prove subscription usage savings. See the release verification record for the bounded live tasks; these are compatibility checks, not a model-quality benchmark.

Implementation must update the canonical model sheet, its generated local copies, role instructions, and the runner together. Add the narrowly allowed OpenRouter model without weakening the subscription authentication checks. Preserve per-job route receipts and separate credentials. The existing OpenAI-only guard must be deliberately changed; adding an OpenRouter string to the model sheet alone will fail.

Before activation, verify that OpenAI jobs use ChatGPT authentication, OpenRouter jobs use the exact allowed model/effort/endpoint, concurrent reservations enforce both caps, and provider failures cannot trigger premium fallback. Qualify GLM Flash on a bounded exploration task, a small tested implementation, and a review with known issues. Capture correctness, effective provider, cost, and failure behavior. No live configuration, billing setting, paid call, or subscription setting was changed while settling this design.
