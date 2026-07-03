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
| `capabilities` | object | No | Capability flags. Currently only `{ "embedding": true }`. |
| `pricingTiers` | PricingTier[] | No | Tiered pricing overrides. |

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
