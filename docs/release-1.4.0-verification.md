# Release 1.4.0 verification

Verified September 6, 2026 UTC, on Linux with Codex CLI 0.153.4 and the installed OpenCode2 parent. These are bounded integration checks, not a comparative model benchmark.

## Automated checks

- 211 tests pass across 14 files, with 828 assertions; strict TypeScript checks pass.
- Static skill, model-panel, and manifest-version invariants pass; manifests parse successfully.
- Installer tests cover repeat installation, ownership, discovery names, and generated resource links. A real isolated OpenCode server registered all 52 expected `pstack-*` skill IDs; all 161 generated relative links resolved.
- Real local Codex sandbox tests exercise prompt delivery, workspace writes, protected routing credentials and budget state, private process visibility, and removal of unrelated environment secrets. The sandbox tests skip when Codex or Linux is unavailable; this local run executed them.
- Cross-process SQLite tests exercise competing task and month reservations. Unknown charges retain reservations; rejected requests do not consume an upstream call.

## Installed behavior

Both harnesses were installed with `bun scripts/install.ts --harness all --configure-defaults`. Codex refreshes its native plugin even when the version is unchanged. Final comparison found all 166 packaged source files identical to the installed Codex cache. OpenCode receives generated namespaced skill views linked to the shared runtime.

| Parent | Worker | Observed result |
| --- | --- | --- |
| Codex | Sol high, ChatGPT authentication | Installed skill read; schema-4 completion receipt; falsy-default fix independently checked with two passing tests. |
| OpenCode2 | Sol high, ChatGPT authentication | External runner completed the same bounded fix. This earlier smoke preceded final environment hardening. |
| Codex | GLM-5.3-Flash max, OpenRouter | Final hardened runtime: read-only source review correctly identified the falsy-default bug and proposed `??`; source remained unchanged. Two requests charged $0.001349, held $0. |
| OpenCode2 | GLM-5.3-Flash max, OpenRouter | Actual skill tool loaded `pstack-poteto-mode`; six upstream requests completed; parent independently inspected the fix and ran two passing tests. Charged $0.002587, held $0 for this lane. |

The OpenCode paid worker also reported denied readability of routing credentials and accounting state. Independent real-sandbox tests provide stronger local boundary evidence than that worker summary. Custom `CODEX_HOME` and `XDG_DATA_HOME` paths and the paid environment allowlist were tested after this smoke; the final Codex paid probe exercises that hardened runtime.

All paid release probes share `release-1.4.0-verification`. An early upstream rejection retained a $0.165479 reservation because no charge evidence was available. It was not cleared to make room for later tests. Caps remained $0.50 per task and $5 per UTC calendar month. An earlier successful three-request GLM loop charged $0.001615 with no lane hold; a normalized single-request probe charged $0.000021. Lane totals are not a claim about total account spending.

## Evidence limits and operating constraints

OpenAI receipts prove ChatGPT authentication preflight and pinned invocation arguments; they do not attest the private serving model. Paid receipts additionally record response-reported models and generation IDs. `z-ai/fp8` is enforced routing policy, not independently provider-reported endpoint evidence. No failed model route was automatically substituted.

The gateway reserves at undiscounted configured maximum prices and the qualified endpoint's 1,048,576-token context bound, with a 16,384-token output cap. It normalizes Responses fields for the qualified GLM endpoint and accepts local function/custom tools. Endpoint metadata and compatibility can change; qualification must be repeated when changing this route.

Paid tool processes cannot directly use the network, escalate approvals, read the configured Codex auth file or OpenCode credential directory, or alter the budget-state directory. Their environment is allowlisted. This protects known routing credentials and accounting; unrelated host files remain subject to the selected Codex workspace/read-only profile. It is not a general container for untrusted code or arbitrary host secrets.

External launchers need a parent context that permits their runtime state writes and provider connection. The normal installed profile was verified. A restricted parent must use an available permitted dispatch mechanism or report the blocked lane. Keep paid workspaces outside the private budget directory.
