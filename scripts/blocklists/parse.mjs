// Format-specific parsers: raw source text -> array of raw hostnames (not yet normalized to
// eTLD+1 — see normalize.mjs for that step).

import { fetchText, fetchTarFile } from './fetch.mjs';

function linesOf(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function parseDomains(text) {
  return linesOf(text).filter((l) => !l.startsWith('#') && !l.startsWith('!'));
}

function parseHosts(text) {
  const out = [];
  for (const line of linesOf(text)) {
    if (line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [ip, host] = parts;
    if (ip === '0.0.0.0' || ip === '127.0.0.1') out.push(host);
  }
  return out;
}

function parseAdblock(text) {
  const out = [];
  for (const line of linesOf(text)) {
    if (!line.startsWith('||')) continue; // skip comments, exceptions (@@), cosmetic (##/#@#) rules
    const match = /^\|\|([a-z0-9.-]+)\^?/i.exec(line);
    if (match) out.push(match[1]);
  }
  return out;
}

function parseSquidguardTar(source) {
  const text = fetchTarFile(source.url, `${source.category}/domains`);
  return parseDomains(text);
}

function parseBonAppetitMeta(source) {
  // meta.json shape: { blocklist: { raw_url, ... }, allowlist: { raw_url, ... } }
  const meta = JSON.parse(fetchText(source.metaUrl));
  const blockUrl = meta.blocklist?.raw_url;
  const allowUrl = meta.allowlist?.raw_url;
  if (!blockUrl) throw new Error('bon-appetit meta.json: could not find blocklist.raw_url');
  const block = new Set(parseDomains(fetchText(blockUrl)));
  const allow = allowUrl ? parseDomains(fetchText(allowUrl)) : [];
  for (const domain of allow) block.delete(domain);
  return [...block];
}

/** Fetches and parses one source descriptor into an array of raw hostnames. */
export function parseSource(source) {
  switch (source.kind) {
    case 'domains':
      return parseDomains(fetchText(source.url));
    case 'hosts':
      return parseHosts(fetchText(source.url));
    case 'adblock':
      return parseAdblock(fetchText(source.url));
    case 'squidguard-tar':
      return parseSquidguardTar(source);
    case 'bon-appetit-meta':
      return parseBonAppetitMeta(source);
    default:
      throw new Error(`unknown source kind: ${source.kind}`);
  }
}
