import { openStore } from "../../src/db/index.js";
import { isAuthorizedCronRequest } from "../../src/http/auth.js";
import { refreshWorldCupData } from "../../src/refresh.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, { error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  if (!isAuthorizedCronRequest({ headers: request.headers, url })) {
    return sendJson(response, { error: "Unauthorized cron request" }, 401);
  }

  const store = await openStore();
  const result = await refreshWorldCupData(store);
  return sendJson(response, result);
}

function sendJson(response, payload, status = 200) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
