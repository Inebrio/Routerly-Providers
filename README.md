# Routerly Providers

The public **provider catalog** for [Routerly](https://github.com/Inebrio/Routerly): the list of
LLM providers, their models, prices, and endpoints.

Routerly reads this catalog at runtime over plain HTTP GET from GitHub raw content. There is no
git clone and no database. Editing a JSON file here and pushing to `main` is all it takes to change
what models and prices every Routerly instance sees.

## Contents

- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Updating the catalog](#updating-the-catalog)
- [Channels and versions](#channels-and-versions)
- [Model entry format](#model-entry-format)
- [Provider keys](#provider-keys)
- [Validation](#validation)
- [Multiple repos](#multiple-repos)

## How it works

1. Routerly fetches `index.json`.
2. It resolves the catalog file for its own version, falling back to the configured channel, then to `default`.
3. It fetches that one file, verifies the SHA-256 checksum listed in `index.json`, and uses it.

One file per resolution. No layering, no merging. If `index.json` returns 404, Routerly falls back
to fetching `providers.json` directly.

The base URL is the repo's GitHub raw content root:

```
https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/
```

## Repository layout

```
index.json                          Version/channel map + checksum registry
providers/
  providers.YYYYMMDDHHMMSS.json      Catalog file (mutable; UTC timestamp in the name)
SCHEMA.md                           Full field reference + official pricing source URLs
CLAUDE.md                           Instructions for AI agents editing this repo
.github/workflows/validate.yml      CI: validates every JSON file on push and PR
```

## Updating the catalog

Catalog files are **mutable**. For routine changes (update a price, add a model, add a provider)
edit the file in place, then refresh its checksum. You do not create a new file.

1. Edit the catalog file the current channel resolves to (see `index.json` -> `channels.stable`).
2. Recompute its checksum:

   ```bash
   shasum -a 256 providers/providers.YYYYMMDDHHMMSS.json
   ```

3. In `index.json`, set the new `checksum.sha256` for that file and bump its `updatedAt`.
4. Validate locally (see [Validation](#validation)) and push.

### When to cut a new file instead

Create a second timestamped file **only** when you need a distinct catalog for a different Routerly
version range, for example a breaking schema change that older builds must not receive:

1. Copy the current file to `providers/providers.YYYYMMDDHHMMSS.json` and edit it.
2. Compute its checksum.
3. In `index.json`, point the relevant version/channel at the new file and add its entry to the
   `providers` registry (`createdAt`, `updatedAt`, `checksum`). Keep the old file so older version
   ranges keep resolving to it.

### Golden rules

- **Never rename or remove a provider key.** Operators reference keys by name in their project configs.
- **Never delete a model.** To retire one, set `"deprecated": true`. It stays valid for existing
  configs but is hidden from new project creation.
- **All prices are USD per 1 million tokens.**
- **Check prices against the official pricing page** (URLs in `SCHEMA.md`), never from memory.

## Channels and versions

`index.json` resolves a Routerly build to exactly one catalog file.

```json
{
  "schemaVersion": 1,
  "default": "stable",
  "channels": {
    "stable": "providers/providers.20260703170500.json",
    "latest": "providers/providers.20260703170500.json"
  },
  "versions": {
    "^0.3.0": "providers/providers.20260703170500.json"
  },
  "providers": {
    "providers/providers.20260703170500.json": {
      "createdAt": "2026-07-03T17:05:00Z",
      "updatedAt": "2026-07-03T17:15:00Z",
      "checksum": { "sha256": "<hex>" }
    }
  }
}
```

`versions` keys are semver ranges, same syntax as `package.json`. `^0.3.0` covers `0.3.0`,
`0.3.5`, and so on. Routerly evaluates every range against its own version and picks the most
specific match; if none match it falls back to the channel, then to `default`.

| Channel | Meaning |
|---------|---------|
| `stable` | Tested, updated conservatively. |
| `latest` | Edge additions; may include models not yet broadly available. |

Operators choose per instance: pin to a version range for reproducibility, or follow a channel to
stay current.

The `providers` block is an integrity registry. Routerly verifies each downloaded file against its
listed `checksum.sha256` before using it, so the checksum must be updated on every content change.

## Model entry format

The catalog root is `{ [providerKey]: ProviderEntry }`. Each provider has an `endpoint` and a
`models` array, newest model first.

```jsonc
{
  "openai": {
    "endpoint": "https://api.openai.com/v1",
    "models": [
      {
        "id": "gpt-4o",              // exact model id sent to the provider API (required)
        "input": 2.5,                 // USD / 1M input tokens (required)
        "output": 10,                 // USD / 1M output tokens (required)
        "cache": 1.25,                // USD / 1M cached input tokens (optional)
        "cacheWrite": null,           // USD / 1M cache-write tokens, Anthropic only (optional)
        "contextWindow": 128000,      // optional
        "notes": "GPT-4o multimodal", // shown in the dashboard (optional)
        "deprecated": false,          // hide from new projects, keep backward compat (optional)
        "capabilities": { "embedding": false },
        "pricingTiers": [             // context-length tiered overrides (optional)
          { "metric": "context_tokens", "above": 200000, "input": 5.0, "output": 15.0 }
        ]
      }
    ]
  }
}
```

Minimum required fields: `id`, `input`, `output`. An empty catalog object `{}` is valid. See
`SCHEMA.md` for the complete field reference and which fields are required.

## Provider keys

Adding a key here only affects the Routerly UI (Discover and model-form dropdowns). The Routerly
service must also implement the matching adapter for the provider to work at runtime.

| Key | Provider |
|-----|----------|
| `openai` | OpenAI |
| `anthropic` | Anthropic |
| `anthropic-oauth` | Anthropic via Claude.ai OAuth |
| `openai-oauth` | OpenAI via ChatGPT OAuth |
| `gemini` | Google Gemini (OpenAI-compat) |
| `mistral` | Mistral AI |
| `cohere` | Cohere |
| `xai` | xAI (Grok) |
| `deepseek` | DeepSeek |
| `groq` | Groq |
| `together` | Together AI |
| `perplexity` | Perplexity |
| `fireworks` | Fireworks AI |
| `cerebras` | Cerebras |
| `ollama` | Ollama (local) |
| `custom` | User-defined endpoint |
| `azure-openai` | Azure OpenAI |
| `bedrock` | AWS Bedrock |
| `vertex` | Google Vertex AI |

Do not change `endpoint` for `azure-openai`, `bedrock`, `vertex`, or `custom`: operators set those
per deployment.

## Validation

Run the same check CI runs before pushing:

```bash
find . -name "*.json" -not -path "./.git/*" | sort | while read -r f; do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write('ok  ' + process.argv[1] + '\n')" "$f"
done
```

To confirm each catalog file matches the checksum registered in `index.json`:

```bash
node -e '
const idx = JSON.parse(require("fs").readFileSync("index.json", "utf8"));
const cp = require("child_process");
for (const [file, meta] of Object.entries(idx.providers)) {
  const real = cp.execSync("shasum -a 256 " + file).toString().split(" ")[0];
  console.log((real === meta.checksum.sha256 ? "MATCH    " : "MISMATCH ") + file);
}'
```

## Multiple repos

Routerly can read several provider repos at once. Each is fetched independently and merged, with the
repo listed first winning on conflict. Operators can add private repos (self-hosted GitHub or plain
raw HTTP) to extend this public catalog with internal models.

See [SCHEMA.md](SCHEMA.md) for the full field reference and pricing source URLs.
