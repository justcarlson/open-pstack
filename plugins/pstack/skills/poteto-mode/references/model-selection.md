# Evidence-based model selection

Researched September 5, 2026. Benchmark snapshot September 3, 2026. This is a selection guide, not a replacement for the operator's model sheet. The installation remains OpenAI-only. Compare other providers as evidence; do not dispatch them.

## Identify the current flagship

OpenAI's current official flagship is **GPT-6 Astra**. Its model guide identifies it as the most capable OpenAI model for complex reasoning, software engineering, research, computer use, and professional work. That supports using Astra for difficult work and coordination. It does not prove that Astra wins every pstack role. [Official model guide](https://developers.openai.com/api/docs/guides/latest-model), [Astra specifications](https://developers.openai.com/api/docs/models/gpt-6-astra)

Before answering a new request for the current SOTA or changing routes, recheck the official model catalog, DeepSWE's current version and update date, and the local Codex model catalog. Record unavailable or unmeasured models explicitly. Never turn this dated statement into a permanent claim about which model is newest.

## What DeepSWE establishes

The v1.1 benchmark measures long engineering tasks with one shared mini-swe-agent harness. Its 113 tasks are not pstack-specific evaluations. The older qualitative study concerns GPT-5.5/5.4 and contemporary competitors, not Astra, Sol, Terra, or Luna. It under-represents bug localization and refactoring; architecture judgment, review accuracy, prose quality, and multi-model complementarity are not directly measured. Do not invent behavioral specialties for current models from that older study. [Methodology and limitations](https://deepswe.datacurve.ai/blog/deepswe), [v1.1 changes](https://deepswe.datacurve.ai/blog/deepswe-v1-1)

Selected configurations are below. Pass rates and uncertainty come from the raw artifact; costs are the site's displayed mean cost per trial after its pricing adjustments. Tokens and steps are means, not latency. [Live leaderboard, select all effort levels and enable Terra](https://deepswe.datacurve.ai/), [raw results](https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json)

| Model and effort | Pass rate | Mean cost | Output tokens | Agent steps |
|---|---:|---:|---:|---:|
| Astra medium | 72.8% ±2.6 | $4.38 | 20k | 26 |
| Astra high | 73.2% ±3.4 | $5.72 | 27k | 27 |
| Astra xhigh | 74.1% ±2.9 | $6.52 | 30k | 29 |
| Astra max | 73.2% ±0.8 | $12.37 | 61k | 28 |
| Sol high | 69.4% ±1.4 | $2.66 | 28k | 37 |
| Sol xhigh | 70.7% ±0.8 | $3.60 | 41k | 44 |
| Sol max | 72.7% ±2.8 | $6.46 | 60k | 61 |
| Terra max | 69.6% ±2.6 | $3.96 | 72k | 76 |
| Luna max | 67.2% ±4.0 | $0.61 | 73k | 102 |
| Fable 5 max | 69.7% ±4.0 | $21.63 | 119k | 88 |
| Fable 5 xhigh | 69.9% ±3.2 | $13.41 | 80k | 68 |
| Opus 5 xhigh | 73.2% ±3.1 | $9.07 | 92k | 89 |
| Opus 5 max | 73.6% ±3.9 | $11.84 | 118k | 99 |
| Grok 4.6 xhigh | 66.7% ±2.2 | $5.50 | 71k | 87 |
| Grok 4.6 medium | 67.5% ±2.3 | $3.45 | 50k | 70 |

Error bars overlap among the leading configurations. Small differences are not proof of superiority. Astra high is an efficient starting point; max more than doubles its reported cost without raising the measured pass rate. Sol high nearly matches Terra max with much less output and lower cost. Luna max is inexpensive in dollars but uses many steps and tokens. These are observed tradeoffs, not evidence of equal latency or guaranteed task success.

Cost caveats matter. Astra uses an expected launch rate card that differs from its current official API pricing. Sol incorporates a promotional price reduction. The frontend also adjusts older Terra and Luna costs; raw `mean_cost_usd` alone reproduces stale prices for those models. Do not present these trial costs as today's Codex bill or subscription consumption. [Pricing changelog](https://deepswe.datacurve.ai/changelog), [current OpenAI comparison](https://developers.openai.com/api/docs/models/compare)

## Original pstack defaults and successors

The baseline is open-pstack 1.3.0 at commit `2bc4fb1`, before this installation's OpenAI substitutions.

| Original default | Original job | Newer model or current family status |
|---|---|---|
| Fable 5 max | Judgment, prose, hardest work, explanation, panels | Fable 5.1 launched September 1. No Fable 5.1 result appears in this DeepSWE snapshot. |
| Grok 4.6 xhigh | Features, refactoring, exploration, swarm, panels | Grok 4.6 remains the current documented flagship. Its medium setting is more economical in this benchmark; that is an effort change, not a successor. |
| Sol max | Bugs, performance, hillclimbing, panels | Astra is OpenAI's newer flagship. Preserve Sol as another model option rather than treating all Sol assignments as obsolete. |
| Opus 5 xhigh | Additional panel perspective | Opus 5 remains the current Opus model in the vendor catalog. Fable 5.1 is a newer higher-tier option, not an Opus 5.1 release. |

Anthropic describes Fable 5.1 as stronger at long-running coding, research, and document work, with cheaper cache reads than Fable 5. Those are vendor claims, not an independent DeepSWE result. Do not claim Astra beats Fable 5.1 from the Fable 5 row. [Fable 5.1](https://platform.claude.com/docs/en/models/fable-5-1/overview), [Claude catalog](https://platform.claude.com/docs/en/models/overview), [Grok catalog](https://docs.x.ai/developers/models)

## Recommended role mix

These are starting hypotheses for pstack, informed by the measurements and the official model positioning. They are not benchmark-proven role specialties. The operator's explicit assignments continue to win.

| Role | Suggested route | Use and limitation |
|---|---|---|
| Parent coordination, judgment, prose, how explainer | `codex[openai]:gpt-6-astra@high` | Strong general judgment with restrained measured output. Medium is a lower-cost option for routine follow-ups. |
| Hardest tasks | `codex[openai]:gpt-6-astra@xhigh` | Highest observed OpenAI pass rate. Escalate before launch for genuinely difficult work; do not make max automatic. |
| Feature and refactoring implementation | `codex[openai]:gpt-5.6-sol@high` | Efficient ordinary worker. Use Astra high for ambiguous or especially consequential work. |
| Bug fixes, performance, hillclimbing | `codex[openai]:gpt-5.6-sol@max` | Retain the upstream specialist assignment pending local evaluation. DeepSWE does not validate that specialization. |
| Bounded how exploration and extraction | `codex[openai]:gpt-5.6-luna@max` | Low-dollar fan-out with file citations and explicit scope. Do not use as sole final adjudicator. |
| General swarm workers | `codex[openai]:gpt-5.6-sol@high` | Use Luna max only when each lane is bounded and independently checkable. |
| Arena, architect, how critics, interrogate | Astra high, Sol max, Terra max | Three distinct OpenAI models. Mixing them may help, but error independence and ensemble gains are unmeasured. |
| Cross-judge | Astra high or Sol max | Prefer a model different from the likely base author; never claim provider diversity. |
| Why and Reflect | `inherit-parent` | Keep required MCP access, only with a verified OpenAI parent. |

Terra max remains useful as an alternate panel model and honors the operator's Grok replacement. DeepSWE does not establish a Terra-specific architectural or review advantage. Sol high is the stronger cost-based candidate for ordinary implementation in this snapshot. Officially, Terra is positioned as the balanced tier and Luna as the high-volume, cost-sensitive tier. [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

Do not silently lower Luna or Terra effort for open-ended engineering. Their lower-effort configurations score materially worse on this benchmark. A smaller output budget or a narrower task is a separate choice from lowering reasoning effort.

Resolve the route once before dispatch, probe newly selected model/effort pairs, preserve the configured access mode, and follow provider-dispatch dropout rules. A different model after failure requires an explicit new assignment, not a hidden fallback. Validate the proposed mix on representative local feature, bug, review, and explanation tasks before describing role-specific strengths as established.
