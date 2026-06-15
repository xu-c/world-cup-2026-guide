import { getMatch, openStore } from "../../src/db/index.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, { error: "Method not allowed" }, 405);
  }

  const id = Number(request.query.id);
  if (!Number.isInteger(id) || id < 1) {
    return sendJson(response, { error: "Invalid match id" }, 400);
  }

  const store = await openStore();
  const match = await getMatch(store, id);
  if (!match) return sendJson(response, { error: "Match not found" }, 404);

  return sendJson(response, { match });
}

function sendJson(response, payload, status = 200) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
