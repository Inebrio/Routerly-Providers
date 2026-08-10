#!/usr/bin/env node
// driver.mjs — mechanical half of the catalog-update workflow described in
// root CLAUDE.md / README.md ("Updating the catalog"). Handles the parts that
// are pure bookkeeping (edit -> checksum -> index.json -> validate) so an
// agent only has to supply the actual price/model research.
//
// The RESEARCH part (checking official pricing pages) is NOT in this script —
// no driver can know a live price. Fetch the URL from SCHEMA.md's pricing
// source table yourself (WebFetch/WebSearch), then use these commands to
// apply what you found.
//
// Subcommands:
//   node driver.mjs current-file                          # print the file "stable" channel resolves to
//   node driver.mjs set-price <provider> <modelId> <field> <value>   # field: input|output|cache|cacheWrite
//   node driver.mjs add-model <provider> <model.json>      # prepend a model (newest-first); model.json = one ModelEntry object
//   node driver.mjs deprecate <provider> <modelId>         # set deprecated:true
//   node driver.mjs add-provider <key> <endpoint>          # append new provider key with empty models[]
//   node driver.mjs sync-checksum [file]                   # recompute sha256, patch index.json (checksum + updatedAt); defaults to current stable file
//
// Every mutating command auto-runs sync-checksum on the file it touched, then
// re-validates. Nothing here fetches prices — that judgment call stays with
// the calling agent.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..", "..", "..");
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
  return index.channels?.[index.default];
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
    console.error(`FAIL  unknown provider key "${provider}" (provider keys are never renamed/added ad hoc — check CLAUDE.md's Provider keys table)`);
    process.exit(1);
  }
  const model = data[provider].models.find((m) => m.id === modelId);
  if (!model) {
    console.error(`FAIL  no model "${modelId}" under "${provider}"`);
    process.exit(1);
  }
  return model;
}

function cmdSetPrice(provider, modelId, field, value) {
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
  const index = readJSON(INDEX);
  const file = currentStableFile(index);
  const data = readJSON(file);
  if (!data[provider]) {
    console.error(`FAIL  unknown provider key "${provider}". To add a NEW provider key use: node driver.mjs add-provider <key> <endpoint>`);
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
  console.log(`      must also implement the adapter for "${key}", and CLAUDE.md's Provider keys`);
  console.log(`      table should be updated to document it.`);
  syncChecksum(file);
  validate(file);
}

function validate(file) {
  const runProvidersDriver = path.join(ROOT, ".claude", "skills", "run-providers", "driver.mjs");
  if (!existsSync(runProvidersDriver)) {
    console.log("(skip) run-providers skill not present, skipping full validation");
    return;
  }
  try {
    const out = execFileSync("node", [runProvidersDriver, "validate"], { cwd: ROOT, encoding: "utf8" });
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
      "usage: node driver.mjs <current-file|set-price|add-model|deprecate|add-provider|sync-checksum> ..."
    );
    process.exit(2);
}
