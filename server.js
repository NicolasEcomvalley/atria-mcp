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
    headers: {
      "X-API-Key": API_KEY,
      "accept": "application/json"
    }
  });

  if (!res.ok) throw new Error(`Atria API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Atria error: ${data.message}`);
  return data.data;
}

const server = new McpServer({
  name: "atria-mcp",
  version: "1.0.0"
});

// Tool 1: Search ads
server.tool(
  "search_ads",
  "Search Atria's global ad library. Use to find competitor ads, trending creatives, or research angles by keyword, platform, or format.",
  {
    query: z.string().optional().describe("Search keyword (brand name, product, topic)"),
    platform: z.array(z.enum(["facebook", "instagram", "tiktok", "messenger", "audience_network", "threads", "whatsapp", "linkedin"])).optional().describe("Filter by platform"),
    display_format: z.array(z.enum(["image", "video", "carousel", "dco"])).optional().describe("Filter by ad format"),
    sort_by: z.enum(["most_recent", "longest_running"]).optional().describe("Sort order: most_recent or longest_running"),
    cursor: z.string().optional().describe("Pagination cursor from previous response")
  },
  async ({ query, platform, display_format, sort_by, cursor }) => {
    const data = await atriaFetch("/ads", { query, platform, display_format, sort_by, cursor });
    const ads = data.items.map(ad => ({
      id: ad.id,
      brand: ad.brand_name,
      platform: ad.platforms.join(", "),
      format: ad.display_format,
      status: ad.status,
      start_date: ad.start_date?.split("T")[0],
      body: ad.body || "(no text)",
      video_url: ad.videos?.[0]?.url || null,
      image_url: ad.images?.[0]?.url || null,
      preview: ad.videos?.[0]?.preview_image_url || ad.images?.[0]?.url || null,
      duration_days: ad.start_date && ad.end_date
        ? Math.round((new Date(ad.end_date) - new Date(ad.start_date)) / 86400000)
        : null,
      external_link: ad.external_link
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total_returned: ads.length, cursor: data.cursor, ads }, null, 2)
      }]
    };
  }
);

// Tool 2: Get ad detail
server.tool(
  "get_ad_detail",
  "Get full details of a specific ad by its ID.",
  {
    ad_id: z.string().describe("The ad ID (from search_ads results)")
  },
  async ({ ad_id }) => {
    const data = await atriaFetch(`/ads/${ad_id}`);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);

// Tool 3: Get boards
server.tool(
  "get_boards",
  "Get all your saved boards in Atria where you organize competitor ads.",
  {},
  async () => {
    const data = await atriaFetch("/boards");
    const boards = data.items.map(b => ({
      id: b.id,
      name: b.name,
      ad_count: b.ad_count,
      created_at: b.created_at?.split("T")[0]
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ boards }, null, 2)
      }]
    };
  }
);

// Tool 4: Get saved ads (from a board or all)
server.tool(
  "get_saved_ads",
  "Get your saved ads, optionally filtered by a specific board.",
  {
    board_id: z.string().optional().describe("Board ID to filter by (from get_boards)"),
    cursor: z.string().optional().describe("Pagination cursor")
  },
  async ({ board_id, cursor }) => {
    const path = board_id ? `/boards/${board_id}/ads` : "/saved-ads";
    const data = await atriaFetch(path, { cursor });
    const ads = data.items.map(ad => ({
      id: ad.id,
      brand: ad.brand_name,
      platform: ad.platforms?.join(", "),
      format: ad.display_format,
      status: ad.status,
      start_date: ad.start_date?.split("T")[0],
      body: ad.body || "(no text)",
      preview: ad.videos?.[0]?.preview_image_url || ad.images?.[0]?.url || null,
      duration_days: ad.start_date && ad.end_date
        ? Math.round((new Date(ad.end_date) - new Date(ad.start_date)) / 86400000)
        : null
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total_returned: ads.length, cursor: data.cursor, ads }, null, 2)
      }]
    };
  }
);

// Tool 5: Get brand ads
server.tool(
  "get_brand_ads",
  "Get all ads from a specific brand/competitor. Great for tracking what angles they're running and for how long.",
  {
    brand_id: z.string().describe("Brand ID (from search_ads results, the brand_id field)"),
    sort_by: z.enum(["most_recent", "longest_running"]).optional().describe("Sort: most_recent to see new angles, longest_running to see what's working"),
    platform: z.array(z.enum(["facebook", "instagram", "tiktok", "messenger", "threads", "whatsapp", "linkedin"])).optional().describe("Filter by platform"),
    cursor: z.string().optional().describe("Pagination cursor")
  },
  async ({ brand_id, sort_by, platform, cursor }) => {
    const data = await atriaFetch("/ads", { brand_id, sort_by, platform, cursor });
    const ads = data.items.map(ad => ({
      id: ad.id,
      brand: ad.brand_name,
      platform: ad.platforms?.join(", "),
      format: ad.display_format,
      status: ad.status,
      start_date: ad.start_date?.split("T")[0],
      body: ad.body || "(no text)",
      preview: ad.videos?.[0]?.preview_image_url || ad.images?.[0]?.url || null,
      duration_days: ad.start_date && ad.end_date
        ? Math.round((new Date(ad.end_date) - new Date(ad.start_date)) / 86400000)
        : "still running",
      external_link: ad.external_link
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total_returned: ads.length, cursor: data.cursor, ads }, null, 2)
      }]
    };
  }
);

// HTTP server setup
const transport = new StreamableHTTPServerTransport({ path: "/mcp" });
const httpServer = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("OK");
    return;
  }
  await transport.handleRequest(req, res);
});

await server.connect(transport);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Atria MCP server running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
