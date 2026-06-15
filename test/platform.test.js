import test from "node:test";
import assert from "node:assert/strict";

import { selectDatabaseDriver } from "../src/db/index.js";
import { isAuthorizedCronRequest } from "../src/http/auth.js";
import config from "../vercel.json" with { type: "json" };

test("database driver selects Postgres when DATABASE_URL is configured", () => {
  assert.equal(selectDatabaseDriver({ DATABASE_URL: "postgres://example" }), "postgres");
});

test("database driver keeps SQLite for local development without DATABASE_URL", () => {
  assert.equal(selectDatabaseDriver({}), "sqlite");
});

test("cron authorization accepts Vercel cron user agent when no CRON_SECRET is configured", () => {
  assert.equal(
    isAuthorizedCronRequest({
      env: {},
      headers: { "user-agent": "vercel-cron/1.0" },
      url: new URL("https://example.com/api/cron/refresh"),
    }),
    true,
  );
});

test("cron authorization requires CRON_SECRET when configured", () => {
  assert.equal(
    isAuthorizedCronRequest({
      env: { CRON_SECRET: "secret" },
      headers: { "user-agent": "vercel-cron/1.0" },
      url: new URL("https://example.com/api/cron/refresh"),
    }),
    false,
  );

  assert.equal(
    isAuthorizedCronRequest({
      env: { CRON_SECRET: "secret" },
      headers: { authorization: "Bearer secret" },
      url: new URL("https://example.com/api/cron/refresh"),
    }),
    true,
  );
});

test("Vercel cron is compatible with Hobby daily scheduling limits", () => {
  assert.deepEqual(config.crons, [
    {
      path: "/api/cron/refresh",
      schedule: "0 8 * * *",
    },
  ]);
});
