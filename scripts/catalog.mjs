#!/usr/bin/env node
// catalog.mjs — the bookkeeping of a manual catalog edit (README.md, "Updating the catalog"):
// edit -> checksum -> index.json -> validate. Prices are not looked up here: read the official
// pricing page (URLs in SCHEMA.md) and pass the value.
//
// Subcommands:
//   node scripts/catalog.mjs current-file                          # print the file the "stable" channel resolves to
//   node scripts/catalog.mjs set-price <provider> <modelId> <field> <value>   # field: input|output|cache|cacheWrite
//   node scripts/catalog.mjs add-model <provider> <model.json>      # prepend a model (newest-first); model.json = one ModelEntry object
//   node scripts/catalog.mjs deprecate <provider> <modelId>         # set deprecated:true
//   node scripts/catalog.mjs add-provider <key> <endpoint>          # append new provider key with empty models[]
//   node scripts/catalog.mjs sync-checksum [file]                   # recompute sha256, patch index.json (checksum + updatedAt); defaults to the stable file
//
// Every mutating command runs sync-checksum on the file it touched, then validates.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const INDEX = "index.json";

function readJSON(relPath) {
  return JSON.parse(readFileSync(path.join(ROOT, relPath), "utf8"));
}
function writeJSON(relPath, data) {
  writeFileSync(path.join(ROOT, relPath), JSON.stringify(data, null, 2) + "\n");
}
function sha256(relPath) {
  return createHash("sha256").update(readFileSync(path.join(ROOT, relPath))).digest("hex");
}
function nowISO() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function currentStableFile(index) {
  return index.channels?.stable;
}

function cmdCurrentFile() {
  const index = readJSON(INDEX);
  const file = currentStableFile(index);
  console.log(file);
}

function syncChecksum(file) {
  const index = readJSON(INDEX);
  if (!index.providers?.[file]) {
    console.error(`FAIL  ${file} not in index.json "providers" registry — add its entry first`);
    process.exit(1);
  }
  const hash = sha256(file);
  const before = index.providers[file].checksum.sha256;
  index.providers[file].checksum.sha256 = hash;
  index.providers[file].updatedAt = nowISO();
  writeJSON(INDEX, index);
  console.log(`ok    checksum ${file}`);
  console.log(`      ${before} -> ${hash}`);
}

function cmdSyncChecksum(file) {
  const index = readJSON(INDEX);
  file = file || currentStableFile(index);
  syncChecksum(file);
  validate(file);
}

function findModel(data, provider, modelId) {
  if (!data[provider]) {
    console.error(`FAIL  unknown provider key "${provider}" (provider keys are never renamed: see the Provider keys table in README.md)`);
    process.exit(1);
  }
  const model = data[provider].models.find((m) => m.id === modelId);
  if (!model) {
    console.error(`FAIL  no model "${modelId}" under "${provider}"`);
    process.exit(1);
  }
  return model;
}

// New models and prices need the verification first; the variable states that the caller has it.
function requireVerified(cmd) {
  if (process.env.ROUTERLY_CATALOG_VERIFIED === "1") return;
  console.error(`FAIL  ${cmd} needs a verified source: new models and prices go through the verification`);
  console.error(`      ("npm run verify:catalog" in the Routerly repo, see "Verified changes only" in README.md).`);
  console.error(`      Unattended or scheduled run: stop here, do not edit, commit or push.`);
  process.exit(1);
}

function cmdSetPrice(provider, modelId, field, value) {
  requireVerified("set-price");
  const allowed = ["input", "output", "cache", "cacheWrite"];
  if (!allowed.includes(field)) {
    console.error(`FAIL  field must be one of: ${allowed.join(", ")}`);
    process.exit(1);
  }
  const index = readJSON(INDEX);
  const file = currentStableFile(index);
  const data = readJSON(file);
  const model = findModel(data, provider, modelId);
  const num = Number(value);
  if (Number.isNaN(num)) {
    console.error(`FAIL  value "${value}" is not a number (prices are USD per 1M tokens)`);
    process.exit(1);
  }
  const before = model[field];
  model[field] = num;
  writeJSON(file, data);
  console.log(`ok    ${file}: ${provider}.${modelId}.${field} ${before ?? "(unset)"} -> ${num}`);
  syncChecksum(file);
  validate(file);
}

function cmdAddModel(provider, modelJsonPath) {
  requireVerified("add-model");
  const index = readJSON(INDEX);
  const file = currentStableFile(index);
  const data = readJSON(file);
  if (!data[provider]) {
    console.error(`FAIL  unknown provider key "${provider}". To add a NEW provider key use: node scripts/catalog.mjs add-provider <key> <endpoint>`);
    process.exit(1);
  }
  const modelAbs = path.isAbsolute(modelJsonPath) ? modelJsonPath : path.join(process.cwd(), modelJsonPath);
  const model = JSON.parse(readFileSync(modelAbs, "utf8"));
  if (!model.id || typeof model.input !== "number" || typeof model.output !== "number") {
    console.error(`FAIL  model.json must have id (string), input (number), output (number) at minimum`);
    process.exit(1);
  }
  const existing = data[provider].models.find((m) => m.id === model.id);
  if (existing) {
    console.error(`FAIL  model id "${model.id}" already exists under "${provider}". Use set-price to edit it or deprecate to retire it — never duplicate an id.`);
    process.exit(1);
  }
  data[provider].models.unshift(model); // newest-first convention
  writeJSON(file, data);
  console.log(`ok    ${file}: prepended ${provider}.${model.id}`);
  syncChecksum(file);
  validate(file);
}

function cmdDeprecate(provider, modelId) {
  const index = readJSON(INDEX);
  const file = currentStableFile(index);
  const data = readJSON(file);
  const model = findModel(data, provider, modelId);
  if (model.deprecated === true) {
    console.log(`ok    ${provider}.${modelId} already deprecated, nothing to do`);
    return;
  }
  model.deprecated = true;
  writeJSON(file, data);
  console.log(`ok    ${file}: ${provider}.${modelId}.deprecated -> true`);
  syncChecksum(file);
  validate(file);
}

function cmdAddProvider(key, endpoint) {
  const index = readJSON(INDEX);
  const file = currentStableFile(index);
  const data = readJSON(file);
  if (data[key]) {
    console.error(`FAIL  provider key "${key}" already exists`);
    process.exit(1);
  }
  data[key] = { endpoint, models: [] };
  writeJSON(file, data);
  console.log(`ok    ${file}: added provider key "${key}" (endpoint=${endpoint || "(empty)"})`);
  console.log(`      remember: this only affects the Routerly UI dropdown. The Routerly service`);
  console.log(`      must also implement the adapter for "${key}", and the Provider keys table`);
  console.log(`      in README.md must list it.`);
  syncChecksum(file);
  validate(file);
}

function validate(file) {
  try {
    const out = execFileSync("node", [path.join(ROOT, "scripts", "validate.mjs"), "validate"], { cwd: ROOT, encoding: "utf8" });
    console.log(out.trim().split("\n").slice(-1)[0]); // just the PASS/FAIL summary line
  } catch (e) {
    console.log(e.stdout || e.message);
    console.error("FAIL  validation failed after edit — see above");
    process.exit(1);
  }
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "current-file":
    cmdCurrentFile();
    break;
  case "set-price":
    cmdSetPrice(...rest);
    break;
  case "add-model":
    cmdAddModel(...rest);
    break;
  case "deprecate":
    cmdDeprecate(...rest);
    break;
  case "add-provider":
    cmdAddProvider(...rest);
    break;
  case "sync-checksum":
    cmdSyncChecksum(rest[0]);
    break;
  default:
    console.error(
      "usage: node scripts/catalog.mjs <current-file|set-price|add-model|deprecate|add-provider|sync-checksum> ..."
    );
    process.exit(2);
}
