import http from "http";

const ATRIA_BASE = "https://api.tryatria.com/open/v1";
const API_KEY = process.env.ATRIA_API_KEY;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${PORT}`;

if (!API_KEY) { console.error("ATRIA_API_KEY required"); process.exit(1); }

async function atriaFetch(path, params = {}) {
  const url = new URL(`${ATRIA_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v == null || v === "") return;
    if (Array.isArray(v)) v.forEach(i => url.searchParams.append(k, i));
    else url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": API_KEY, "accept": "application/json" }
  });
  if (!res.ok) throw new Error(`Atria ${res.status}`);
  const d = await res.json();
  if (d.code !== 0) throw new Error(d.message);
  return d.data;
}

function formatAds(items = []) {
  return items.map(ad => ({
    id: ad.id, brand: ad.brand_name, brand_id: ad.brand_id,
    platform: ad.platforms?.join(", "), format: ad.display_format,
    status: ad.status, start_date: ad.start_date?.split("T")[0],
    body: ad.body || "(no text)",
    preview: ad.videos?.[0]?.preview_image_url || ad.images?.[0]?.url || null,
    video_url: ad.videos?.[0]?.url || null,
    duration_days: ad.start_date && ad.end_date
      ? Math.round((new Date(ad.end_date) - new Date(ad.start_date)) / 86400000)
      : "still running",
    external_link: ad.external_link
  }));
}

function getBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  });
  res.end(body);
}

// MCP tools definition
const TOOLS = [
  {
    name: "search_ads",
    description: "Search Atria's ad library by keyword, platform, or format.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword" },
        platform: { type: "array", items: { type: "string", enum: ["facebook","instagram","tiktok","messenger","threads","whatsapp","linkedin"] } },
        display_format: { type: "array", items: { type: "string", enum: ["image","video","carousel","dco"] } },
        sort_by: { type: "string", enum: ["most_recent","longest_running"] },
        cursor: { type: "string" }
      }
    }
  },
  {
    name: "get_ad_detail",
    description: "Get full details of a specific ad by its ID.",
    inputSchema: { type: "object", properties: { ad_id: { type: "string" } }, required: ["ad_id"] }
  },
  {
    name: "get_boards",
    description: "Get all your saved boards in Atria.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "get_saved_ads",
    description: "Get your saved ads, optionally from a specific board.",
    inputSchema: {
      type: "object",
      properties: {
        board_id: { type: "string", description: "Board ID from get_boards" },
        cursor: { type: "string" }
      }
    }
  },
  {
    name: "get_brand_ads",
    description: "Get all ads from a competitor brand. sort_by=longest_running to see what works, most_recent for new angles.",
    inputSchema: {
      type: "object",
      properties: {
        brand_id: { type: "string" },
        sort_by: { type: "string", enum: ["most_recent","longest_running"] },
        platform: { type: "array", items: { type: "string" } },
        cursor: { type: "string" }
      },
      required: ["brand_id"]
    }
  }
];

async function callTool(name, args) {
  switch (name) {
    case "search_ads": {
      const d = await atriaFetch("/ads", args);
      return { total: d.items.length, cursor: d.cursor, ads: formatAds(d.items) };
    }
    case "get_ad_detail": {
      return await atriaFetch(`/ads/${args.ad_id}`);
    }
    case "get_boards": {
      const d = await atriaFetch("/boards");
      return { boards: (d.items || []).map(b => ({ id: b.id, name: b.name, ad_count: b.ad_count })) };
    }
    case "get_saved_ads": {
      const path = args.board_id ? `/boards/${args.board_id}/ads` : "/saved-ads";
      const d = await atriaFetch(path, { cursor: args.cursor });
      return { total: d.items.length, cursor: d.cursor, ads: formatAds(d.items) };
    }
    case "get_brand_ads": {
      const d = await atriaFetch("/ads", args);
      return { total: d.items.length, cursor: d.cursor, ads: formatAds(d.items) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const httpServer = http.createServer(async (req, res) => {
  const url = req.url?.split("?")[0];
  console.log(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization,MCP-Protocol-Version" });
    res.end(); return;
  }

  if (url === "/health") { res.writeHead(200); res.end("OK"); return; }

  if (url === "/.well-known/oauth-protected-resource/mcp" || url === "/.well-known/oauth-protected-resource") {
    json(res, 200, { resource: `${BASE_URL}/mcp`, authorization_servers: [BASE_URL], bearer_methods_supported: ["header"] }); return;
  }

  if (url === "/.well-known/oauth-authorization-server" || url === "/.well-known/openid-configuration") {
    json(res, 200, { issuer: BASE_URL, authorization_endpoint: `${BASE_URL}/oauth/authorize`, token_endpoint: `${BASE_URL}/oauth/token`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"] }); return;
  }

  if (url?.startsWith("/oauth/authorize")) {
    const p = new URL(req.url, BASE_URL).searchParams;
    const redirect = p.get("redirect_uri");
    const state = p.get("state");
    if (redirect) {
      const r = new URL(redirect);
      r.searchParams.set("code", "atria-token");
      if (state) r.searchParams.set("state", state);
      res.writeHead(302, { "Location": r.toString() }); res.end();
    } else { res.writeHead(400); res.end("Missing redirect_uri"); }
    return;
  }

  if (url === "/oauth/token" && req.method === "POST") {
    json(res, 200, { access_token: "atria-token", token_type: "Bearer", expires_in: 86400 }); return;
  }

  if (url === "/mcp") {
    // Handle GET - return server info
    if (req.method === "GET") {
      json(res, 200, { name: "atria-mcp", version: "1.0.0", protocolVersion: "2024-11-05" }); return;
    }

    if (req.method === "POST") {
      const bodyStr = await getBody(req);
      let request;
      try { request = JSON.parse(bodyStr); } catch {
        json(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }); return;
      }

      const { method, params, id } = request;

      if (method === "initialize") {
        json(res, 200, {
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "atria-mcp", version: "1.0.0" },
            capabilities: { tools: {} }
          }
        }); return;
      }

      if (method === "notifications/initialized") {
        res.writeHead(204); res.end(); return;
      }

      if (method === "tools/list") {
        json(res, 200, { jsonrpc: "2.0", id, result: { tools: TOOLS } }); return;
      }

      if (method === "tools/call") {
        const { name, arguments: args } = params;
        try {
          const result = await callTool(name, args || {});
          json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
        } catch (e) {
          json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } });
        }
        return;
      }

      json(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }); return;
    }
  }

  res.writeHead(404); res.end("Not found");
});

httpServer.listen(PORT, () => console.log(`Atria MCP server on port ${PORT}`));
