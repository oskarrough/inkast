import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import List from "./list.ts";
import { page } from "./page.ts";

const MAX_BYTES = 4096;
const ID = /^[a-z0-9]{8}$/;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

const text = (status: number, body: string) =>
  HttpServerResponse.text(body + "\n", { status, headers: cors });
const json = (status: number, body: unknown) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: cors });
const empty = (status: number) => HttpServerResponse.empty({ status, headers: cors });

const tooMany = HttpServerResponse.text("too many requests, slow down\n", {
  status: 429,
  headers: { ...cors, "retry-after": "60" },
});

const notFound = text(404, "not found");
const gone = text(410, "this list was deleted");
const unauthorized = text(401, "missing or wrong key");

// The answer for a request that never got as far as the list's data.
const refuse = (status: "missing" | "gone" | "denied" | "live") =>
  status === "missing" ? notFound : status === "gone" ? gone : unauthorized;

const random = (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes));

// 8 characters from a-z0-9, without modulo bias.
const newId = () => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  while (id.length < 8) {
    for (const byte of random(16)) {
      if (byte < 252 && id.length < 8) id += chars[byte % 36];
    }
  }
  return id;
};

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// 128 random bits.
const newKey = () => `k_${hex(random(16))}`;

const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
    Effect.map((digest) => hex(new Uint8Array(digest))),
  );

const bearer = (authorization: string | undefined) =>
  authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

const usage = (origin: string) => `inkast: a list anyone can add to and only you can read.

Make a list:
  curl -X POST ${origin}

More: https://github.com/oskarrough/inkast`;

export default Cloudflare.Worker(
  "Worker",
  {
    main: import.meta.url,
    domain: "inkast.0sk.ar",
  },
  Effect.gen(function* () {
    const lists = yield* List;
    // Per IP, counted roughly per Cloudflare location. Only the open calls
    // are limited; everything else needs a key.
    const creates = yield* Cloudflare.RateLimit("CREATES", {
      namespaceId: 4651,
      simple: { limit: 5, period: 60 },
    });
    const writes = yield* Cloudflare.RateLimit("WRITES", {
      namespaceId: 4652,
      simple: { limit: 30, period: 60 },
    });
    // Fails open: if the limiter itself breaks, let the request through.
    const allowed = (limiter: typeof creates, ip: string) =>
      limiter.limit({ key: ip }).pipe(
        Effect.map(({ success }) => success),
        Effect.catchTag("RateLimitError", () => Effect.succeed(true)),
      );

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL((yield* Cloudflare.Request).url);
        const method = request.method;
        const ip = request.headers["cf-connecting-ip"] ?? "unknown";
        const [id, entry, ...rest] = url.pathname.split("/").filter(Boolean);

        if (method === "OPTIONS") return empty(204);

        // GET / and POST /
        if (id === undefined) {
          if (method === "GET") return text(200, usage(url.origin));
          if (method !== "POST") return text(405, "method not allowed");
          if (!(yield* allowed(creates, ip))) return tooMany;
          for (let attempt = 0; attempt < 3; attempt++) {
            const id = newId();
            const key = newKey();
            if (yield* lists.getByName(id).create(yield* sha256(key))) {
              return json(201, {
                id,
                write: `${url.origin}/${id}`,
                read: `${url.origin}/${id}#${key}`,
                key,
              });
            }
          }
          return text(500, "could not find a free id, try again");
        }

        // Anything that is not a well-formed id never reaches a Durable Object.
        if (!ID.test(id) || rest.length > 0) return notFound;
        const list = lists.getByName(id);
        const key = bearer(request.headers["authorization"]);

        // DELETE /<id>/all and DELETE /<id>/<n>
        if (entry !== undefined) {
          if (method !== "DELETE") return text(405, "method not allowed");
          if (entry === "all") {
            if (key === undefined) return refuse(yield* list.status());
            const cleared = yield* list.clear(yield* sha256(key));
            return typeof cleared === "string" ? refuse(cleared) : empty(204);
          }
          const n = Number(entry);
          if (!Number.isInteger(n) || n < 1) return notFound;
          if (key === undefined) return refuse(yield* list.status());
          const removed = yield* list.remove(yield* sha256(key), n);
          if (typeof removed === "string") return refuse(removed);
          return removed ? empty(204) : notFound;
        }

        // POST /<id>
        if (method === "POST") {
          if (!(yield* allowed(writes, ip))) return tooMany;
          const length = Number(request.headers["content-length"] ?? 0);
          if (length > MAX_BYTES) return text(413, "a string can be at most 4 KB");
          const body = yield* request.arrayBuffer;
          if (body.byteLength > MAX_BYTES) return text(413, "a string can be at most 4 KB");
          // Stored as-is, whatever the content type says (curl -d sends a form type).
          const string = new TextDecoder().decode(body);
          if (string.trim() === "") return text(400, "empty string");
          const added = yield* list.append(string);
          if (typeof added === "string") return refuse(added);
          return json(201, added);
        }

        // GET /<id>
        if (method === "GET") {
          // A browser opening the read link sends no key, since the part after
          // # never leaves the browser. It gets the page, which reads the key
          // from the hash and fetches the list itself.
          const accept = request.headers["accept"] ?? "";
          if (key === undefined && accept.includes("text/html")) {
            const status = yield* list.status();
            if (status !== "live") return refuse(status);
            return HttpServerResponse.text(page, { headers: cors, contentType: "text/html; charset=utf-8" });
          }
          if (key === undefined) return refuse(yield* list.status());
          const since = Number(url.searchParams.get("since") ?? 0);
          if (!Number.isInteger(since)) return text(400, "since must be a whole number");
          const entries = yield* list.read(yield* sha256(key), since);
          if (typeof entries === "string") return refuse(entries);
          return json(200, entries);
        }

        // DELETE /<id> deletes the list. Its id is never handed out again.
        if (method === "DELETE") {
          if (key === undefined) return refuse(yield* list.status());
          const destroyed = yield* list.destroy(yield* sha256(key));
          return typeof destroyed === "string" ? refuse(destroyed) : empty(204);
        }

        return text(405, "method not allowed");
      }),
    };
  }).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding)),
);
