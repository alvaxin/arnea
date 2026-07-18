const UPSTREAM_URL = "https://hsreplay.net/arena/";
const ALLOWED_ORIGIN = "https://alvaxin.github.io";
const CACHE_TTL_SECONDS = 300;

const classNames = Object.freeze({
  DEATHKNIGHT: { englishName: "Death Knight", name: "死亡骑士" },
  DEMONHUNTER: { englishName: "Demon Hunter", name: "恶魔猎手" },
  DRUID: { englishName: "Druid", name: "德鲁伊" },
  HUNTER: { englishName: "Hunter", name: "猎人" },
  MAGE: { englishName: "Mage", name: "法师" },
  PALADIN: { englishName: "Paladin", name: "圣骑士" },
  PRIEST: { englishName: "Priest", name: "牧师" },
  ROGUE: { englishName: "Rogue", name: "潜行者" },
  SHAMAN: { englishName: "Shaman", name: "萨满祭司" },
  WARLOCK: { englishName: "Warlock", name: "术士" },
  WARRIOR: { englishName: "Warrior", name: "战士" },
});

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };

  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

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

function stripHtml(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&middot;/g, "·")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseArenaRates(html) {
  const headingFound = /竞技模式职业梯队列表|Arena Class Tier List/i.test(html);
  if (!headingFound) {
    throw new Error("Arena class tier list heading not found");
  }

  const rates = [];
  const linkPattern = /<a\b[^>]*href=["'][^"']*playerClass=([A-Z]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html)) !== null) {
    const classInfo = classNames[match[1].toUpperCase()];
    if (!classInfo) continue;

    const text = stripHtml(match[2]);
    const rateMatch = text.match(/#\s*(\d{1,2})\s+.+?\s+(\d+(?:\.\d+)?)\s*%/);
    if (!rateMatch) continue;

    rates.push({
      rank: Number(rateMatch[1]),
      englishName: classInfo.englishName,
      name: classInfo.name,
      winRate: Number(rateMatch[2]),
    });
  }

  const uniqueRates = Array.from(
    new Map(rates.map((item) => [item.englishName, item])).values()
  ).sort((a, b) => a.rank - b.rank);

  if (uniqueRates.length < 9) {
    throw new Error("Incomplete Arena class tier list");
  }

  return uniqueRates;
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(origin)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

async function readUpstream() {
  const response = await fetch(UPSTREAM_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; arnea-hsreplay-sync/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`HSReplay returned HTTP ${response.status}`);
  }

  return parseArenaRates(await response.text());
}

export default {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (requestUrl.pathname !== "/arena-rates") {
      return jsonResponse({ error: "Not found" }, 404, origin);
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405, origin);
    }

    const cacheKey = new Request(request.url, { method: "GET" });
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return withCors(cached, origin);
    }

    try {
      const rates = await readUpstream();
      const payload = {
        source: UPSTREAM_URL,
        updatedAt: new Date().toISOString(),
        rates,
      };
      const response = jsonResponse(payload, 200, origin, {
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
      });
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      return response;
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : "Sync failed" }, 502, origin);
    }
  },
};
