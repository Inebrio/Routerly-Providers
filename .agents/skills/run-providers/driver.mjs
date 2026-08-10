#!/usr/bin/env node
// driver.mjs — simulates Routerly's runtime consumption of this catalog repo.
// Repo has no server/GUI/CLI of its own: Routerly just does
// `GET index.json` -> resolve version/channel -> `GET <file>` -> verify sha256 -> JSON.parse.
// This script performs exactly that sequence against the local working tree so an
// agent can "run" the catalog and see resolution + integrity + schema checks pass/fail.
//
// Usage:
//   node driver.mjs validate                 # full repo validation (JSON, checksums, schema)
//   node driver.mjs resolve <version> [channel]   # simulate Routerly's file resolution
//
// Examples:
//   node driver.mjs validate
//   node driver.mjs resolve 0.3.2 stable
//   node driver.mjs resolve 0.3.2            # channel defaults to index.json's "default"

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..", "..");

function readJSON(relPath) {
  const abs = path.join(ROOT, relPath);
  return JSON.parse(readFileSync(abs, "utf8"));
}

function sha256(relPath) {
  const abs = path.join(ROOT, relPath);
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

// --- minimal npm-style ^range satisfaction (only what this repo's versions map uses) ---
function parseVer(v) {
  const [maj, min, pat] = v.split(".").map((n) => parseInt(n, 10));
  return { maj, min: min ?? 0, pat: pat ?? 0 };
}
function satisfiesCaret(version, range) {
  if (!range.startsWith("^")) throw new Error(`unsupported range syntax: ${range}`);
  const r = parseVer(range.slice(1));
  const v = parseVer(version);
  if (v.maj !== r.maj) return false;
  if (v.maj === 0) {
    // ^0.x.y is narrower: locks minor too (npm semantics)
    if (v.min !== r.min) return false;
    return v.pat >= r.pat;
  }
  if (v.min < r.min) return false;
  if (v.min === r.min) return v.pat >= r.pat;
  return true;
}
function specificity(range) {
  // more dotted segments in the range = more specific match wins
  return range.replace(/^\^/, "").split(".").length;
}

function resolveVersion(index, version) {
  const matches = Object.entries(index.versions || {}).filter(([range]) =>
    satisfiesCaret(version, range)
  );
  if (!matches.length) return null;
  matches.sort((a, b) => specificity(b[0]) - specificity(a[0]));
  return matches[0][1];
}

// --- schema validation (SCHEMA.md field reference, structural subset) ---
function validateCatalog(file, data, errors) {
  for (const [providerKey, entry] of Object.entries(data)) {
    const p = `${file}:${providerKey}`;
    if (typeof entry.endpoint !== "string") errors.push(`${p}: endpoint must be a string`);
    if (!Array.isArray(entry.models)) {
      errors.push(`${p}: models must be an array`);
      continue;
    }
    const seenIds = new Set();
    for (const [i, model] of entry.models.entries()) {
      const mp = `${p}.models[${i}]`;
      if (typeof model.id !== "string" || !model.id) errors.push(`${mp}: id required (string)`);
      else if (seenIds.has(model.id)) errors.push(`${mp}: duplicate model id "${model.id}"`);
      else seenIds.add(model.id);
      if (typeof model.input !== "number") errors.push(`${mp}: input required (number)`);
      if (typeof model.output !== "number") errors.push(`${mp}: output required (number)`);
      if (model.pricingTiers) {
        for (const [j, tier] of model.pricingTiers.entries()) {
          const tp = `${mp}.pricingTiers[${j}]`;
          if (tier.metric !== "context_tokens") errors.push(`${tp}: unknown metric "${tier.metric}"`);
          if (typeof tier.above !== "number") errors.push(`${tp}: above required (number)`);
          if (typeof tier.input !== "number") errors.push(`${tp}: input required (number)`);
          if (typeof tier.output !== "number") errors.push(`${tp}: output required (number)`);
        }
      }
    }
  }
}

function cmdValidate() {
  let errors = [];

  // 1. every *.json file in repo must parse
  const jsonFiles = [];
  (function walk(dir) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === ".git" || name.name === "node_modules") continue;
      const full = path.join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith(".json")) jsonFiles.push(path.relative(ROOT, full));
    }
  })(ROOT);

  const parsed = {};
  for (const f of jsonFiles) {
    try {
      parsed[f] = readJSON(f);
      console.log(`ok    parse  ${f}`);
    } catch (e) {
      errors.push(`${f}: JSON parse error: ${e.message}`);
    }
  }

  // 2. index.json checksum registry must match actual file contents
  const index = parsed["index.json"];
  if (index) {
    for (const [file, meta] of Object.entries(index.providers || {})) {
      if (!parsed[file]) {
        errors.push(`index.json: registry references missing file ${file}`);
        continue;
      }
      const actual = sha256(file);
      if (actual !== meta.checksum?.sha256) {
        errors.push(
          `index.json: checksum mismatch for ${file} (index=${meta.checksum?.sha256} actual=${actual})`
        );
      } else {
        console.log(`ok    sha256 ${file}`);
      }
    }
    // every channel/version target must exist in the registry
    for (const [chan, file] of Object.entries(index.channels || {})) {
      if (!index.providers?.[file]) errors.push(`index.json: channel "${chan}" -> ${file} not in providers registry`);
    }
    for (const [range, file] of Object.entries(index.versions || {})) {
      if (!index.providers?.[file]) errors.push(`index.json: version range "${range}" -> ${file} not in providers registry`);
    }
  } else {
    errors.push("index.json missing or failed to parse");
  }

  // 3. schema-validate every catalog file (providers/*.json)
  for (const f of jsonFiles) {
    if (f.startsWith("providers/") && parsed[f]) {
      validateCatalog(f, parsed[f], errors);
    }
  }
  if (!errors.some((e) => e.startsWith("providers/"))) {
    console.log("ok    schema all providers/*.json");
  }

  console.log("");
  if (errors.length) {
    console.log(`FAIL  ${errors.length} error(s):`);
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
  console.log("PASS  all checks green");
}

function cmdResolve(version, channelArg) {
  if (!version) {
    console.error("usage: node driver.mjs resolve <version> [channel]");
    process.exit(2);
  }
  const index = readJSON("index.json");
  const channel = channelArg || index.default;

  console.log(`GET index.json`);
  console.log(`  routerly version=${version} channel=${channel}`);

  // Routerly resolution order per CLAUDE.md: X.Y.Z -> X.Y -> X, then channel, then default.
  let file = resolveVersion(index, version);
  let via = "versions";
  if (!file) {
    file = index.channels?.[channel];
    via = `channels.${channel}`;
  }
  if (!file) {
    file = index.channels?.[index.default];
    via = `channels.${index.default} (default)`;
  }
  if (!file) {
    console.log(`FAIL  no resolution found for version=${version} channel=${channel}`);
    process.exit(1);
  }
  console.log(`  resolved via ${via} -> ${file}`);

  console.log(`GET ${file}`);
  const meta = index.providers?.[file];
  if (!meta) {
    console.log(`FAIL  ${file} not present in index.json "providers" registry`);
    process.exit(1);
  }
  const actual = sha256(file);
  if (actual !== meta.checksum.sha256) {
    console.log(`FAIL  checksum mismatch: expected=${meta.checksum.sha256} actual=${actual}`);
    process.exit(1);
  }
  console.log(`  sha256 verified: ${actual}`);

  const data = readJSON(file);
  const providerKeys = Object.keys(data);
  const modelCount = providerKeys.reduce((n, k) => n + (data[k].models?.length || 0), 0);
  console.log(`  parsed OK: ${providerKeys.length} providers, ${modelCount} models`);
  console.log(`PASS  resolution for version=${version} channel=${channel} -> ${file}`);
}

const [, , cmd, a1, a2] = process.argv;
if (cmd === "validate") cmdValidate();
else if (cmd === "resolve") cmdResolve(a1, a2);
else {
  console.error("usage: node driver.mjs validate | node driver.mjs resolve <version> [channel]");
  process.exit(2);
}
