# Routerly Providers — Instructions for AI Agents

This repository is the **provider catalog** for Routerly (https://github.com/Inebrio/Routerly).
Routerly fetches these files at runtime via plain HTTP GET to the GitHub raw content URL.
No git clone, no database — just JSON files served by GitHub.

---

## Fetch mechanism

Routerly resolves the catalog by fetching files in order from most specific to least specific,
merging each layer on top of the previous (earlier = higher priority). The base URL for each
configured repo is its GitHub raw content root, e.g.:

```
https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/
```

### Resolution order (most specific first)

For Routerly version `X.Y.Z` on channel `C`:

| Priority | URL path | Example |
|----------|----------|---------|
| 1 (highest) | `versions/providers-X.Y.Z.json` | `versions/providers-0.3.0.json` |
| 2 | `versions/providers-X.Y.json` | `versions/providers-0.3.json` |
| 3 | `versions/providers-X.json` | `versions/providers-0.json` |
| 4 | `channels/providers-C.json` | `channels/providers-stable.json` |
| 5 (lowest) | `providers.json` | `providers.json` |

Files that return HTTP 404 are silently skipped. `providers.json` is always fetched.
The merge result is: layer 1 wins over layer 2 wins over … wins over layer 5.

### Merge rules

- Provider key not present in higher layer → inherited from lower layer.
- Provider key present in higher layer → models merged by `id`. Higher layer's model wins on conflict; missing IDs are added from lower layer.
- `endpoint` override: higher layer wins if present and non-empty.

---

## Directory structure

```
providers.json            # Stable base catalog. Always fetched.
versions/
  providers-X.Y.Z.json   # Exact patch override  (e.g. providers-0.3.0.json)
  providers-X.Y.json     # Minor override        (e.g. providers-0.3.json)
  providers-X.json       # Major override        (e.g. providers-0.json)
channels/
  providers-stable.json  # Stable channel override
  providers-latest.json  # Latest/edge channel override
  providers-beta.json    # Beta channel override
SCHEMA.md                 # Field reference + pricing source URLs
CLAUDE.md                 # This file
.github/
  workflows/
    validate.yml          # CI: validates all JSON files on push/PR
```

**Keep version and channel files minimal** — only include providers/models that genuinely
differ from `providers.json`. Empty `{}` is valid and means "use base catalog for this layer".

---

## JSON format

Root object: `{ [providerKey]: ProviderEntry }`.
An empty object `{}` is valid — it means this layer adds nothing.

```jsonc
{
  "openai": {
    "endpoint": "https://api.openai.com/v1",
    "models": [
      {
        "id": "gpt-4o",
        "input": 2.5,
        "output": 10,
        "cache": 1.25,
        "cacheWrite": null,
        "contextWindow": 128000,
        "notes": "GPT-4o multimodal",
        "capabilities": { "embedding": false },
        "deprecated": false,
        "pricingTiers": [
          {
            "metric": "context_tokens",
            "above": 200000,
            "input": 5.0,
            "output": 15.0
          }
        ]
      }
    ]
  }
}
```

**All prices are USD per 1 million tokens.**
See `SCHEMA.md` for the full field reference and which fields are required vs optional.

---

## Provider keys

Never rename or remove an existing key — operators' project configs reference keys by name.

| Key | Provider |
|-----|---------|
| `openai` | OpenAI |
| `anthropic` | Anthropic |
| `anthropic-oauth` | Anthropic via Claude.ai OAuth |
| `openai-oauth` | OpenAI via ChatGPT OAuth |
| `gemini` | Google Gemini (OpenAI-compat) |
| `mistral` | Mistral AI |
| `cohere` | Cohere |
| `xai` | xAI (Grok) |
| `ollama` | Ollama (local) |
| `deepseek` | DeepSeek |
| `groq` | Groq |
| `together` | Together AI |
| `perplexity` | Perplexity |
| `custom` | User-defined endpoint |
| `azure-openai` | Azure OpenAI |
| `bedrock` | AWS Bedrock |
| `vertex` | Google Vertex AI |

To add a new provider: append a new key to `providers.json`. The Routerly service must also
implement the adapter — the key here only affects the UI (Discover, ModelForm dropdowns).

---

## How to update model prices

1. Check the official pricing page (see `SCHEMA.md` for URLs).
2. Convert to USD per 1M tokens.
3. Edit the model entry in `providers.json`.
4. If the change should only apply to a specific version/channel, edit the appropriate
   file in `versions/` or `channels/` instead.
5. Never delete a model — set `"deprecated": true` to hide it from new project creation
   while keeping backward compatibility for existing configs.

---

## How to add a new model

1. Prepend to the provider's `models` array in `providers.json` (newest first).
2. Minimum required: `id`, `input`, `output`.
3. Add `contextWindow`, `notes`, `cache`/`cacheWrite` if known.
4. Add `pricingTiers` for context-length tiered pricing.
5. Add `"capabilities": { "embedding": true }` for embedding-only models.

---

## What NOT to do

- Do not rename provider keys.
- Do not remove model entries — use `"deprecated": true`.
- Do not change `endpoint` for `azure-openai`, `bedrock`, `vertex`, `custom` — operators set these per-deployment.
- Do not commit invalid JSON (CI will catch it, but validate locally first).
- Do not add undocumented fields without updating `SCHEMA.md`.

---

## Local validation

```bash
find . -name "*.json" | while read f; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); process.stdout.write('ok  $f\n')"
done
```
