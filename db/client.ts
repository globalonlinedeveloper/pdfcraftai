/**
 * Singleton Drizzle client over mysql2/promise.
 * Reuses the connection pool across hot-reloads in development.
 *
 * `mysql.createPool` is lazy — it only stores config; the actual TCP/socket
 * connection isn't established until the first query runs. That lets us
 * construct `db` at module import time safely, even during `next build`
 * page-data collection, as long as the URI parses.
 *
 * If MYSQL_URL isn't set (e.g. a CI build env), we fall back to a harmless
 * placeholder URI so `createPool` doesn't throw. The first real query will
 * then fail loudly with ECONNREFUSED — which is the correct behaviour:
 * the build completes, but the app won't serve without real credentials.
 *
 * Keeping `db` as a direct drizzle instance (not a Proxy) is important:
 * `@auth/drizzle-adapter` does duck-type detection on the instance shape
 * and a Proxy wrapper trips up that check.
 */

import "server-only";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema";

// Connection config. Three sources, in priority order:
//   1. MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE / MYSQL_PORT
//      (cleanest — sidesteps all URL-parsing pitfalls)
//   2. MYSQL_URL  (legacy / Vercel-style; we parse it manually)
//   3. Build-time placeholder (`build:build@127.0.0.1`) so `next build`
//      can finish on machines without real credentials.
//
// IPv4-loopback coercion: on Hostinger / managed Node hosts, the MySQL
// grant is typically `@127.0.0.1` only, but mysql2 resolves `localhost`
// via Node's DNS which prefers `::1` (IPv6) on this host — producing
// "Access denied for user '...'@'::1'" even when the password is correct.
//
// Hostinger hPanel quirk: the env-var editor escapes `%` → `\%` when it
// stores values, so a percent-encoded password like `Cognizant%402026`
// arrives at the worker as `Cognizant\%402026`. We strip those literal
// backslashes BEFORE percent-decoding. (Use per-component env vars to
// avoid this entirely.)
const stripHpanelBackslashEscapes = (s: string) => s.replace(/\\%/g, "%");
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(stripHpanelBackslashEscapes(s));
  } catch {
    return stripHpanelBackslashEscapes(s);
  }
};

function parseMysqlUri(uri: string) {
  const m =
    /^mysql:\/\/([^:@\/]+)(?::([^@]*))?@([^:\/]+)(?::(\d+))?\/([^?]+)/.exec(uri);
  if (!m) {
    return {
      host: "127.0.0.1",
      port: 3306,
      user: "build",
      password: "build",
      database: "build",
    };
  }
  const [, user, password = "", rawHost, port, database] = m;
  const host = rawHost === "localhost" ? "127.0.0.1" : rawHost;
  return {
    host,
    port: port ? Number(port) : 3306,
    user: safeDecode(user),
    password: safeDecode(password),
    database: safeDecode(database),
  };
}

function buildConfig() {
  // Per-component vars win if set (recommended on Hostinger).
  if (process.env.MYSQL_HOST && process.env.MYSQL_USER && process.env.MYSQL_DATABASE) {
    return {
      host:
        process.env.MYSQL_HOST === "localhost" ? "127.0.0.1" : process.env.MYSQL_HOST,
      port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
      user: process.env.MYSQL_USER,
      password: stripHpanelBackslashEscapes(process.env.MYSQL_PASSWORD ?? ""),
      database: process.env.MYSQL_DATABASE,
    };
  }
  return parseMysqlUri(
    process.env.MYSQL_URL ?? "mysql://build:build@127.0.0.1:3306/build"
  );
}

const mysqlConfig = buildConfig();

declare global {
  // eslint-disable-next-line no-var
  var __pdfcraftMysqlPool: mysql.Pool | undefined;
}

const pool =
  global.__pdfcraftMysqlPool ??
  mysql.createPool({
    ...mysqlConfig,
    connectionLimit: 10,
    waitForConnections: true,
    enableKeepAlive: true,
  });

if (process.env.NODE_ENV !== "production") {
  global.__pdfcraftMysqlPool = pool;
}

export const db = drizzle(pool, { schema, mode: "default" });
export type DB = typeof db;
export { schema };
