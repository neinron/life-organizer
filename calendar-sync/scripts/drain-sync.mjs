#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

loadDotEnv(".env");

const target = String(args.target ?? "prod");
const mode = String(args.mode ?? "full");
if (!["full", "changes"].includes(mode)) fail("mode must be full or changes");
const baseUrl = resolveBaseUrl(target, args["base-url"]);
const secret = process.env.SYNC_SECRET;
const limit = readInteger(args.limit ?? process.env.SYNC_LIMIT ?? "10", "limit", 1, 20);
const cleanupLimit = readInteger(args["cleanup-limit"] ?? args.cleanup_limit ?? process.env.SYNC_CLEANUP_LIMIT ?? "20", "cleanup-limit", 0, 20);
const maxRuns = readInteger(args["max-runs"] ?? process.env.SYNC_MAX_RUNS ?? "100", "max-runs", 1, 1000);
const delayMs = readInteger(args["delay-ms"] ?? process.env.SYNC_DELAY_MS ?? "1500", "delay-ms", 0, 60000);

if (!secret) fail("SYNC_SECRET is missing. Run this from the project directory or export SYNC_SECRET first.");

let lastStats = null;
for (let run = 1; run <= maxRuns; run += 1) {
  const stats = await runBatch(baseUrl, secret, limit, cleanupLimit);
  lastStats = stats;
  console.log(formatStats(run, maxRuns, target, stats));

  if (!stats.has_more) {
    console.log(`Sync drain finished for ${target}.`);
    process.exit(0);
  }

  if (run < maxRuns && delayMs > 0) await sleep(delayMs);
}

console.error(`Stopped after ${maxRuns} runs; ${target} still reports has_more=true.`);
if (lastStats) console.error(JSON.stringify(lastStats, null, 2));
process.exit(2);

async function runBatch(baseUrl, secret, limit, cleanupLimit) {
  const url = new URL("/sync", ensureTrailingSlash(baseUrl));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("mode", mode);
  url.searchParams.set("cleanup_limit", String(cleanupLimit));

  let response;
  try {
    response = await fetch(url, { headers: { "X-Sync-Token": secret } });
  } catch (error) {
    fail(`Could not reach ${baseUrl}: ${error.message}`);
  }

  const body = await response.text();
  const payload = parseJson(body);
  if (!response.ok) {
    fail(`Sync request failed with HTTP ${response.status}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

function formatStats(run, maxRuns, target, stats) {
  return [
    `[${target}] run ${run}/${maxRuns}`,
    `phase=${stats.phase}`,
    `processed=${stats.processed}`,
    `created=${stats.created}`,
    `updated_google=${stats.updated_google}`,
    `updated_notion=${stats.updated_notion}`,
    `deleted_google=${stats.deleted_google}`,
    `retryable_errors=${stats.retryable_errors}`,
    `manual_conflicts=${stats.manual_conflicts}`,
    `has_more=${Boolean(stats.has_more)}`,
  ].join(" ");
}

function resolveBaseUrl(target, explicitBaseUrl) {
  if (explicitBaseUrl) return String(explicitBaseUrl);
  if (target === "local") return "http://127.0.0.1:8787";
  if (target === "prod") return process.env.PUBLIC_BASE_URL || "https://calendar-sync.example.com";
  fail(`Unknown target "${target}". Use --target=prod or --target=local.`);
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripQuotes(rawValue.trim());
  }
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) fail(`Unexpected argument "${arg}". Use --help for usage.`);
    const index = arg.indexOf("=");
    if (index === -1) {
      parsed[arg.slice(2)] = true;
    } else {
      parsed[arg.slice(2, index)] = arg.slice(index + 1);
    }
  }
  return parsed;
}

function readInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function printUsage() {
  console.log(`Usage:
  npm run sync:prod:drain
  npm run sync:local:drain
  node scripts/drain-sync.mjs --target=prod --max-runs=25 --limit=10 --cleanup-limit=20

Targets:
  prod   Calls the deployed Worker and production D1 state.
  local  Calls http://127.0.0.1:8787 and local D1 state; start npm run dev:worker first.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
