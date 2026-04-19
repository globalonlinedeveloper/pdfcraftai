import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.MYSQL_URL ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
