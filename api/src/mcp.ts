// Remote MCP server at /mcp: "Streamable HTTP" transport, stateless. Every POST gets one application/json JSON-RPC
// answer (no sessions, no SSE); GET and DELETE are 405. Older clients still send batches, so arrays are answered.
// One tool per REST endpoint, built from CATALOG, so tools and docs cannot drift. Tools call the REST API through
// `callApi` with the caller's cf-connecting-ip, so the free tier counts the real caller and payment works the same.
import { FREE_CALLS_PER_DAY, callPrice } from "./x402.ts";
import { CATALOG, DESCRIPTION, type Entry } from "./discovery.ts";

export const MAX_MCP_BODY_BYTES = 64 * 1024;
export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_VERSION = "0.2.0";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, accept",
  "access-control-max-age": "86400",
};
const JSON_HEADERS = { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

type Id = string | number | null;
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; pattern?: string; description?: string; enum?: string[]; minimum?: number; maximum?: number };
type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean };

const PAY: Record<string, Schema> = {
  payment_signature: { type: "string", description: "Only after a 402: the base64 x402 v2 payment payload for the terms the 402 gave." },
  holder: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Optional: your address, for the holder price once $EQUITO is live. Pay from this address." },
};

function inputSchema(e: Entry): Schema {
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const p of e.params ?? []) {
    properties[p.name] = { type: "string", description: p.description, ...(p.enum ? { enum: p.enum } : {}) };
    if (p.required) required.push(p.name);
  }
  if (e.body) {
    const b = e.body as { properties: Record<string, Schema>; required?: string[] };
    Object.assign(properties, b.properties);
    required.push(...(b.required ?? []));
  }
  return { type: "object", properties: { ...properties, ...PAY }, required, additionalProperties: false };
}

const priceNote = (e: Entry) => (e.units === 1 ? "1 call" : `${e.units} calls`);
export const TOOLS = CATALOG.map((e) => ({
  name: e.tool,
  description: e.units === 0 ? e.summary : `${e.summary} Costs ${priceNote(e)} (${FREE_CALLS_PER_DAY} free a day, then ${callPrice()} each in USDG over x402).`,
  inputSchema: inputSchema(e),
})).concat([{ name: "get_pricing", description: "Price per call, free calls per day, asset, network, payTo and facilitator. Free.", inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } }]);

const ok = (id: Id, result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function typeOf(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
}

// Minimal JSON Schema check for the shapes above. Returns the first problem, else null.
function check(schema: Schema, v: unknown, path: string): string | null {
  if (schema.type) {
    const got = typeOf(v);
    const fits = got === schema.type || (schema.type === "number" && got === "integer");
    if (!fits) return `${path} must be ${schema.type}`;
  }
  if (schema.enum && !schema.enum.includes(v as string)) return `${path} must be one of ${schema.enum.join(", ")}`;
  if (typeof v === "string" && schema.pattern && !new RegExp(schema.pattern).test(v)) return `${path} has an invalid format`;
  if (typeof v === "number" && ((schema.minimum !== undefined && v < schema.minimum) || (schema.maximum !== undefined && v > schema.maximum))) return `${path} is out of range`;
  if (schema.properties && v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of schema.required ?? []) if (o[k] === undefined) return `${path}.${k} is required`;
    for (const [k, val] of Object.entries(o)) {
      const sub = schema.properties[k];
      if (!sub) {
        if (schema.additionalProperties === false) return `${path}.${k} is not allowed`;
        continue;
      }
      const bad = check(sub, val, `${path}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}

const toolText = (text: string, structuredContent?: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text }],
  ...(structuredContent !== undefined ? { structuredContent } : {}),
  ...(isError ? { isError: true } : {}),
});

function payInstructions(body: any, tool: string): string {
  const a = Array.isArray(body?.accepts) ? body.accepts[0] : undefined;
  const why = typeof body?.error === "string" ? body.error : "Payment required.";
  if (!a) return `${why} The payment terms were not readable.`;
  return `${why} Pay ${a.amount} base units of ${a.asset} to ${a.payTo} on ${a.network} (x402 v2, scheme ${a.scheme}): sign the terms in structuredContent.accepts[0], then call ${tool} again with the same arguments plus payment_signature (the base64 payment payload). You are charged only when the answer succeeds.`;
}

const MAX_TEXT = 12_000;

async function callTool(name: string, args: Record<string, any>, req: Request, callApi: (r: Request) => Promise<Response>): Promise<ToolResult> {
  const origin = new URL(req.url).origin;
  const headers: Record<string, string> = {};
  const ip = req.headers.get("cf-connecting-ip");
  if (ip) headers["cf-connecting-ip"] = ip;
  if (typeof args.payment_signature === "string") headers["payment-signature"] = args.payment_signature;
  if (typeof args.holder === "string") headers["x-holder"] = args.holder;

  let path: string;
  let init: RequestInit = { method: "GET", headers };
  if (name === "get_pricing") {
    path = "/v1/pricing";
  } else {
    const e = CATALOG.find((c) => c.tool === name)!;
    path = "/v1" + e.path;
    const query = new URLSearchParams();
    for (const p of e.params ?? []) {
      const v = args[p.name];
      if (v === undefined) continue;
      if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
      else query.set(p.name, String(v));
    }
    if ([...query].length) path += "?" + query.toString();
    if (e.method === "DELETE") init = { method: "DELETE", headers };
    if (e.method === "POST") {
      const body = Object.fromEntries(Object.entries(args).filter(([k]) => !(k in PAY)));
      init = { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) };
    }
  }

  let status: number;
  let data: any;
  try {
    const res = await callApi(new Request(origin + path, init));
    status = res.status;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  } catch {
    return toolText("Error 502: the API could not be reached. Try again.", undefined, true);
  }
  if (status === 402) return toolText(payInstructions(data, name), data, true);
  if (status < 200 || status >= 300) {
    const e = data?.error;
    return toolText(`Error ${status} ${e?.code ?? ""}: ${e?.message ?? "The API refused the call."}`.trim(), data, true);
  }
  const text = JSON.stringify(data, null, 1);
  return toolText(text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n… (truncated; the full answer is in structuredContent)" : text, data);
}

async function handleMessage(raw: unknown, req: Request, callApi: (r: Request) => Promise<Response>): Promise<object | null> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err(null, -32600, "Invalid Request");
  const msg = raw as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const hasId = msg.id !== undefined;
  const id: Id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  if (msg.jsonrpc !== "2.0") return err(id, -32600, 'Invalid Request: jsonrpc must be "2.0"');
  if (typeof msg.method !== "string") return hasId && ("result" in msg || "error" in msg) ? null : err(id, -32600, "Invalid Request: method is required");
  if (!hasId) return null; // a notification
  if (msg.params !== undefined && (typeof msg.params !== "object" || msg.params === null)) return err(id, -32602, "params must be an object");
  const p = (msg.params ?? {}) as Record<string, any>;
  try {
    switch (msg.method) {
      case "initialize": {
        if (typeof p.protocolVersion !== "string") return err(id, -32602, "protocolVersion is required");
        return ok(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : SUPPORTED_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "equito", title: "Equito", version: SERVER_VERSION },
          instructions: DESCRIPTION,
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === p.name);
        if (!tool) return err(id, -32602, `Unknown tool: ${String(p.name)}`);
        const args = p.arguments ?? {};
        const bad = check(tool.inputSchema, args, "arguments");
        if (bad) return err(id, -32602, `Invalid arguments: ${bad}`);
        return ok(id, await callTool(tool.name, args, req, callApi));
      }
      default:
        return err(id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    console.error("mcp error", e instanceof Error ? e.message : "unknown");
    return err(id, -32603, "Internal error");
  }
}

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

export async function handleMcp(req: Request, callApi: (req: Request) => Promise<Response>): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, err(null, -32600, "This server only accepts POST at /mcp (stateless, no stream, no sessions)."), { allow: "POST" });
  const text = await req.text();
  if (text.length > MAX_MCP_BODY_BYTES) return reply(413, err(null, -32600, `Request body is larger than ${MAX_MCP_BODY_BYTES} bytes.`));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reply(400, err(null, -32700, "Parse error"));
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return reply(400, err(null, -32600, "Invalid Request: empty batch"));
    const out = (await Promise.all(parsed.map((m) => handleMessage(m, req, callApi)))).filter((x) => x !== null);
    return out.length ? reply(200, out) : reply(202, null);
  }
  const out = await handleMessage(parsed, req, callApi);
  if (out === null) return reply(202, null);
  const e = (out as { error?: { code: number } }).error;
  return reply(e && e.code === -32600 ? 400 : 200, out);
}
