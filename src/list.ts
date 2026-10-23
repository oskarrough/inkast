import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

type Entry = { id: number; time: number; text: string };

const MAX_STRINGS = 10_000;
const PAGE = 1000;

const now = () => Math.floor(Date.now() / 1000);

export class IdTaken extends Schema.TaggedError<IdTaken>()("IdTaken", {}) {}
export class ListMissing extends Schema.TaggedError<ListMissing>()("ListMissing", {}) {}
export class ListGone extends Schema.TaggedError<ListGone>()("ListGone", {}) {}
export class ListFull extends Schema.TaggedError<ListFull>()("ListFull", {}) {}
export class WrongKey extends Schema.TaggedError<WrongKey>()("WrongKey", {}) {}
export class EntryMissing extends Schema.TaggedError<EntryMissing>()("EntryMissing", {}) {}

// A deleted list keeps its meta row so its id is never reused.
export default class List extends Cloudflare.DurableObject<List>()(
  "List",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const sql = state.storage.sql;
      const run = (query: string, ...args: unknown[]) =>
        Effect.flatMap(sql.exec(query, ...args), (cursor) => cursor.toArray());

      const exists = Effect.map(run("SELECT name FROM sqlite_master WHERE name = 'meta'"), (tables) => tables.length > 0);

      const live = Effect.gen(function* () {
        if (!(yield* exists)) return yield* new ListMissing();
        const [row] = (yield* run("SELECT key_hash, deleted_at FROM meta")) as {
          key_hash: string;
          deleted_at: number | null;
        }[];
        if (row.deleted_at !== null) return yield* new ListGone();
        return row.key_hash;
      });

      const owned = (hash: string | undefined) =>
        Effect.flatMap(live, (stored) => (stored === hash ? Effect.void : Effect.fail(new WrongKey())));

      return {
        create: (hash: string) =>
          Effect.gen(function* () {
            if (yield* exists) return yield* new IdTaken();
            yield* run("CREATE TABLE meta (key_hash TEXT NOT NULL, deleted_at INTEGER)");
            yield* run(
              "CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, text TEXT NOT NULL)",
            );
            yield* run("INSERT INTO meta (key_hash) VALUES (?)", hash);
          }),

        check: () => Effect.asVoid(live),

        append: (text: string) =>
          Effect.gen(function* () {
            yield* live;
            const [{ count }] = (yield* run("SELECT count(*) AS count FROM entries")) as { count: number }[];
            if (count >= MAX_STRINGS) return yield* new ListFull();
            const time = now();
            const [row] = (yield* run(
              "INSERT INTO entries (time, text) VALUES (?, ?) RETURNING id",
              time,
              text,
            )) as { id: number }[];
            return { id: row.id, time };
          }),

        read: (hash: string | undefined, since: number) =>
          owned(hash).pipe(
            Effect.andThen(run("SELECT id, time, text FROM entries WHERE id > ? ORDER BY id LIMIT ?", since, PAGE)),
            Effect.map((rows) => rows as Entry[]),
          ),

        remove: (hash: string | undefined, id: number) =>
          owned(hash).pipe(
            Effect.andThen(run("DELETE FROM entries WHERE id = ? RETURNING id", id)),
            Effect.flatMap((rows) => (rows.length > 0 ? Effect.void : Effect.fail(new EntryMissing()))),
          ),

        // AUTOINCREMENT keeps counting after this, so ?since= never repeats.
        clear: (hash: string | undefined) => owned(hash).pipe(Effect.andThen(run("DELETE FROM entries")), Effect.asVoid),

        destroy: (hash: string | undefined) =>
          Effect.gen(function* () {
            yield* owned(hash);
            yield* run("DROP TABLE entries");
            yield* run("UPDATE meta SET key_hash = '', deleted_at = ?", now());
          }),
      };
    });
  }),
) {}
