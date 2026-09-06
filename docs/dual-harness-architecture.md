# Shared pstack runtime for Codex and OpenCode2

Issue: https://github.com/justcarlson/open-pstack/issues/1

Both parent surfaces dispatch a Codex worker through the same runner. OpenCode2 is parent metadata, not a new execution adapter. OpenAI workers force ChatGPT authentication. The only paid target is GLM-5.3-Flash max through a scoped OpenRouter gateway.

The caller supplies its parent harness, target, access mode, prompt, working directory, output, and receipt. A paid lane also supplies the stable top-level task-id shared with sibling workers. The caller does not manage a gateway process or token.

`runLane()` owns a run-scoped gateway resource around the existing subprocess lifecycle. `commands.ts` binds the paid child to loopback using a scoped token; the gateway keeps the upstream key. The gateway canonicalizes each Responses request to the fixed model, max effort, output cap, provider, and maximum prices. The shared SQLite ledger reserves against both budgets before forwarding. It reconciles known cost and retains unknown reservations across interruption or crash. Receipt schema 4 includes the gateway audit alongside the existing requested-route evidence.

OpenCode2 has no automatic namespace for skill roots. The installer generates disposable views with `pstack-<name>` frontmatter IDs with matching prefixed directories and rewritten relative Markdown links; executable resources link to the shared source. The shared authored skill tree remains the source. Explicit discovery and a narrow permission rule avoid collisions with the operator's other skills.

Two designs were compared: an in-process gateway owned by the runner, and a separately supervised gateway process. An independent fresh Sol max judge preferred the second because it included installation and more explicit request accounting; both candidates and the judge used the same model, so this is not cross-model evidence. The final design uses the first lifecycle and grafts the second's namespaced installation and per-attempt reservation discipline. Installation is independent of the gateway process boundary. This avoids a control-pipe protocol, readiness negotiation, version skew, and orphan-process cleanup without sacrificing request-level accounting.

Use integer microdollars for budget decisions. Close the gateway and settle or retain in-flight reservations before producing the final paid receipt. Disable hidden upstream retries; any new request reserves again. Do not describe pinned serving-endpoint policy as provider-reported evidence when the response does not report that endpoint.

Runtime and installer implementation are complete. Both installed parent surfaces have dispatched real workers. See [release verification](release-1.4.0-verification.md) for checks, accounting, and evidence limits.
