import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

type Entry = { id: number; time: number; text: string };

// 10,000 strings of at most 4 KB keeps a list under 40 MB.
const MAX_STRINGS = 10_000;
const PAGE = 1000;

const now = () => Math.floor(Date.now() / 1000);

/**
 * One Durable Object per list. Addressing an object by name creates it, so
 * nothing writes storage until `create` runs. A deleted list keeps its meta
 * row so its id, which may still be pasted into sites, is never reused.
 */
export default class List extends Cloudflare.DurableObject<List>()(
  "List",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const sql = state.storage.sql;
      const run = (query: string, ...args: unknown[]) =>
        Effect.flatMap(sql.exec(query, ...args), (cursor) => cursor.toArray());

      const status = Effect.gen(function* () {
        const tables = yield* run("SELECT name FROM sqlite_master WHERE name = 'meta'");
        if (tables.length === 0) return { status: "missing" as const };
        const [row] = (yield* run("SELECT key_hash, deleted_at FROM meta")) as {
          key_hash: string;
          deleted_at: number | null;
        }[];
        return row.deleted_at === null
          ? { status: "live" as const, hash: row.key_hash }
          : { status: "gone" as const };
      });

      const live = <A, R>(then: () => Effect.Effect<A, never, R>) =>
        Effect.gen(function* () {
          const list = yield* status;
          if (list.status !== "live") return list.status;
          return yield* then();
        });

      const owned = <A, R>(hash: string | undefined, then: () => Effect.Effect<A, never, R>) =>
        Effect.gen(function* () {
          const list = yield* status;
          if (list.status !== "live") return list.status;
          if (list.hash !== hash) return "denied" as const;
          return yield* then();
        });

      return {
        create: (hash: string) =>
          Effect.gen(function* () {
            if ((yield* status).status !== "missing") return false;
            yield* run("CREATE TABLE meta (key_hash TEXT NOT NULL, deleted_at INTEGER)");
            yield* run(
              "CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, text TEXT NOT NULL)",
            );
            yield* run("INSERT INTO meta (key_hash) VALUES (?)", hash);
            return true;
          }),

        status: () => Effect.map(status, (list) => list.status),

        append: (text: string) =>
          live(() =>
            Effect.gen(function* () {
              const [{ count }] = (yield* run("SELECT count(*) AS count FROM entries")) as { count: number }[];
              if (count >= MAX_STRINGS) return "full" as const;
              const time = now();
              const [row] = (yield* run(
                "INSERT INTO entries (time, text) VALUES (?, ?) RETURNING id",
                time,
                text,
              )) as { id: number }[];
              return { id: row.id, time };
            }),
          ),

        read: (hash: string | undefined, since: number) =>
          owned(hash, () =>
            Effect.map(
              run("SELECT id, time, text FROM entries WHERE id > ? ORDER BY id LIMIT ?", since, PAGE),
              (rows) => rows as Entry[],
            ),
          ),

        remove: (hash: string | undefined, id: number) =>
          owned(hash, () =>
            Effect.map(run("DELETE FROM entries WHERE id = ? RETURNING id", id), (rows) => rows.length > 0),
          ),

        // AUTOINCREMENT keeps counting after this, so ?since= never repeats.
        clear: (hash: string | undefined) => owned(hash, () => Effect.as(run("DELETE FROM entries"), true)),

        destroy: (hash: string | undefined) =>
          owned(hash, () =>
            Effect.gen(function* () {
              yield* run("DROP TABLE entries");
              yield* run("UPDATE meta SET key_hash = '', deleted_at = ?", now());
              return true;
            }),
          ),
      };
    });
  }),
) {}
