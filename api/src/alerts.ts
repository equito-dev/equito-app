// Webhook alerts on a token's numbers: "tell me when NVDA's premium goes above 1%".
// POST /v1/alerts (1 call) makes a 7-day alert and returns its id and webhook secret once; GET and DELETE
// /v1/alerts/{id} are free (the id is the only key). Alerts are checked after every collector snapshot (about hourly):
// a webhook goes out each time the condition turns from not met to met, including on the first check.
//
// Webhook: POST JSON { type: "equito.alert", alert, value, at } with header
//   equito-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the alert's secret>
// One try, 5 s. The outcome is kept on the alert (lastStatus) so the owner can see a webhook that fails.
import { ApiError, json } from "./http.ts";
import type { D1Like } from "./store.ts";

export const METRICS = ["token_price", "dex_price", "premium_pct", "liquidity_usd"] as const;
export const ALERT_DAYS = 7;
export const MAX_ALERTS_PER_IP = 10;
const MAX_CHECK_PER_RUN = 200;
type Metric = (typeof METRICS)[number];

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// https only, a real host name: no IP literals, no localhost, no internal names.
export function safeWebhook(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  return u.toString();
}

type AlertDb = {
  id: string; symbol: string; metric: Metric; op: "above" | "below"; value: number; webhook: string; secret: string; owner_key: string;
  created_at: number; expires_at: number; met: number | null; last_value: number | null; last_checked: number | null;
  fired: number; last_fired: number | null; last_status: number | null;
};

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
const view = (a: AlertDb) => ({
  id: a.id,
  symbol: a.symbol,
  metric: a.metric,
  op: a.op,
  value: a.value,
  webhookHost: new URL(a.webhook).host,
  createdAt: iso(a.created_at),
  expiresAt: iso(a.expires_at),
  met: a.met === null ? null : a.met === 1,
  lastValue: a.last_value,
  lastChecked: iso(a.last_checked),
  fired: a.fired,
  lastFired: iso(a.last_fired),
  lastStatus: a.last_status,
});

export async function createAlert(db: D1Like | undefined, req: Request, ownerKey: string, now: () => number, symbolExists: (s: string) => Promise<boolean>): Promise<Response> {
  if (!db) throw new ApiError(503, "data_off", "Alerts are not set up on this server.");
  const raw = await req.text();
  if (raw.length > 4096) throw new ApiError(413, "body_too_large", "Send a small JSON body.");
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "invalid_json", 'Send JSON: { "symbol", "metric", "op", "value", "webhookUrl" }.');
  }
  const symbol = String(b.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol)) throw new ApiError(400, "invalid_symbol", "Send a ticker like NVDA.");
  const metric = String(b.metric ?? "") as Metric;
  if (!METRICS.includes(metric)) throw new ApiError(400, "invalid_metric", `metric must be one of ${METRICS.join(", ")}.`);
  const op = String(b.op ?? "");
  if (op !== "above" && op !== "below") throw new ApiError(400, "invalid_op", "op must be above or below.");
  const value = Number(b.value);
  if (typeof b.value !== "number" || !Number.isFinite(value)) throw new ApiError(400, "invalid_value", "value must be a number (percent for premium_pct, USD otherwise).");
  const webhook = safeWebhook(b.webhookUrl);
  if (!webhook) throw new ApiError(400, "invalid_webhook", "webhookUrl must be a public https URL with a host name.");
  if (!(await symbolExists(symbol))) throw new ApiError(404, "unknown_symbol", `${symbol} is not a stock token on Robinhood Chain.`);
  const t = now();
  const active = await db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE owner_key = ? AND expires_at > ?").bind(ownerKey, t).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ALERTS_PER_IP) throw new ApiError(429, "alert_limit", `At most ${MAX_ALERTS_PER_IP} active alerts per caller. Delete one first.`);
  const id = "al_" + randomHex(16);
  const secret = randomHex(32);
  await db
    .prepare("INSERT INTO alerts (id, symbol, metric, op, value, webhook, secret, owner_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, symbol, metric, op, value, webhook, secret, ownerKey, t, t + ALERT_DAYS * 86_400_000)
    .run();
  const a = await db.prepare("SELECT * FROM alerts WHERE id = ?").bind(id).first<AlertDb>();
  return json(201, { alert: view(a!), webhookSecret: secret, note: "Keep the id: it is the only key to this alert. The secret is shown only now." });
}

export async function getAlert(db: D1Like | undefined, id: string): Promise<Response> {
  if (!db) throw new ApiError(503, "data_off", "Alerts are not set up on this server.");
  if (!/^al_[0-9a-f]{32}$/.test(id)) throw new ApiError(400, "invalid_id", "An alert id looks like al_ + 32 hex.");
  const a = await db.prepare("SELECT * FROM alerts WHERE id = ?").bind(id).first<AlertDb>();
  if (!a) throw new ApiError(404, "not_found", "No such alert.");
  return json(200, { alert: view(a) });
}

export async function deleteAlert(db: D1Like | undefined, id: string): Promise<Response> {
  if (!db) throw new ApiError(503, "data_off", "Alerts are not set up on this server.");
  if (!/^al_[0-9a-f]{32}$/.test(id)) throw new ApiError(400, "invalid_id", "An alert id looks like al_ + 32 hex.");
  const a = await db.prepare("SELECT id FROM alerts WHERE id = ?").bind(id).first<{ id: string }>();
  if (!a) throw new ApiError(404, "not_found", "No such alert.");
  await db.prepare("DELETE FROM alerts WHERE id = ?").bind(id).run();
  return json(200, { deleted: id });
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Joined = AlertDb & { s_token_price: number | null; s_dex_price: number | null; s_premium_pct: number | null; s_liquidity_usd: number | null; s_updated_at: number };

// Runs after each snapshot: every live alert whose token has numbers newer than its last check.
export async function checkAlerts(db: D1Like, f: typeof fetch, now: () => number): Promise<{ checked: number; fired: number }> {
  const t = now();
  const { results } = await db
    .prepare(
      `SELECT a.*, s.token_price AS s_token_price, s.dex_price AS s_dex_price, s.premium_pct AS s_premium_pct,
              s.liquidity_usd AS s_liquidity_usd, s.updated_at AS s_updated_at
       FROM alerts a JOIN token_stats s ON s.symbol = a.symbol
       WHERE a.expires_at > ? AND (a.last_checked IS NULL OR s.updated_at > a.last_checked)
       LIMIT ${MAX_CHECK_PER_RUN}`,
    )
    .bind(t)
    .all<Joined>();
  let fired = 0;
  for (const a of results) {
    const value = { token_price: a.s_token_price, dex_price: a.s_dex_price, premium_pct: a.s_premium_pct, liquidity_usd: a.s_liquidity_usd }[a.metric];
    if (value === null || value === undefined) {
      await db.prepare("UPDATE alerts SET last_checked = ?, last_value = NULL WHERE id = ?").bind(a.s_updated_at, a.id).run();
      continue;
    }
    const met = a.op === "above" ? value > a.value : value < a.value;
    let status: number | null = a.last_status;
    if (met && a.met !== 1) {
      const body = JSON.stringify({ type: "equito.alert", alert: { ...view(a), met: true, lastValue: value }, value, at: new Date(a.s_updated_at).toISOString() });
      const ts = Math.floor(t / 1000);
      try {
        const res = await f(a.webhook, {
          method: "POST",
          headers: { "content-type": "application/json", "equito-signature": `t=${ts},v1=${await sign(a.secret, `${ts}.${body}`)}` },
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(5_000),
        });
        status = res.status;
      } catch {
        status = 0;
      }
      fired++;
      await db.prepare("UPDATE alerts SET met = 1, last_value = ?, last_checked = ?, fired = fired + 1, last_fired = ?, last_status = ? WHERE id = ?").bind(value, a.s_updated_at, t, status, a.id).run();
    } else {
      await db.prepare("UPDATE alerts SET met = ?, last_value = ?, last_checked = ? WHERE id = ?").bind(met ? 1 : 0, value, a.s_updated_at, a.id).run();
    }
  }
  return { checked: results.length, fired };
}
