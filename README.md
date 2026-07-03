# Routerly Providers

Provider catalog for [Routerly](https://github.com/Inebrio/Routerly) — models, pricing, endpoints.

Routerly fetches this catalog at runtime via plain HTTP GET to the GitHub raw content URL. No git clone, no database.

---

## How it works

1. Routerly fetches `index.json`
2. Resolves the right catalog file based on its version or configured channel
3. Fetches that file, verifies the SHA-256 checksum, and uses it

---

## Structure

```
index.json                          # Version/channel map + checksum registry
providers/
  providers.YYYYMMDDHHMMSS.json     # Immutable catalog snapshots (UTC timestamp)
SCHEMA.md                           # Field reference + pricing source URLs
CLAUDE.md                           # Instructions for AI agents
```

---

## index.json

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
      "updatedAt": "2026-07-03T17:05:00Z",
      "checksum": { "sha256": "..." }
    }
  }
}
```

### Version resolution

`versions` keys are semver ranges (same syntax as `package.json`). Routerly evaluates all ranges against its own version and picks the most specific match:

| Routerly version | Matching range | Catalog |
|-----------------|----------------|---------|
| `0.3.0` | `^0.3.0` | providers.20260703170500.json |
| `0.3.5` | `^0.3.0` | providers.20260703170500.json |
| `0.4.0` | `^0.4.0` | providers.future.json |

If no version range matches, Routerly falls back to the configured channel, then to `default`.

### Channels

`stable` — tested, updated infrequently.
`latest` — edge additions, may include models not yet broadly available.

Operators choose: pin to a version range (reproducibility) or follow a channel (always current).

---

## Updating the catalog

### Update model prices or add a model

Edit the relevant file in `providers/`. No `index.json` change needed unless you want to cut a new snapshot.

### Cut a new catalog snapshot

```bash
# 1. Copy the current catalog to a new timestamped file
cp providers/providers.20260703170500.json providers/providers.YYYYMMDDHHMMSS.json

# 2. Edit the new file with your changes

# 3. Compute the checksum
shasum -a 256 providers/providers.YYYYMMDDHHMMSS.json

# 4. Update index.json:
#    - Point the relevant version range / channel to the new file
#    - Add the new file to the "providers" registry with createdAt, updatedAt, checksum
```

Old files stay in the repo. Rollback = update `index.json` to repoint.

---

## Multiple repos

Routerly supports multiple provider repos. Each is fetched independently and merged. The repo listed first takes precedence on conflict.

Operators can add private repos (self-hosted GitHub or raw HTTP) to extend the public catalog with internal models.

---

## JSON format

See [SCHEMA.md](SCHEMA.md) for the full field reference and pricing source URLs.
