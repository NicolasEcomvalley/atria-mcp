import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "http";

const ATRIA_BASE = "https://api.tryatria.com/open/v1";
const API_KEY = process.env.ATRIA_API_KEY;

if (!API_KEY) {
  console.error("ERROR: ATRIA_API_KEY environment variable is required");
  process.exit(1);
}

async function atriaFetch(path, params = {}) {
  const url = new URL(`${ATRIA_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item));
      else url.searchParams.set(k, v);
    }
  });
  const res = await fetch(url.toString(), {
    headers: { "X-API-Key": API_KEY, "accept": "application/json" }
  });
  if (!res.ok) throw new Error(`Atria API error: ${res.status}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Atria error: ${data.message}`);
  return data.data;
}

function formatAds(items) {
  return items.map(ad => ({
    id: ad.id,
    brand: ad.brand_name,
    brand_id: ad.brand_id,
    platform: ad.platforms?.join(", "),
    format: ad.display_format,
    status: ad.status,
    start_date: ad.start_date?.split("T")[0],
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
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200); res.end("OK"); return;
  }

  if (req.url === "/mcp") {
    const server = new McpServer({ name: "atria-mcp", version: "1.0.0" });

    server.tool("search_ads", "Search Atria ad library by keyword, platform, or format.",
      {
        query: z.string().optional(),
        platform: z.array(z.enum(["facebook","instagram","tiktok","messenger","threads","whatsapp","linkedin"])).optional(),
        display_format: z.array(z.enum(["image","video","carousel","dco"])).optional(),
        sort_by: z.enum(["most_recent","longest_running"]).optional(),
        cursor: z.string().optional()
      },
      async (args) => {
        const data = await atriaFetch("/ads", args);
        return { content: [{ type: "text", text: JSON.stringify({ total: data.items.length, cursor: data.cursor, ads: formatAds(data.items) }, null, 2) }] };
      }
    );

    server.tool("get_ad_detail", "Get full details of a specific ad.",
      { ad_id: z.string() },
      async ({ ad_id }) => {
        const data = await atriaFetch(`/ads/${ad_id}`);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }
    );

    server.tool("get_boards", "Get all your saved boards in Atria.",
      {},
      async () => {
        const data = await atriaFetch("/boards");
        const boards = (data.items || []).map(b => ({ id: b.id, name: b.name, ad_count: b.ad_count }));
        return { content: [{ type: "text", text: JSON.stringify({ boards }, null, 2) }] };
      }
    );

    server.tool("get_saved_ads", "Get your saved ads, optionally from a specific board.",
      { board_id: z.string().optional(), cursor: z.string().optional() },
      async ({ board_id, cursor }) => {
        const path = board_id ? `/boards/${board_id}/ads` : "/saved-ads";
        const data = await atriaFetch(path, { cursor });
        return { content: [{ type: "text", text: JSON.stringify({ total: data.items.length, cursor: data.cursor, ads: formatAds(data.items) }, null, 2) }] };
      }
    );

    server.tool("get_brand_ads", "Get all ads from a competitor brand. sort_by=longest_running to see what works, most_recent for new angles.",
      {
        brand_id: z.string(),
        sort_by: z.enum(["most_recent","longest_running"]).optional(),
        platform: z.array(z.enum(["facebook","instagram","tiktok","messenger","threads","whatsapp","linkedin"])).optional(),
        cursor: z.string().optional()
      },
      async ({ brand_id, sort_by, platform, cursor }) => {
        const data = await atriaFetch("/ads", { brand_id, sort_by, platform, cursor });
        return { content: [{ type: "text", text: JSON.stringify({ total: data.items.length, cursor: data.cursor, ads: formatAds(data.items) }, null, 2) }] };
      }
    );

    const body = await getBody(req);
    const transport = new StreamableHTTPServerTransport({ path: "/mcp" });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  res.writeHead(404); res.end("Not found");
});

httpServer.listen(PORT, () => console.log(`Atria MCP server on port ${PORT}`));
