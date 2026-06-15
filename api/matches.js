import { waitUntil } from "@vercel/functions";

import { getLatestRefreshRun, listMatches, openStore } from "../src/db/index.js";
import { scheduleBackgroundRefresh } from "../src/background-refresh.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, { error: "Method not allowed" }, 405);
  }

  const store = await openStore();
  const matches = await listMatches(store);
  const latestRefresh = await getLatestRefreshRun(store);
  scheduleBackgroundRefresh({ store, matches, latestRefresh, waitUntil });

  return sendJson(response, {
    matches,
    latestRefresh,
  });
}

function sendJson(response, payload, status = 200) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
