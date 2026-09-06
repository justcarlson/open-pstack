# OpenCode 2 tool mapping

OpenCode loads pstack through a generated, versioned skill view. Every skill name is prefixed with `pstack-` so it cannot shadow an existing user or system skill. When an authored pstack document names an unprefixed skill such as `arena`, invoke `pstack-arena`.

Map upstream tool names to OpenCode's native tools:

| Authored name or action | OpenCode 2 |
| --- | --- |
| `Read` | `read` |
| `Edit` or a focused replacement | `edit` |
| Create or replace a file | `write` |
| `Grep` or text search | `grep` |
| `Glob` or file discovery | `glob` |
| `Bash` or shell execution | `shell` |
| `Skill` | `skill`, using the `pstack-<name>` identifier |
| `Agent` or `Task` | `subagent` |
| `TodoWrite` | `todowrite` |
| `AskUserQuestion` | `question` |
| `WebFetch` and `WebSearch` | `webfetch` and `websearch` |

Issue independent native `subagent` calls together when a workflow asks for parallel work. A named plugin agent is an authored prompt, not an OpenCode agent registration. Its source is available under [`../../../agents`](../../../agents); pass that prompt to a native subagent when the workflow names it.

The parent resolves every provider route once. A child receives its assignment and never reads the model sheet to reroute itself. For an explicit model route, call the shared [`pstack-runner`](../scripts/runner/pstack-runner) with `--parent-harness opencode2 --harness codex` and the selected descriptor. OpenCode has no pstack output parser, JavaScript plugin, or session hook.

The installed default model sheet is `~/.config/opencode/pstack-models.md`. Start the managed primary agent explicitly with:

```shell
opencode2 run --agent pstack
```
