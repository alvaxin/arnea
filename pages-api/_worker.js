const UPSTREAM_URL = "https://hsreplay.net/arena/";
const DATA_URL = "https://hsreplay.net/api/v1/arena/classes_stats/";
const ALLOWED_ORIGIN = "https://alvaxin.github.io";
const CACHE_TTL_SECONDS = 300;

const classNamesById = Object.freeze({
  1: "Death Knight",
  2: "Druid",
  3: "Hunter",
  4: "Mage",
  5: "Paladin",
  6: "Priest",
  7: "Rogue",
  8: "Shaman",
  9: "Warlock",
  10: "Warrior",
  14: "Demon Hunter",
});

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin === ALLOWED_ORIGIN) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(payload, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function parseArenaRates(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const rates = rows
    .map((row) => ({
      englishName: classNamesById[row.deck_class],
      winRate: Number(row.win_rate),
    }))
    .filter((row) => row.englishName && Number.isFinite(row.winRate))
    .sort((a, b) => b.winRate - a.winRate)
    .map((row, index) => ({
      rank: index + 1,
      ...row,
      name: row.englishName,
    }));

  if (rates.length < 9) throw new Error("Incomplete Arena class tier list");
  return rates;
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(origin)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

async function readUpstream() {
  const response = await fetch(DATA_URL, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: UPSTREAM_URL,
      "User-Agent": "Mozilla/5.0 (compatible; arena-rate-reader/1.0)",
    },
  });
  if (!response.ok) throw new Error(`HSReplay returned HTTP ${response.status}`);
  return parseArenaRates(await response.json());
}

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (requestUrl.pathname !== "/arena-rates") return jsonResponse({ error: "Not found" }, 404, origin);
    if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405, origin);

    const cacheKey = new Request(request.url, { method: "GET" });
    const cached = await caches.default.match(cacheKey);
    if (cached) return withCors(cached, origin);

    try {
      const rates = await readUpstream();
      const response = jsonResponse(
        { source: UPSTREAM_URL, updatedAt: new Date().toISOString(), rates },
        200,
        origin,
        { "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` }
      );
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      return response;
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : "Sync failed" }, 502, origin);
    }
  },
};
