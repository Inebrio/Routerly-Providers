# Routerly Providers — Instructions for AI Agents

This repository is the **provider catalog** for Routerly (https://github.com/Inebrio/Routerly).
Routerly fetches these files at runtime via plain HTTP GET to the GitHub raw content URL.
No git clone, no database — just JSON files served by GitHub.

---

## Fetch mechanism

Routerly fetches `index.json` first, resolves the right file for its version/channel, then
fetches that single file. No layering, no merging — one file per resolution.

The base URL for each configured repo is its GitHub raw content root, e.g.:

```
https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/
```

### Resolution

1. Fetch `index.json`
2. Look up the Routerly version (`X.Y.Z` → `X.Y` → `X`) then the channel, then `default`
3. Fetch the file at the resolved path

If `index.json` is missing (404), fall back to `providers.json` directly.

### Updating the catalog (default path)

Catalog files are **mutable**: the normal way to update prices, add models, or add
providers is to edit the resolved file in place, then refresh its checksum.

1. Edit `providers/providers.YYYYMMDDHHMMSS.json` (the file the current channel/version resolves to).
2. Recompute its SHA-256: `shasum -a 256 providers/providers.YYYYMMDDHHMMSS.json`
3. In `index.json`, set the new `checksum.sha256` for that file and bump its `updatedAt`.

No new file, no channel/version repointing needed. This is what routine price and model
updates should do.

### Cutting a new versioned file (only when needed)

Create a separate timestamped file only when you need a **distinct catalog for a different
Routerly version range** (for example a breaking schema change that older Routerly builds
must not receive):

1. Copy the current file to `providers/providers.YYYYMMDDHHMMSS.json` and edit it.
2. Compute its SHA-256.
3. In `index.json`: point the relevant version/channel at the new file and add a `providers`
   registry entry with `createdAt`, `updatedAt`, and the checksum. Keep the old file so older
   version ranges keep resolving to it.

Version ranges work exactly like npm/Composer:

```json
"versions": {
  "^0.4.0": "providers/providers.20260901120000.json",
  "^0.3.0": "providers/providers.20260703170500.json"
}
```

`^0.3.0` covers `0.3.0`, `0.3.1`, `0.3.5`, etc. No need to list each explicitly.

Resolution: evaluate all ranges against the Routerly version, pick the most specific match.

---

## Directory structure

```
index.json                # Version/channel → file mapping + checksum registry.
providers/
  providers.YYYYMMDDHHMMSS.json  # Catalog file (mutable; UTC timestamp in the name).
SCHEMA.md                 # Field reference + pricing source URLs
CLAUDE.md                 # This file
.github/
  workflows/
    validate.yml          # CI: validates all JSON files on push/PR
```

### index.json structure

```json
{
  "schemaVersion": 1,
  "default": "stable",
  "channels": { "stable": "providers/providers.YYYYMMDDHHMMSS.json" },
  "versions": { "^0.3.0": "providers/providers.YYYYMMDDHHMMSS.json" },
  "providers": {
    "providers/providers.YYYYMMDDHHMMSS.json": {
      "createdAt": "2026-07-03T17:05:00Z",
      "updatedAt": "2026-07-03T17:05:00Z",
      "checksum": { "sha256": "<hex>" }
    }
  }
}
```

`providers` acts as an integrity registry — Routerly can verify the downloaded file against the checksum before using it.

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
| `fireworks` | Fireworks AI |
| `cerebras` | Cerebras |
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
3. Edit the model entry in `providers.json` (or the file that channel/version resolves to).
4. Never delete a model — set `"deprecated": true` to hide it from new project creation
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
