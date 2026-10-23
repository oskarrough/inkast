import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export type Entry = { id: number; time: number; text: string };

// What a request for a list can come back with, besides its data.
export type Missing = "missing"; // no list was ever created under this id
export type Gone = "gone"; // the owner deleted this list
export type Denied = "denied"; // the key does not match

/**
 * One Durable Object per list. Addressing an object by name brings it into
 * existence, so nothing here writes storage until `create` runs. Every other
 * method first checks that `create` happened and only reads until it has.
 *
 * Deleting a list sets meta.deleted_at and keeps the row as a marker. Its write URL may still be
 * pasted into sites, so the id must never be handed to a new owner.
 */
export default class List extends Cloudflare.DurableObject<List>()(
  "List",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    return Effect.gen(function* () {
      const sql = state.storage.sql;

      // Lists made before deleting existed have no deleted_at column.
      const columns = yield* (yield* sql.exec<{ name: string }>(
        "SELECT name FROM pragma_table_info('meta')",
      )).toArray();
      if (columns.length > 0 && !columns.some((column) => column.name === "deleted_at")) {
        yield* sql.exec("ALTER TABLE meta ADD COLUMN deleted_at INTEGER");
      }

      // The meta row, or undefined if this list was never created.
      // Only reads sqlite_master, so it creates nothing.
      const meta = Effect.gen(function* () {
        const tables = yield* sql.exec("SELECT name FROM sqlite_master WHERE name = 'meta'");
        if ((yield* tables.toArray()).length === 0) return undefined;
        const rows = yield* (yield* sql.exec<{ key_hash: string; deleted_at: number | null }>(
          "SELECT key_hash, deleted_at FROM meta",
        )).toArray();
        return rows[0];
      });

      // Runs `then` only for an existing list opened with the right key.
      const withKey = <A, R>(hash: string, then: () => Effect.Effect<A, never, R>) =>
        Effect.gen(function* () {
          const row = yield* meta;
          if (row === undefined) return "missing" as const;
          if (row.deleted_at !== null) return "gone" as const;
          if (row.key_hash !== hash) return "denied" as const;
          return yield* then();
        });

      return {
        // Returns false if a list exists, or ever existed, under this id.
        create: (hash: string) =>
          Effect.gen(function* () {
            if ((yield* meta) !== undefined) return false;
            yield* sql.exec("CREATE TABLE meta (key_hash TEXT NOT NULL, deleted_at INTEGER)");
            yield* sql.exec(
              "CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, text TEXT NOT NULL)",
            );
            yield* sql.exec("INSERT INTO meta (key_hash) VALUES (?)", hash);
            return true;
          }),

        status: () =>
          Effect.map(meta, (row) =>
            row === undefined ? ("missing" as const) : row.deleted_at !== null ? ("gone" as const) : ("live" as const),
          ),

        append: (text: string) =>
          Effect.gen(function* () {
            const list = yield* meta;
            if (list === undefined) return "missing" as const;
            if (list.deleted_at !== null) return "gone" as const;
            const time = Math.floor(Date.now() / 1000);
            const row = yield* (yield* sql.exec<{ id: number }>(
              "INSERT INTO entries (time, text) VALUES (?, ?) RETURNING id",
              time,
              text,
            )).one();
            return { id: row.id, time };
          }),

        read: (hash: string, since: number) =>
          withKey(hash, () =>
            Effect.gen(function* () {
              const cursor = yield* sql.exec<Entry>(
                "SELECT id, time, text FROM entries WHERE id > ? ORDER BY id",
                since,
              );
              return yield* cursor.toArray();
            }),
          ),

        // Returns false if there was no string with that id.
        remove: (hash: string, id: number) =>
          withKey(hash, () =>
            Effect.gen(function* () {
              const cursor = yield* sql.exec("DELETE FROM entries WHERE id = ?", id);
              yield* cursor.toArray();
              return (yield* cursor.rowsWritten) > 0;
            }),
          ),

        // Clears the strings. The list and its key keep working, and
        // AUTOINCREMENT keeps counting up, so ids are never reused.
        clear: (hash: string) =>
          withKey(hash, () =>
            Effect.gen(function* () {
              yield* (yield* sql.exec("DELETE FROM entries")).toArray();
              return true;
            }),
          ),

        // Deletes the strings, blanks the key hash, and leaves the marker.
        // deleted_at is what says "gone"; the blank hash just keeps nothing.
        destroy: (hash: string) =>
          withKey(hash, () =>
            Effect.gen(function* () {
              yield* (yield* sql.exec("DROP TABLE entries")).toArray();
              yield* (yield* sql.exec(
                "UPDATE meta SET key_hash = '', deleted_at = ?",
                Math.floor(Date.now() / 1000),
              )).toArray();
              return true;
            }),
          ),
      };
    });
  }),
) {}
