# Provider Catalog Schema

## Root object

```
{ [providerKey: string]: ProviderEntry }
```

## ProviderEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `endpoint` | string | Yes | Default base URL for this provider. Empty string for providers where the operator sets it per-deployment (azure, bedrock, vertex, custom). |
| `models` | ModelEntry[] | Yes | List of models. Newest first by convention. |

## ModelEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Exact model ID sent to the provider API. |
| `input` | number | Yes | USD per 1M input tokens. |
| `output` | number | Yes | USD per 1M output tokens. |
| `cache` | number | No | USD per 1M cached input tokens (prompt cache read). |
| `cacheWrite` | number | No | USD per 1M cache-write input tokens (Anthropic only). |
| `contextWindow` | number | No | Maximum context size in tokens. |
| `notes` | string | No | Human-readable description. Shown in the Routerly dashboard. |
| `deprecated` | boolean | No | If true, hidden from new project creation. Existing configs still work. |
| `capabilities` | object | No | Capability flags. See table below. |
| `stripParams` | string[] | No | Request body parameter names to remove before forwarding to this model (e.g. `["temperature"]` for models that reject it). Only list params the model explicitly rejects with a 400. |
| `pricingTiers` | PricingTier[] | No | Tiered pricing overrides. |

## ModelCapabilities

All flags are optional booleans. **An absent flag means unknown, never "false"**: a flag is written
only when an official source (provider documentation, model card, pricing or models page) states it
for that exact model, and every written value (true or false) must have an entry in
`capabilities-sources.json` (see below). Never infer a flag from the model name or from a sibling model.

| Flag | Description |
|------|-------------|
| `embedding` | Model produces embedding vectors (not chat completions). Written as `true` for embedding models. |
| `thinking` | Model supports extended/chain-of-thought reasoning (Anthropic `thinking` blocks, OpenAI `reasoning_effort`, reasoning-only models). |
| `vision` | Model accepts image inputs in the messages array. |
| `functionCalling` | Model supports the tool/function-call protocol (this is the "tools" capability; the catalog uses the name Routerly reads). |
| `json` | Model supports JSON mode or structured outputs (`response_format` `json_object` / `json_schema` or the provider equivalent). |
| `decision` | Decision model (answers predefined questions, cannot serve chat). Routerly derives it from the provider: the catalog does not declare it, and the check fails if a model does. |

Adding a flag: add the row here (the first column is read by the catalog tooling), then fill it per
model with sources. Routerly versions that do not read a flag receive catalog files without it.

## capabilities-sources.json

Sidecar file, not read by Routerly. One entry per declared capability value:

```json
{ "<providerKey>": { "<modelId>": { "<flag>": { "value": true, "source": "https://…", "checked": "YYYY-MM-DD" } } } }
```

`value` must equal the value in the catalog, `source` is the https page that states it, `checked`
is the date it was read. Check everything with `node scripts/check-capabilities.mjs [catalog.json] [sources.json]`
(defaults: the `stable` file of `index.json`); it fails on unknown flags, non-boolean values,
derived flags, values without a source, and sources without a value. Deprecated models are exempt from the missing-source rule.

## PricingTier

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `metric` | string | Yes | `"context_tokens"` — threshold is measured in total context tokens. |
| `above` | number | Yes | Threshold. Tier applies when the metric exceeds this value. |
| `input` | number | Yes | Override input price above threshold. |
| `output` | number | Yes | Override output price above threshold. |
| `cache` | number | No | Override cache price above threshold. |

---

## Official pricing sources

| Provider | URL |
|----------|-----|
| OpenAI | https://openai.com/api/pricing |
| Anthropic | https://www.anthropic.com/pricing |
| Google Gemini | https://ai.google.dev/pricing |
| Mistral | https://mistral.ai/technology/#pricing |
| Cohere | https://cohere.com/pricing |
| xAI | https://x.ai/api |
| DeepSeek | https://api-docs.deepseek.com/quick_start/pricing |
| Groq | https://groq.com/pricing |
| Together | https://www.together.ai/pricing |
| Perplexity | https://docs.perplexity.ai/guides/pricing |
| AWS Bedrock | https://aws.amazon.com/bedrock/pricing |
| Google Vertex | https://cloud.google.com/vertex-ai/generative-ai/pricing |
