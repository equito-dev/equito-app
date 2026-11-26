// Response helpers. Every error is { "error": { "code", "message" } } so callers and agents can branch on `code`.

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, payment-signature, x-holder",
  "access-control-expose-headers": "payment-required, payment-response, x-free-calls-left",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...headers },
  });
}

export const fail = (status: number, code: string, message: string): Response => json(status, { error: { code, message } });

// Responses can be immutable (from a Durable Object stub or fetch), so build a new one to add headers.
export function withHeaders(res: Response, extra: Record<string, string>): Response {
  const out = new Response(res.body, { status: res.status, headers: res.headers });
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}

// Raised by a handler for something the caller (or an upstream) got wrong; the worker turns it into fail().
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
