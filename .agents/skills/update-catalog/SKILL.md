---
name: update-catalog
description: Update the Routerly provider catalog — refresh model prices, add new models, deprecate old ones, add a provider key — following the workflow in root AGENTS.md/README.md. Use for "update prices", "add a model", "deprecate model", "refresh catalog", "sync checksum", "add provider".
---

Paths below are relative to the repo root (`<unit>` = this repo).

Two halves to a catalog update: **research** (what did the price/model
actually change to — an agent judgment call, not scriptable) and
**mechanics** (edit → recompute checksum → patch `index.json` → validate —
fully scriptable, easy to get wrong by hand). This skill's driver does the
mechanics; you do the research.

## Run (agent path)

### 1. Research — do this yourself, not the driver

Per root `AGENTS.md`/`README.md`: check the model's **official pricing page**
before touching a number — never from memory. URLs are in `SCHEMA.md`'s
"Official pricing sources" table (OpenAI, Anthropic, Gemini, Mistral, Cohere,
xAI, DeepSeek, Groq, Together, Perplexity, Bedrock, Vertex). Fetch the page
(WebFetch/WebSearch), convert to **USD per 1M tokens**.

### 2. Apply — the driver

```bash
node .Codex/skills/update-catalog/driver.mjs current-file
```
Prints the file the `stable` channel currently resolves to — this is the
file every command below edits (per AGENTS.md's "mutable" update path; no
new timestamped file needed for routine changes).

**Update a price:**
```bash
node .Codex/skills/update-catalog/driver.mjs set-price <provider> <modelId> <field> <value>
# field: input | output | cache | cacheWrite
node .Codex/skills/update-catalog/driver.mjs set-price openai gpt-5.5 input 5.25
```

**Add a new model** (prepended — newest-first convention):
```bash
cat > /tmp/model.json <<'EOF'
{ "id": "gpt-6", "input": 3, "output": 15, "contextWindow": 400000, "notes": "..." }
EOF
node .Codex/skills/update-catalog/driver.mjs add-model openai /tmp/model.json
```
Minimum fields: `id`, `input`, `output`. Refuses if the id already exists
(edit with `set-price` or retire with `deprecate` instead — never duplicate
an id).

**Retire a model** (never delete — AGENTS.md's golden rule):
```bash
node .Codex/skills/update-catalog/driver.mjs deprecate openai gpt-4o
```

**Add a new provider key** (catalog side only — see note the command prints):
```bash
node .Codex/skills/update-catalog/driver.mjs add-provider my-new-provider https://api.example.com/v1
```

Every mutating command **automatically**: recomputes the file's SHA-256,
patches `index.json`'s `checksum.sha256` + `updatedAt`, then re-runs the
[run-providers](../run-providers/SKILL.md) `validate` check and prints its
PASS/FAIL line. If validation fails, the command exits 1 — fix before
committing.

To resync the checksum after a manual edit (skip the driver, edit JSON by
hand):
```bash
node .Codex/skills/update-catalog/driver.mjs sync-checksum
```

### 3. Commit

Diff `index.json` + the catalog file together, commit both. A checksum
update with no corresponding content change (or vice versa) is a bug.

## Run (human path)

Same as agent path — there's no separate UI. `set-price`/`add-model`/etc.
are the whole interface; a human runs the identical commands.

## Gotchas

- The driver always edits whatever `channels[default]` resolves to (i.e.
  `stable`) — it never targets `latest` or a version-pinned file directly.
  If you're cutting a **new** timestamped file for a breaking change (the
  "only when needed" path in AGENTS.md), do that copy/repoint by hand first,
  then point the driver at it with `sync-checksum <newfile>` — there's no
  `new-file` subcommand; that path is rare enough it isn't worth automating.
- `add-model`/`set-price`/`deprecate` all resolve the provider+model against
  the **current file on disk**, not a cached copy — if you hand-edit the
  JSON between driver calls that's fine, it re-reads every time.
- Validation step silently no-ops if the `run-providers` skill isn't present
  (`(skip) run-providers skill not present`) — this repo has it, so you'll
  always see a real PASS/FAIL line.
- `set-price`/`add-model`/`deprecate`/`add-provider` all bump
  `index.json`'s `updatedAt` for the file, even though only one field
  changed inside a huge JSON — that's intentional per the checksum-registry
  contract, not a bug.

## Troubleshooting

- `FAIL  unknown provider key "X"` — key doesn't exist in the catalog root.
  Provider keys are never invented ad hoc; check AGENTS.md's Provider keys
  table, or use `add-provider` if it's genuinely new (and update the docs
  table + implement the Routerly-side adapter separately).
- `FAIL  model id "X" already exists under "Y"` from `add-model` — you meant
  `set-price` (edit) or `deprecate` (retire), not `add-model`.
- `FAIL  value "X" is not a number` from `set-price` — prices are numeric
  USD/1M tokens, not strings.
- `FAIL  validation failed after edit` — the edit produced invalid JSON/
  schema; driver prints the [run-providers](../run-providers/SKILL.md)
  validate output above the failure, fix per that.
