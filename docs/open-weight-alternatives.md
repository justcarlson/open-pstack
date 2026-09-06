# Open-weight alternatives through OpenRouter

Verified September 5, 2026 (September 6 UTC). This research compares alternatives to Terra and Luna for the operator's OpenRouter backup. It does not change dispatch configuration.

## Recommendation

First evaluate GLM-5.3 max for Terra's general engineering and alternate-review work, and GLM-5.3-Flash max for Luna's bounded work. Kimi K3 is another competitive large model, but its OpenRouter pricing does not make it the obvious economical choice. DeepSeek V4 Flash 0731 deserves a separate cheap-worker trial because OpenRouter prices differ substantially from the vendor prices used by DeepSWE. These are evaluation priorities, not verified pstack role replacements.

## Comparable benchmark evidence

DeepSWE v1.1 has 113 tasks. The September 3 artifact reports these max-effort configurations. Costs below are the frontend's repriced mean trial costs, not OpenRouter bill estimates. The raw JSON alone has stale costs for several models. [Leaderboard](https://deepswe.datacurve.ai/), [results artifact](https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json), [pricing changes](https://deepswe.datacurve.ai/changelog)

| Model | Pass rate, reported 95% uncertainty | Displayed mean trial cost |
|---|---:|---:|
| Terra | 69.6% ±2.6 | $3.96 |
| Luna | 67.2% ±4.0 | $0.61 |
| GLM-5.3 | 69.0% ±3.0 | $3.99 |
| Kimi K3 | 68.5% ±4.5 | $4.65 |
| GLM-5.3-Flash | 63.4% ±4.4 | $0.24 |
| DeepSeek V4 Pro | 62.8% ±6.3 | $1.67 |
| DeepSeek V4 Flash | 53.3% ±3.6 | $0.46 |

GLM Flash has a slightly higher observed score than DeepSeek Pro at much lower displayed cost, but their uncertainty overlaps. It also exceeds older GLM-5.2 max (43.8%, $3.92). Neither establishes that a current Flash beats its current larger sibling: GLM-5.3 and DeepSeek V4 Pro each score higher than their own Flash in this dataset. Flash versus large must be checked by checkpoint, task, effort, and serving route.

The undated DeepSeek benchmark names do not establish that the current 0731/0813 OpenRouter checkpoints were tested. The Pro leaderboard addition predates 0813. Treat updated-checkpoint performance as unverified until rollout metadata or a new evaluation identifies it. The benchmark measures engineering task completion, not review accuracy, prose, exploration quality, or panel complementarity. [Methodology](https://deepswe.datacurve.ai/blog/deepswe), [v1.1 grading](https://deepswe.datacurve.ai/blog/deepswe-v1-1)

## OpenRouter availability and price snapshot

USD per million tokens, input / output / cache read, as returned by the model catalog. These are catalog prices, not guaranteed endpoint prices or total task costs. Endpoint-specific prices and discounts differ. [Live OpenRouter catalog](https://openrouter.ai/api/v1/models)

| Exact OpenRouter model ID | Input | Output | Cache read |
|---|---:|---:|---:|
| `z-ai/glm-5.3` | $1.40 | $4.40 | $0.14 |
| `z-ai/glm-5.3-flash` | $0.075 | $0.25 | $0.015 |
| `moonshotai/kimi-k3` | $3.00 | $15.00 | $0.30 |
| `deepseek/deepseek-v4-pro-0813` | $1.12068 | $3.36204 | $0.037356 |
| `deepseek/deepseek-v4-flash-0731` | $0.065 | $0.18 | $0.016 |
| `qwen/qwen3.8-flash` | $0.15 | $0.47 | $0.016 |
| `minimax/minimax-m3` | $0.30 | $1.20 | $0.06 |

The GLM Flash endpoint catalog exposes a 50% discount on Z.AI FP8, GMICloud FP8, Novita FP8, and DeepInfra FP4 at the quoted rate. The advertised promotion ends September 9, 2026 at 16:00 UTC. Several other endpoints are $0.15/$0.50/$0.03, also the undiscounted Z.ai rate. The lower rate must not become an assumed permanent price. [GLM Flash endpoints](https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints), [OpenRouter promotion](https://openrouter.ai/z-ai/glm-5.3-flash), [Z.ai pricing](https://docs.z.ai/guides/overview/pricing)

DeepSeek Flash 0731 has OpenInference FP8 at $0.05/$0.16/$0.013 and DeepInfra FP8 at $0.08/$0.18/$0.016 in this snapshot; the catalog's $0.065/$0.18 rate is also listed on FP4 endpoints. Catalog price alone therefore does not specify the service being evaluated. The undated OpenRouter DeepSeek V4 names identify older April checkpoints; use the dated IDs for current-checkpoint trials. [Flash endpoints](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints), [catalog](https://openrouter.ai/api/v1/models)

## Verification requirements

Kimi K3's official repository publishes weights under its custom Kimi K3 license. MiniMax M3 also publishes weights under a restrictive Community license, is available through OpenRouter, and warrants a cheap-worker trial; it has no result in this DeepSWE snapshot. Its advertised 1M context exceeds the current OpenRouter top-provider 512K limit. [Kimi weights](https://huggingface.co/moonshotai/Kimi-K3), [MiniMax M3 weights](https://huggingface.co/MiniMaxAI/MiniMax-M3), [OpenRouter catalog](https://openrouter.ai/api/v1/models)

Qwen3.8-Flash-Next and Qwen3.8-2.4T-A95B are public downloadable checkpoints under custom licenses. Their cards explicitly describe hosted Qwen3.8-Flash and Qwen3.8-Max as versions based on those weights with additional production features. Therefore, hosted scores do not prove exact checkpoint performance. Qwen reports Flash-Next at 58.7 on DeepSWE in its own setup, while the independent live snapshot has hosted Max at 57.5%; those are not a controlled head-to-head comparison. Flash-Next deserves evaluation, but no independent same-harness Flash score was located in the snapshot. [Flash-Next card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next), [Max base card](https://huggingface.co/Qwen/Qwen3.8-2.4T-A95B)

GLM-5.3 has public downloadable weights under its custom GLM-5.3 license; GLM-5.3-Flash has public downloadable MIT weights. The official FP8 repositories contain 141 and 62 safetensors shards respectively. Do not describe the full model as MIT. [GLM-5.3 weights and license](https://huggingface.co/zai-org/GLM-5.3), [Flash weights and license](https://huggingface.co/zai-org/GLM-5.3-Flash)

The dated DeepSeek Flash and Pro official repositories expose MIT licenses and 48 and 66 safetensors weight files respectively, verified through Hugging Face metadata without downloading weights. [Flash 0731 weights](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731), [Pro 0813 weights](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro-0813)

Before claiming a replacement, run the same representative tasks through the actual OpenRouter route with explicit reasoning effort and supported tools. During evaluation, pin an endpoint and quantization, require parameter support, and disable provider fallbacks so results have an identifiable source. Record effective provider, cost, completion validity, and task correctness. Production failover can then use the evaluated endpoints. OpenRouter otherwise load-balances and may fall back between providers. [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)

No paid inference or local role comparison was run for this research. Public availability, licenses, endpoint metadata, prices, and benchmark artifacts were checked; actual OpenRouter performance in the pstack harness remains untested.
