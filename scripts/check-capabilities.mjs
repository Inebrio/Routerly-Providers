#!/usr/bin/env node
// Validates model `capabilities` in a catalog file against SCHEMA.md and capabilities-sources.json.
// Usage: node scripts/check-capabilities.mjs [catalog.json] [sources.json]   (defaults: index.json stable file, capabilities-sources.json)
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const catalogPath = process.argv[2] ?? root + read(root + 'index.json').channels.stable;
const sources = read(process.argv[3] ?? root + 'capabilities-sources.json');
const catalog = read(catalogPath);

const schema = readFileSync(root + 'SCHEMA.md', 'utf8').split('## ModelCapabilities')[1].split('\n## ')[0];
const rows = [...schema.matchAll(/^\|\s*`(\w+)`\s*\|(.*)\|\s*$/gm)];
const known = new Set(rows.map((m) => m[1]));
const derived = new Set(rows.filter((m) => /not declared/i.test(m[2])).map((m) => m[1]));

const errors = [];
const seen = new Set();
const ctxSeen = new Set();
for (const [prov, entry] of Object.entries(catalog)) {
  for (const m of entry.models) {
    // contextWindow: every active chat model needs the value; a source entry (value + https + date) is validated when present,
    // and a model with no value needs an explicit, reasoned { unavailable, checked } entry.
    const cs = sources[prov]?.[m.id]?.contextWindow;
    if (cs) ctxSeen.add(`${prov}/${m.id}`);
    const chat = !m.deprecated && !m.capabilities?.embedding && !/embed/i.test(m.id);
    const at = `${prov}/${m.id}.contextWindow`;
    if (chat && !m.contextWindow && !cs) errors.push(`${at}: chat model without contextWindow (add it with a source, or an "unavailable" reason in capabilities-sources.json)`);
    if (m.contextWindow !== undefined && (!Number.isInteger(m.contextWindow) || m.contextWindow <= 0)) errors.push(`${at}: must be a positive integer`);
    if (cs) {
      if (cs.unavailable !== undefined) { if (!String(cs.unavailable).trim() || m.contextWindow) errors.push(`${at}: "unavailable" needs a reason and a model without contextWindow`); }
      else {
        if (cs.value !== m.contextWindow) errors.push(`${at}: source value ${cs.value} differs from catalog value ${m.contextWindow}`);
        if (!/^https:\/\/\S+$/.test(cs.source ?? '')) errors.push(`${at}: source must be an https URL`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cs.checked ?? '')) errors.push(`${at}: checked must be YYYY-MM-DD`);
    }
    for (const [flag, val] of Object.entries(m.capabilities ?? {})) {
      const at = `${prov}/${m.id}.${flag}`;
      seen.add(at);
      if (!known.has(flag)) errors.push(`${at}: unknown flag`);
      else if (derived.has(flag)) errors.push(`${at}: flag is derived by Routerly, never declared`);
      if (typeof val !== 'boolean') errors.push(`${at}: value must be boolean, got ${typeof val}`);
      const s = sources[prov]?.[m.id]?.[flag];
      if (!s) { if (!m.deprecated) errors.push(`${at}: no source`); continue; }
      if (s.value !== val) errors.push(`${at}: source value ${s.value} differs from catalog value ${val}`);
      if (!/^https:\/\/\S+$/.test(s.source ?? '')) errors.push(`${at}: source must be an https URL`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.checked ?? '')) errors.push(`${at}: checked must be YYYY-MM-DD`);
    }
  }
}
for (const [prov, models] of Object.entries(sources))
  for (const [id, flags] of Object.entries(models))
    for (const flag of Object.keys(flags))
      if (flag === 'contextWindow') { if (!ctxSeen.has(`${prov}/${id}`)) errors.push(`${prov}/${id}.contextWindow: source without catalog model`); }
      else if (!seen.has(`${prov}/${id}.${flag}`)) errors.push(`${prov}/${id}.${flag}: source without catalog value`);

if (errors.length) { console.error(errors.join('\n')); console.error(`${errors.length} error(s)`); process.exit(1); }
console.log(`ok  ${seen.size} capability values, ${ctxSeen.size} context sources, all sourced`);
