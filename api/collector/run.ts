// node collector/run.ts   (from equito/api; GitHub Actions runs it on a schedule)
// Environment:
//   INGEST_KEY  required, the same value as the Worker secret INGEST_KEY
//   API_BASE    optional, default https://api.equito.pro (until the domain is bought: https://equito.pages.dev)
//   RPC_URLS    optional, private nodes comma separated (Chainstack, Alchemy); the public node is always last
// Locally it also reads the owner's global ~/.config/tech-coin/secrets.env (ROBINHOOD_RPC_CHAINSTACK,
// ROBINHOOD_RPC_ALCHEMY). Node URLs carry API keys, so nothing here ever prints them.
import { homedir } from "node:os";
import { join } from "node:path";
import { rpcUrls } from "../src/chain.ts";
import { collect } from "./collect.ts";

try {
  process.loadEnvFile(join(homedir(), ".config", "tech-coin", "secrets.env"));
} catch {
  // not on this machine (GitHub Actions uses repository secrets)
}

const ingestKey = process.env.INGEST_KEY;
if (!ingestKey) {
  console.error("Missing INGEST_KEY (GitHub repository secret, same value as the Worker secret).");
  process.exit(2);
}

const result = await collect({
  fetch: (input, init) => fetch(input, init),
  rpcUrls: rpcUrls(process.env.RPC_URLS, process.env.ROBINHOOD_RPC_CHAINSTACK, process.env.ROBINHOOD_RPC_ALCHEMY),
  apiBase: process.env.API_BASE || "https://api.equito.pro",
  ingestKey,
  now: Date.now,
});

// A run where most tokens failed is a failed run, so GitHub shows it red.
if (result.rows === 0 || result.failed.length > result.tokens / 2) process.exit(1);
