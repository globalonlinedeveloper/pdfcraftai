/**
 * Singleton Drizzle client over mysql2/promise.
 * Reuses the connection pool across hot-reloads in development.
 */

import "server-only";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema";

const connectionString = process.env.MYSQL_URL;

if (!connectionString) {
  // Surface a loud error early in dev; in prod the build will fail typecheck
  // only if someone imports db/client.ts without MYSQL_URL set.
  throw new Error(
    "MYSQL_URL is not set. Copy .env.example to .env.local or set it in Hostinger hPanel."
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __pdfcraftMysqlPool: mysql.Pool | undefined;
}

const pool =
  global.__pdfcraftMysqlPool ??
  mysql.createPool({
    uri: connectionString,
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
