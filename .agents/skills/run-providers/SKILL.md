---
name: run-providers
description: Run, validate, and simulate resolution of the Routerly provider catalog (index.json + providers/*.json). Use for "run the catalog", "validate providers", "check checksums", "simulate Routerly resolution", "test provider JSON", "screenshot" (n/a — no UI).
---

Paths below are relative to the repo root (`<unit>` = this repo).

This repo is **not an app** — no server, no CLI, no GUI. It's a static JSON
catalog that Routerly fetches at runtime over plain HTTP: `GET index.json`,
resolve version/channel → file path, `GET <file>`, verify sha256, `JSON.parse`.
There's nothing to launch. The way to "run" this repo is to replay that exact
sequence — which is what the driver does.

## Run (agent path)

```bash
node .Codex/skills/run-providers/driver.mjs validate
```

Does everything CI does, plus what CI doesn't:
- parses every `*.json` file in the repo
- verifies every `index.json` → `providers` registry checksum against the
  actual file on disk (CI's `validate.yml` only parses JSON — it never checks
  checksums)
- verifies every `channels`/`versions` target exists in the registry
- schema-checks every `providers/*.json` catalog: required fields
  (`endpoint`, `models[].id`, `.input`, `.output`), duplicate model ids,
  `pricingTiers[]` field types

Exit 0 + `PASS  all checks green` = safe to commit. Exit 1 + itemized errors
otherwise.

To simulate what a specific Routerly build actually receives:

```bash
node .Codex/skills/run-providers/driver.mjs resolve <version> [channel]
```

Example:

```bash
$ node .Codex/skills/run-providers/driver.mjs resolve 0.3.2 stable
GET index.json
  routerly version=0.3.2 channel=stable
  resolved via versions -> providers/providers.20260703170500.json
GET providers/providers.20260703170500.json
  sha256 verified: 43ec6d0ad9b9570a26b8199e1c2871de80684abeeceb22f072568abf05409f9c
  parsed OK: 19 providers, 131 models
PASS  resolution for version=0.3.2 channel=stable -> providers/providers.20260703170500.json
```

Channel defaults to `index.json`'s `"default"` if omitted. Resolution order
mirrors Routerly's own: `versions` (semver `^range`, most specific wins) →
`channels[channel]` → `channels[default]`.

Use `resolve` after editing `index.json` (new version range, repointed
channel, new file) to confirm a given Routerly version actually lands on the
file you intended — before pushing.

## Run (human path)

None — no server or window to open. `validate`/`resolve` above *is* the
run path.

## After editing the catalog

1. Edit `providers/providers.YYYYMMDDHHMMSS.json` (see root `AGENTS.md` for
   the mutable-file-update workflow).
2. `node .Codex/skills/run-providers/driver.mjs validate` — if it fails on
   a checksum mismatch, that's expected (you just edited the file); update
   `index.json`'s checksum:
   ```bash
   shasum -a 256 providers/providers.YYYYMMDDHHMMSS.json
   ```
3. Re-run `validate` until it's green, then `resolve <version>` for any
   version range you touched.

## Gotchas

- `driver.mjs resolve` only implements `^range` semver matching (the only
  syntax `index.json`'s `versions` map uses per `AGENTS.md`) — it throws
  `unsupported range syntax` on anything else (`~`, `>=`, exact pins). If you
  introduce a new range syntax, extend `satisfiesCaret` in the driver first.
- CI (`.github/workflows/validate.yml`) only does `JSON.parse` — it will pass
  on a stale checksum or a missing required field. `driver.mjs validate` is
  strictly stronger; treat it as the real gate, not CI.
- The driver reads files straight from the working tree (no HTTP, no clone)
  — it validates what you're about to commit, not what's already pushed to
  `main`. Run it again after `git pull` if you want to check upstream state.

## Troubleshooting

- `FAIL ... checksum mismatch for <file> (index=... actual=...)` — you edited
  the catalog file without updating `index.json`. Recompute with
  `shasum -a 256 <file>` and paste the hex into `providers.<file>.checksum.sha256`.
- `FAIL ... models[N]: input required (number)` (or `output`, or `id`) — a
  model entry is missing a required field or has the wrong type (e.g. a
  price given as a string).
- `FAIL ... duplicate model id "X"` — same `id` appears twice in one
  provider's `models[]`; the newest entry should have replaced the old one,
  not been prepended alongside it (see root `AGENTS.md`: "never delete a
  model — set `deprecated: true`" — that means edit in place, not duplicate).
- `unsupported range syntax: ...` from `resolve` — `index.json.versions` has
  a range key that isn't `^x.y.z`; either fix the key or extend the driver.
