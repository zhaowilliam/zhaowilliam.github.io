const EVENTS = new Set([
  "page_view",
  "map_click",
  "hess_video_open",
  "teaser_play",
  "video_doi_click",
  "cv_download",
]);

const MAX_BODY_BYTES = 2048;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/collect") {
        if (request.method === "OPTIONS") return collectPreflight(request, env);
        if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
        return await collect(request, env);
      }

      if (url.pathname === "/export.csv") {
        if (request.method === "OPTIONS") return exportPreflight(request, env);
        if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
        return await exportCsv(request, env, url);
      }

      return text("Not found", 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error("Analytics Worker failure", error);

      const origin = request.headers.get("origin");
      const headers = isAllowedOrigin(origin, env) ? corsHeaders(origin) : {};
      if (status === 429) headers["Retry-After"] = "60";
      const message = status === 500 ? "Internal error" : error.message;
      return text(message, status, headers);
    }
  },

  async scheduled(_controller, env) {
    await env.DB.prepare(`
      UPDATE events
      SET ip = NULL
      WHERE ip IS NOT NULL
        AND occurred_at < datetime('now', '-30 days')
    `).run();
  },
};

async function collect(request, env) {
  const origin = request.headers.get("origin");
  requireAllowedOrigin(origin, env);

  const ip = trustedText(request.headers.get("cf-connecting-ip"), 64);
  if (env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: `collect:${ip || "unknown"}` });
      if (!success) throw new HttpError(429, "Too many requests");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error("Analytics rate limiter unavailable", error);
    }
  }

  const contentType = (request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json" && contentType !== "text/plain") {
    throw new HttpError(415, "Content-Type must be application/json or text/plain");
  }

  if (!env.HASH_SECRET || env.HASH_SECRET.length < 32) {
    throw new Error("HASH_SECRET is not configured");
  }

  const body = await readLimitedJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "JSON object required");
  }
  if (!EVENTS.has(body.event)) throw new HttpError(400, "Unknown event");

  const path = requiredText(body.path, 256, "path");
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new HttpError(400, "Invalid path");
  }

  const target = optionalText(body.target, 160, "target");
  const referrerDomain = hostnameOnly(body.referrer_domain);
  const month = new Date().toISOString().slice(0, 7);
  const visitorHash = await hmacHex(env.HASH_SECRET, `${month}:${ip || "unavailable"}`);
  const cf = request.cf || {};

  await env.DB.prepare(`
    INSERT INTO events (
      event, path, target, referrer_domain, ip, visitor_hash,
      country, region, region_code, city, postal_code,
      latitude, longitude, timezone, asn, as_organization
    ) VALUES (
      ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
      ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
    )
  `).bind(
    body.event,
    path,
    target,
    referrerDomain,
    ip,
    visitorHash,
    trustedText(cf.country, 8),
    trustedText(cf.region, 100),
    trustedText(cf.regionCode, 16),
    trustedText(cf.city, 100),
    trustedText(cf.postalCode, 32),
    finiteNumber(cf.latitude),
    finiteNumber(cf.longitude),
    trustedText(cf.timezone, 64),
    safeInteger(cf.asn),
    trustedText(cf.asOrganization, 160),
  ).run();

  return new Response(null, {
    status: 204,
    headers: { ...baseHeaders(), ...corsHeaders(origin) },
  });
}

function collectPreflight(request, env) {
  const origin = request.headers.get("origin");
  requireAllowedOrigin(origin, env);

  if (request.headers.get("access-control-request-method") !== "POST") {
    throw new HttpError(403, "Forbidden");
  }

  const requestedHeaders = requestedHeaderNames(request);
  if (requestedHeaders.some((header) => header !== "content-type")) {
    throw new HttpError(403, "Forbidden");
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...baseHeaders(),
      ...corsHeaders(origin),
      "Access-Control-Max-Age": "86400",
    },
  });
}

function exportPreflight(request, env) {
  const origin = request.headers.get("origin");
  requireAllowedOrigin(origin, env);

  if (request.headers.get("access-control-request-method") !== "GET") {
    throw new HttpError(403, "Forbidden");
  }

  const requestedHeaders = requestedHeaderNames(request);
  if (requestedHeaders.some((header) => header !== "authorization")) {
    throw new HttpError(403, "Forbidden");
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...baseHeaders(),
      ...corsHeaders(origin, "GET, OPTIONS", "Authorization"),
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function exportCsv(request, env, url) {
  const origin = request.headers.get("origin");
  if (origin) requireAllowedOrigin(origin, env);
  const adminCors = origin
    ? corsHeaders(origin, "GET, OPTIONS", "Authorization")
    : {};

  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) {
    return text("Export unavailable", 503, adminCors);
  }

  const match = /^Bearer ([^\s]+)$/u.exec(request.headers.get("authorization") || "");
  if (!match || !(await secretsEqual(match[1], env.ADMIN_TOKEN))) {
    return text("Unauthorized", 401, {
      ...adminCors,
      "WWW-Authenticate": "Bearer",
    });
  }

  const limit = integerParam(url.searchParams.get("limit"), 5000, 1, 10000);
  const before = integerParam(
    url.searchParams.get("before"),
    Number.MAX_SAFE_INTEGER,
    1,
    Number.MAX_SAFE_INTEGER,
  );

  const { results } = await env.DB.prepare(`
    SELECT
      id,
      replace(occurred_at, ' ', 'T') || 'Z' AS timestamp_utc,
      event, path, target, referrer_domain,
      CASE
        WHEN occurred_at >= datetime('now', '-30 days') THEN ip
        ELSE NULL
      END AS ip,
      visitor_hash,
      country, region, region_code, city, postal_code,
      latitude, longitude, timezone, asn, as_organization
    FROM events
    WHERE id < ?1
    ORDER BY id DESC
    LIMIT ?2
  `).bind(before, limit).all();

  const columns = [
    "id", "timestamp_utc", "event", "path", "target", "referrer_domain",
    "ip", "visitor_hash", "country", "region", "region_code", "city",
    "postal_code", "latitude", "longitude", "timezone", "asn", "as_organization",
  ];
  const rows = [
    columns.join(","),
    ...results.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];

  const headers = {
    ...baseHeaders(),
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="wenli-site-events.csv"',
  };
  if (origin) Object.assign(headers, corsHeaders(origin, "GET, OPTIONS", "Authorization"));
  if (origin) headers["Access-Control-Expose-Headers"] = "X-Next-Before";
  if (results.length) headers["X-Next-Before"] = String(results.at(-1).id);

  return new Response(rows.join("\r\n"), { headers });
}

async function readLimitedJson(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Payload too large");
  }
  if (!request.body) throw new HttpError(400, "Request body required");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "Payload too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Malformed JSON");
  }
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function secretsEqual(left, right) {
  const [aBuffer, bBuffer] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(aBuffer);
  const b = new Uint8Array(bBuffer);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function requestedHeaderNames(request) {
  return (request.headers.get("access-control-request-headers") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function requireAllowedOrigin(origin, env) {
  if (!isAllowedOrigin(origin, env)) throw new HttpError(403, "Forbidden");
}

function isAllowedOrigin(origin, env) {
  return Boolean(origin && origin === env.ALLOWED_ORIGIN);
}

function hostnameOnly(value) {
  if (typeof value !== "string" || !value || value.length > 253) return null;
  const hostname = value.trim().toLowerCase();
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname)
    ? hostname
    : null;
}

function requiredText(value, maximum, label) {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || /[\u0000-\u001f\u007f]/u.test(cleaned)) {
    throw new HttpError(400, `Invalid ${label}`);
  }
  return cleaned;
}

function optionalText(value, maximum, label) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, maximum, label);
}

function trustedText(value, maximum) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function integerParam(raw, fallback, minimum, maximum) {
  if (raw === null) return fallback;
  if (!/^\d+$/u.test(raw)) throw new HttpError(400, "Invalid numeric parameter");
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, "Numeric parameter out of range");
  }
  return number;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let stringValue = String(value);
  if (/^[=+\-@\t\r]/u.test(stringValue)) stringValue = `'${stringValue}`;
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function corsHeaders(origin, methods = "POST, OPTIONS", headers = "Content-Type") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": headers,
    "Vary": "Origin",
  };
}

function baseHeaders() {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}

function methodNotAllowed(allow) {
  return text("Method not allowed", 405, { Allow: allow });
}

function text(message, status = 200, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: {
      ...baseHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });
}
