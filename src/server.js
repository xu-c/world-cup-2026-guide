import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import { loadEnv } from "./env.js";
import { getLatestRefreshRun, getMatch, listMatches, openStore } from "./db/index.js";
import { scheduleBackgroundRefresh } from "./background-refresh.js";
import { refreshWorldCupData } from "./refresh.js";
import { isAuthorizedAdminRequest } from "./http/auth.js";

loadEnv();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const publicDir = new URL("../public", import.meta.url).pathname;
const db = await openStore();

await ensureInitialData();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/matches") {
      const matches = await listMatches(db);
      const latestRefresh = await getLatestRefreshRun(db);
      scheduleBackgroundRefresh({ store: db, matches, latestRefresh });

      return sendJson(response, {
        matches,
        latestRefresh,
      });
    }

    const matchDetail = url.pathname.match(/^\/api\/matches\/(\d+)$/);
    if (request.method === "GET" && matchDetail) {
      const match = await getMatch(db, Number(matchDetail[1]));
      if (!match) return sendJson(response, { error: "Match not found" }, 404);
      return sendJson(response, { match });
    }

    if (request.method === "POST" && url.pathname === "/api/admin/refresh") {
      if (!isAuthorizedAdminRequest({ headers: request.headers, url })) {
        return sendJson(response, { error: "Unauthorized refresh request" }, 401);
      }

      const result = await refreshWorldCupData(db);
      return sendJson(response, result);
    }

    if (request.method === "GET") {
      return serveStatic(url.pathname, response);
    }

    return sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return sendJson(response, { error: error.message }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`World Cup 2026 guide running at http://${host}:${port}`);
});

async function ensureInitialData() {
  if ((await listMatches(db)).length > 0) return;
  await refreshWorldCupData(db);
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(response, { error: "Invalid path" }, 400);
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(content);
  } catch {
    sendJson(response, { error: "Not found" }, 404);
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function contentType(path) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
