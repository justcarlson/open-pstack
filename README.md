# open-pstack

[![CI](https://github.com/justcarlson/open-pstack/actions/workflows/ci.yml/badge.svg)](https://github.com/justcarlson/open-pstack/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/justcarlson/open-pstack)](https://github.com/justcarlson/open-pstack/releases/latest)
[![MIT license](https://img.shields.io/github/license/justcarlson/open-pstack)](LICENSE)

**Open Pstack brings [Lauren Tan (@poteto)](https://x.com/poteto)'s [pstack](https://github.com/cursor/plugins/tree/main/pstack) to Codex and OpenCode 2.** It stays close to her original work while translating the parts that depend on Cursor.

Lauren built pstack from the skills she uses to ship code at Cursor. In a [55-minute interview with Denis Labelle](https://x.com/DenisLabelle/status/2091337807939706928), she says that she shipped 1,000 pull requests in one month after steadily improving how her agents work and verify their results.

> If you want to go fast, go deep first.

Open Pstack is an unofficial community project that makes pstack work in Codex and OpenCode 2. If Cursor is your main coding environment, use [Lauren's original pstack](https://github.com/cursor/plugins/tree/main/pstack).

## What pstack does

pstack is a plugin for coding agents. It is not a new model or a hosted service. It gives your agent engineering rules, step-by-step workflows for different kinds of work, focused skills, and small local tools.

The normal entry point is `poteto-mode`. You give it a task in plain language. It then:

- reads the task and chooses a workflow that fits;
- learns how the current system works before changing it;
- compares designs when the choice matters;
- favors small, simple changes over extra machinery;
- asks several models to challenge important decisions when useful;
- runs the code and checks real behavior instead of stopping at “the tests pass”; and
- carries the work through review, continuous integration (CI), and a ready-to-merge pull request when asked.

![How pstack routes a task through focused skills, real-app proof, and a review-ready pull request](assets/pstack-workflow.png)

pstack does not ask you to trust an agent on day one. It helps the agent leave evidence you can inspect. Start with supervised work. Let it run more work in parallel only after its checks have earned that trust in your own repositories.

## Install

You need Bun and Codex CLI with ChatGPT login. OpenCode 2 is required for its parent workflow. Clone this fork and install either harness or both:

```shell
git clone https://github.com/justcarlson/open-pstack.git
cd open-pstack
bun scripts/install.ts --harness all --configure-defaults
```

Use `--harness codex` or `--harness opencode2` for one harness. Omit `--configure-defaults` to preserve existing model assignments. The installer creates a native Codex plugin and generated OpenCode skills named `pstack-<skill>`, avoiding collisions with similarly named skills.

## Get started

Start the explicit pstack profile or agent:

```shell
codex -p pstack
opencode2 run --agent pstack
```

In Codex, ask: `Use pstack:poteto-mode. Add saved filters to search, verify the feature, and open a pull request.` In OpenCode 2, use `pstack-poteto-mode` instead. `pstack:setup-pstack` / `pstack-setup-pstack` verifies changed routes before saving them.

For that feature, poteto-mode should first understand how search works today. It should decide how the data should be represented before writing code, implement the smallest complete version, run the feature the way a user would, review the result, and prepare the pull request.

That is the main workflow. The other skills are there when poteto-mode needs them or when you want to call one directly.

## Useful skills

| Skill | Use it when |
| --- | --- |
| `how` | You want a clear explanation of how part of the system works. |
| `why` | You want evidence for why the system was built that way. |
| `architect` | A change crosses a function or module boundary and the design needs to be settled first. |
| `arena` | You want several complete attempts, followed by a comparison of their best parts. |
| `interrogate` | You want different models to try to break a design or diff. |
| `create-verification-skill` | Your project has no repeatable way for an agent to prove real behavior. |
| `maintain-verification-skill` | The project's verification instructions no longer match the product. |
| `babysit` | A pull request needs CI failures and review comments handled until it is ready. |
| `reflect` | A hard task is finished and its lessons should improve the next run. |

Codex skills use `pstack:` names; OpenCode 2 uses `pstack-` names. See the [technical reference](docs/reference.md) for the full skill list.

## Models and usage

The shipped map uses ChatGPT subscription access first: Sol high for implementation, Astra high for judgment, Astra xhigh for the hardest work, and Luna max for bounded exploration. Panels use Sol high and Astra high. Run at most two workers concurrently.

GLM 5.3 Flash max is an optional OpenRouter overflow worker. A scoped gateway pins its provider and prices and enforces $5 per UTC month and $0.50 per task across pstack requests. It reuses the existing OpenRouter credential and writes charges and unresolved reservations into each receipt. Direct OpenRouter use outside pstack is outside this budget.

When reliable quota evidence shows 25% or less remaining, suitable workers can use overflow while leadership retains Pro access. Unknown quota stays on Pro until an actual limit is reported. Pstack never silently substitutes a failed route. See the [dispatch contract](plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) and [architecture](docs/dual-harness-architecture.md).

Both parents share one source skill tree. Codex can use native children when it can pin the exact requested route. OpenCode 2 dispatches explicit routes through the installed Codex worker launcher. Why and Reflect inherit parent MCP tools only with a verified OpenAI parent.

## Learn from the original

Lauren's [pstack guide](https://github.com/cursor/plugins/tree/main/pstack/docs/guide) walks through a real task, verification, and longer unattended runs. It uses Cursor's interface, but the ideas are the same. Use the translated skill invocations above in Codex or OpenCode 2.

This repository also keeps:

- [the original README](README-UPSTREAM.md), unchanged;
- [the technical reference](docs/reference.md) for every skill, dependency, and parent-harness detail;
- [the upstream sync record](UPSTREAM.md) and update process;
- [the change record](CHANGES.md) for every adaptation; and
- [the attribution record](NOTICE.md) for pstack and the imported Cursor Team Kit skills.

## Staying close to Lauren's pstack

Open Pstack 1.4.0 tracks pstack 0.14.3 at Cursor commit [`bdf7aa355337897f167153e05069aca505dae17c`](https://github.com/cursor/plugins/commit/bdf7aa355337897f167153e05069aca505dae17c).

The two projects have separate version numbers. The pstack version identifies Lauren's upstream content. The Open Pstack version identifies this cross-harness package.

In this repository, "upstream" means Lauren's original pstack. Open Pstack records the exact version it follows, reviews changes in order, and changes only what Codex or OpenCode 2 require. New pstack behavior belongs in Lauren's project first whenever possible.

## Contributing

Fixes for Codex or OpenCode 2 and help bringing over new pstack releases are welcome. Search [GitHub Issues](https://github.com/justcarlson/open-pstack/issues) before opening a new issue. For larger behavior changes, explain why the change belongs in Open Pstack instead of Lauren's original project.

Read [UPSTREAM.md](UPSTREAM.md) before changing content brought over from Lauren's pstack. Pull requests must keep one shared skill tree for all parent harnesses and pass the repository's tests, type checks, plugin validation, and static checks.

## License

MIT. pstack was created by Lauren Tan. Open Pstack builds on Michael Denyer's [pstack-claude](https://github.com/michael-denyer/pstack-claude) port and includes attributed MIT-licensed work from Cursor Team Kit and Superpowers. See [NOTICE.md](NOTICE.md) and the preserved license files for details.
