# pstack model configuration

Schema: 2

Use ChatGPT subscription authentication for OpenAI. Resolve routes before dispatch; never change a model after failure. OpenRouter workers are explicit overflow assignments, share one top-level task-id, and use the runner's budget gateway. Default to one working agent, with at most two independent workers when useful. Parent sessions start on Sol high; escalation is deliberate.

feature, refactoring: codex[openai]:gpt-5.6-sol@high
bug-fix: codex[openai]:gpt-5.6-sol@high
perf-issue: codex[openai]:gpt-5.6-sol@high
hillclimb: codex[openai]:gpt-5.6-sol@high
judgment and prose: codex[openai]:gpt-6-astra@high
hardest tasks: codex[openai]:gpt-6-astra@xhigh
how explorer: codex[openai]:gpt-5.6-luna@max
how explainer: codex[openai]:gpt-6-astra@high
how critics: codex[openai]:gpt-5.6-sol@high, codex[openai]:gpt-6-astra@high
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: codex[openai]:gpt-5.6-sol@high, codex[openai]:gpt-6-astra@high
arena cross-judge pool: codex[openai]:gpt-5.6-sol@high, codex[openai]:gpt-6-astra@high
swarm workers: codex[openai]:gpt-5.6-luna@max
architect runners: codex[openai]:gpt-5.6-sol@high, codex[openai]:gpt-6-astra@high
interrogate reviewers: codex[openai]:gpt-5.6-sol@high, codex[openai]:gpt-6-astra@high
overflow workers: codex[openrouter]:z-ai/glm-5.3-flash@max

Normal mode uses included ChatGPT access first. Conservation mode selects overflow workers only when the operator requests it or a reliable usage indicator shows 25% or less remaining in an applicable allowance window. Unknown usage stays in normal mode. Reserve Astra/Sol access for synthesis and consequential review. If that access is exhausted, checkpoint work requiring their judgment.

Paid pstack workers are limited to $5 per UTC calendar month and $0.50 per top-level task, including reservations for unknown costs. These limits do not cover direct OpenRouter usage outside pstack. Do not raise spending limits, buy credits, enable automatic top-ups, or switch to premium external models automatically. A third review lane using GLM is optional and requires an explicit new assignment within these limits.
