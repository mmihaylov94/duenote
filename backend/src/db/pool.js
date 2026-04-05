import pg from "pg";

const { Pool } = pg;

function trimEnv(v) {
  return typeof v === "string" ? v.trim() : v;
}

export function pgConfigFromEnv() {
  const url = trimEnv(process.env.DATABASE_URL);
  if (url) {
    return { connectionString: url };
  }
  const host = trimEnv(process.env.DATABASE_HOSTNAME) || trimEnv(process.env.PGHOST) || "localhost";
  const database =
    trimEnv(process.env.DATABASE_DATABASE) || trimEnv(process.env.PGDATABASE) || "duenote";
  const user =
    trimEnv(process.env.DATABASE_USERNAME) || trimEnv(process.env.PGUSER) || "postgres";
  const password = String(
    trimEnv(process.env.DATABASE_PASSWORD) ?? trimEnv(process.env.PGPASSWORD) ?? "",
  );
  const port = Number(trimEnv(process.env.DATABASE_PORT) || trimEnv(process.env.PGPORT) || "5432");
  return { host, port, database, user, password };
}

export const pool = new Pool(pgConfigFromEnv());
