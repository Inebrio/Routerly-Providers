# Routerly Providers

The public **provider catalog** for [Routerly](https://github.com/Inebrio/Routerly): LLM providers,
their models, prices, endpoints and capabilities.

Routerly reads this catalog at runtime with plain HTTP GET requests to GitHub raw content. There is
no git clone and no database. What is on `main` is what Routerly instances read, so `main` is the
only branch.

```
https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/
```

## Contents

- [Repository layout](#repository-layout)
- [How Routerly picks a file](#how-routerly-picks-a-file)
- [Channels and versions](#channels-and-versions)
- [Verified changes only](#verified-changes-only)
- [Daily job](#daily-job)
- [Updating the catalog](#updating-the-catalog)
- [Model entry format](#model-entry-format)
- [Provider keys](#provider-keys)
- [Validation](#validation)
- [Multiple repos](#multiple-repos)

## Repository layout

```
index.json                          Channel and version map, checksum registry
providers/
  providers.YYYYMMDDHHMMSS.json     Catalog files, updated in place (the timestamp is the creation time)
capabilities-sources.json           Official source (URL and date) of each capability value and context window
SCHEMA.md                           Field reference and official pricing pages
scripts/
  validate.mjs                      Checks JSON, checksums and schema; shows which file a version reads
  check-capabilities.mjs            Checks capability values and context windows against their sources
  catalog.mjs                       Bookkeeping of a manual edit (checksum, index.json, validation)
.github/workflows/validate.yml      CI: runs both checks on every push to main and pull request
.gitignore
README.md
```

When you change this structure, update this README in the same commit.

## How Routerly picks a file

1. It fetches `index.json`.
2. It takes the channel set by the operator for the repository, or `default` when none is set. If that
   name is in `channels`, it uses that file.
3. Otherwise it takes the first range in `versions` that matches its own version.
4. It fetches that one file, checks the SHA-256 listed in `providers`, and uses it. No layering, no
   merging.

It reads `providers.json` at the root only when `index.json` is missing or names no file for the
version. The daily job writes that file once `default` is gone (see below).

Routerly skips the download when `updatedAt` of the file has not changed, so every change must bump it.

## Channels and versions

```json
{
  "schemaVersion": 1,
  "default": "stable",
  "channels": { "stable": "providers/A.json", "latest": "providers/A.json", "next": "providers/B.json" },
  "versions": { ">=0.3.0": "providers/A.json" },
  "providers": {
    "providers/A.json": {
      "createdAt": "…", "updatedAt": "…", "checksum": { "sha256": "…" },
      "range": ">=0.3.0", "tags": "v0.3.0..v0.6.0"
    },
    "providers/B.json": {
      "createdAt": "…", "updatedAt": "…", "checksum": { "sha256": "…" },
      "range": ">=0.6.1-0", "forVersion": "0.6.1"
    }
  }
}
```

| Channel | File |
|---------|------|
| `stable`, `latest` | The newest released Routerly versions |
| `next` | The next, not yet released version. It can hold providers and fields that released versions do not read |

`versions` keys are semver ranges. While one range of versions is released, `default` is `stable`, so
every instance reads the `stable` file unless the operator picks another channel. When a release
needs its own catalog, the daily job removes `default`, and `versions` then sends each Routerly
version to its file.

There is one file per distinct catalog. A refresh edits the existing file. A new file appears only
when a version range needs a catalog that differs. Files that no channel or range uses are removed.

`index.json` holds only the fields above.

## Verified changes only

New models, price changes and `verified` records reach this catalog only after verification: an
official source for the value, and for `verified` a real call to the model plus its official price.

`verified` is `{ "at": "YYYY-MM-DD", "how": ["call", "type", "price"] }`. Routerly proposes and
imports only models that carry it. Never write it by hand.

An unattended or scheduled session (no person answering) never commits and never pushes here. It
reports what it found instead.

## Daily job

A job run by the maintainer once a day:

- reads the official pricing and model pages, and applies a value only when the page states it;
- verifies models with a real call and the official price, and sets or removes `verified`;
- removes models that the provider no longer serves;
- updates the files in place, with checksums, `updatedAt` and `capabilities-sources.json`;
- runs the checks below, and publishes nothing if one fails;
- commits to `main`. It creates no branches.

## Updating the catalog

For a manual change (a price, a deprecation, a new provider key):

1. Edit the file that `channels.stable` names. If `channels.next` names another file, apply the change
   there too.
2. Recompute the checksum and bump `updatedAt`:

   ```bash
   node scripts/catalog.mjs sync-checksum providers/providers.YYYYMMDDHHMMSS.json
   ```

3. Run both checks (see [Validation](#validation)) and push to `main`.

`scripts/catalog.mjs` also has `current-file`, `deprecate`, `add-provider`, `set-price` and
`add-model`. The last two refuse to run unless `ROUTERLY_CATALOG_VERIFIED=1` states that you verified
the value.

Rules:

- Never rename or remove a provider key: operator configurations use it.
- Do not delete a model by hand. Set `"deprecated": true`: existing configurations keep working and the
  model is hidden from new projects. Only the daily job removes models, after verification shows the
  provider no longer serves them.
- Prices are USD per 1 million tokens, read on the official page (URLs in [SCHEMA.md](SCHEMA.md)),
  never from memory.
- Every capability value needs a source in `capabilities-sources.json`. An absent flag means unknown.
- English only. No notes or status text in the catalog files.

## Model entry format

The root of a catalog file is `{ [providerKey]: ProviderEntry }`. Models are listed newest first.

```jsonc
{
  "openai": {
    "endpoint": "https://api.openai.com/v1",
    "models": [
      {
        "id": "model-id",              // exact id sent to the provider API (required)
        "input": 2.5,                  // USD per 1M input tokens (required)
        "output": 10,                  // USD per 1M output tokens (required)
        "cache": 1.25,                 // USD per 1M cached input tokens
        "cacheWrite": 3.1,             // USD per 1M cache-write tokens
        "contextWindow": 128000,
        "deprecated": false,
        "capabilities": { "vision": true, "functionCalling": true },
        "pricingTiers": [
          { "metric": "context_tokens", "above": 200000, "input": 5.0, "output": 15.0 }
        ],
        "verified": { "at": "2026-11-27", "how": ["call", "type", "price"] }
      }
    ]
  }
}
```

Full reference: [SCHEMA.md](SCHEMA.md).

## Provider keys

A key here only affects what the Routerly interface offers. The Routerly service must also have the
matching adapter, so a version without it cannot use the provider.

| Key | Provider |
|-----|----------|
| `openai` | OpenAI |
| `anthropic` | Anthropic |
| `anthropic-oauth` | Anthropic via Claude.ai OAuth |
| `openai-oauth` | OpenAI via ChatGPT OAuth |
| `gemini` | Google Gemini (OpenAI-compatible) |
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
| `ollama-cloud` | Ollama Cloud (ollama.com, Bearer API key). Only in the `next` file |
| `custom` | User-defined endpoint |
| `azure-openai` | Azure OpenAI |
| `bedrock` | AWS Bedrock |
| `vertex` | Google Vertex AI |

Do not change `endpoint` of `azure-openai`, `bedrock`, `vertex` or `custom`: operators set it for their
own deployment.

## Validation

CI runs the same checks. Run them before pushing:

```bash
node scripts/validate.mjs validate        # JSON, checksums, schema
node scripts/check-capabilities.mjs       # capability values and context windows have a source
node scripts/validate.mjs resolve 0.6.0   # the file a Routerly version reads
node scripts/validate.mjs resolve 0.6.1 next
```

## Multiple repos

Routerly can read several provider repositories. Each is fetched on its own and they are merged; the
one listed first wins on conflict. Operators can add their own (a private GitHub repository or any
raw HTTP server) to add internal models.
