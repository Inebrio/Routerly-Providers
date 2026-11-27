#!/usr/bin/env node
// validate.mjs — reads this catalog the way Routerly does: `GET index.json` -> pick the file ->
// `GET <file>` -> verify sha256 -> JSON.parse. Run by CI and by the daily job.
//
//   node scripts/validate.mjs validate                    # JSON, checksums and schema of the whole repository
//   node scripts/validate.mjs resolve <version> [channel] # which file a Routerly version reads

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

function readJSON(relPath) {
  const abs = path.join(ROOT, relPath);
  return JSON.parse(readFileSync(abs, "utf8"));
}

function sha256(relPath) {
  const abs = path.join(ROOT, relPath);
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

// --- the semver ranges the `versions` map uses: ">=a.b.c[-0]", "<a.b.c[-0]", "^a.b.c" ---
function parseVer(v) {
  const [core, pre] = v.split(/-(.*)/);
  const [maj, min, pat] = core.split(".").map((n) => parseInt(n, 10));
  return { nums: [maj, min ?? 0, pat ?? 0], pre: pre ?? null };
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}
function satisfies(version, range) {
  const v = parseVer(version);
  const parts = range.trim().split(/\s+/).map((part) => {
    const m = part.match(/^(>=|<|\^)(\d.*)$/);
    if (!m) throw new Error(`unsupported range syntax: ${range}`);
    return { op: m[1], ver: parseVer(m[2]) };
  });
  // as in npm: a pre-release matches only a range that names a pre-release of the same version
  if (v.pre !== null && !parts.some((p) => p.ver.pre !== null && p.ver.nums.join() === v.nums.join())) return false;
  return parts.every(({ op, ver }) => {
    if (op === ">=") return compare(v, ver) >= 0;
    if (op === "<") return compare(v, ver) < 0;
    const locked = ver.nums[0] === 0 ? 2 : 1; // ^0.x locks the minor too
    return compare(v, ver) >= 0 && v.nums.slice(0, locked).join() === ver.nums.slice(0, locked).join();
  });
}

// --- schema validation (SCHEMA.md field reference, structural subset) ---
const VERIFIED_HOW = ["call", "type", "price"];
function isVerifiedRecord(v) {
  return typeof v?.at === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.at) &&
    Array.isArray(v.how) && v.how.length > 0 && v.how.every((h) => VERIFIED_HOW.includes(h));
}

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
      // price not published: both absent (never write 0 for an unknown price)
      if (model.input !== undefined || model.output !== undefined) {
        if (typeof model.input !== "number") errors.push(`${mp}: input must be a number, together with output`);
        if (typeof model.output !== "number") errors.push(`${mp}: output must be a number, together with input`);
      }
      if (model.verified !== undefined && !isVerifiedRecord(model.verified)) {
        errors.push(`${mp}: verified must be {at: "YYYY-MM-DD", how: [call|type|price]}`);
      }
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
      if (name.name.startsWith(".") || name.name === "node_modules") continue;
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

// Same order as Routerly: the channel the operator set, else `default`; `versions` only when neither names a file.
function resolveFile(index, version, channel) {
  const name = channel ?? index.default;
  if (name && index.channels?.[name]) return { file: index.channels[name], via: `channels.${name}` };
  const match = Object.entries(index.versions || {}).find(([range]) => satisfies(version, range));
  if (match) return { file: match[1], via: `versions["${match[0]}"]` };
  if (index.default && index.channels?.[index.default]) return { file: index.channels[index.default], via: `channels.${index.default}` };
  return null;
}

function cmdResolve(version, channel) {
  if (!version) {
    console.error("usage: node scripts/validate.mjs resolve <version> [channel]");
    process.exit(2);
  }
  const index = readJSON("index.json");
  console.log(`routerly version=${version} channel=${channel ?? "(not set)"}`);
  const found = resolveFile(index, version, channel);
  if (!found) {
    console.log(`FAIL  no file for version=${version}`);
    process.exit(1);
  }
  const { file, via } = found;
  console.log(`  resolved via ${via} -> ${file}`);
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
  const keys = Object.keys(data);
  console.log(`  parsed OK: ${keys.length} providers, ${keys.reduce((n, k) => n + (data[k].models?.length || 0), 0)} models`);
  console.log(`PASS  resolution for version=${version} -> ${file}`);
}

const [, , cmd, a1, a2] = process.argv;
if (cmd === "validate") cmdValidate();
else if (cmd === "resolve") cmdResolve(a1, a2);
else {
  console.error("usage: node scripts/validate.mjs validate | node scripts/validate.mjs resolve <version> [channel]");
  process.exit(2);
}
