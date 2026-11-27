import { and, eq, gt, sql as expr } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { ensureSchema, resolveSchemaName } from "./db";

const pools = new Map<string, Pool>();

async function reservationDb() {
  await ensureSchema();
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for shared rate limits");
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000 });
    pools.set(connectionString, pool);
  }
  const events = pgSchema(resolveSchemaName()).table("usage_events", {
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    costUnits: integer("cost_units").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  });
  return { db: drizzle(pool), events };
}

export async function reserveUsage(opts: {
  actor: string;
  action: string;
  dayLimit: number;
  windowLimit: number;
  windowMs: number;
}): Promise<{ allowed: boolean; day: number; window: number }> {
  const { db, events } = await reservationDb();
  return db.transaction(async (tx) => {
    await tx.select({ locked: expr`pg_advisory_xact_lock(hashtextextended(${`usage:${resolveSchemaName()}:${opts.action}:${opts.actor}`}, 0))` });
    const [counts] = await tx.select({
      day: expr<number>`count(*)::int`,
      window: expr<number>`count(*) filter (where ${events.createdAt} > now() - ${opts.windowMs} * interval '1 millisecond')::int`,
    }).from(events).where(and(
      eq(events.actor, opts.actor), eq(events.action, opts.action),
      gt(events.createdAt, expr`now() - interval '1 day'`),
    ));
    if (counts.day >= opts.dayLimit || counts.window >= opts.windowLimit) {
      return { allowed: false, ...counts };
    }
    await tx.insert(events).values({ actor: opts.actor, action: opts.action, costUnits: 0 });
    return { allowed: true, day: counts.day + 1, window: counts.window + 1 };
  });
}

export async function reserveBudget(cost: number, cap: number): Promise<boolean> {
  const { db, events } = await reservationDb();
  return db.transaction(async (tx) => {
    await tx.select({ locked: expr`pg_advisory_xact_lock(hashtextextended(${`ai-budget:${resolveSchemaName()}`}, 0))` });
    const [row] = await tx.select({ used: expr<number>`coalesce(sum(${events.costUnits}), 0)::int` })
      .from(events).where(and(eq(events.action, "ai_judge"), gt(events.createdAt, expr`now() - interval '1 day'`)));
    if (row.used + cost > cap) return false;
    await tx.insert(events).values({ actor: "system", action: "ai_judge", costUnits: cost });
    return true;
  });
}
