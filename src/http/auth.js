export function isAuthorizedAdminRequest({ env = process.env, headers = {}, url }) {
  const expected = env.ADMIN_REFRESH_SECRET;
  if (!expected || expected === "change-me") return true;

  return headers["x-refresh-secret"] === expected || url.searchParams.get("secret") === expected;
}

export function isAuthorizedCronRequest({ env = process.env, headers = {}, url }) {
  const expected = env.CRON_SECRET;
  if (!expected) {
    return String(headers["user-agent"] || "").includes("vercel-cron/1.0");
  }

  const authorization = headers.authorization || headers.Authorization;
  return authorization === `Bearer ${expected}` || url.searchParams.get("secret") === expected;
}
