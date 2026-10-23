import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import List from "./list.ts";
import { isId, newId, newKey, sha256 } from "./ids.ts";

const MAX_BYTES = 4096;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

const text = (status: number, body: string, headers = {}) =>
  HttpServerResponse.text(body + "\n", { status, headers: { ...cors, ...headers } });
const json = (status: number, body: unknown) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { ...cors, "cache-control": "no-store" } });
// Imported on request: Node runs this file at deploy time and can't load .html.
const html = (file: () => Promise<{ default: string }>) =>
  Effect.promise(file).pipe(
    Effect.map(({ default: body }) =>
      HttpServerResponse.text(body, { headers: { ...cors, ...pageHeaders }, contentType: "text/html; charset=utf-8" }),
    ),
  );
const home = html(() => import("./home.html"));
const page = html(() => import("./page.html"));
const done = HttpServerResponse.empty({ status: 204, headers: cors });

const notFound = text(404, "not found");
const notAllowed = text(405, "method not allowed");
const tooBig = text(413, "a string can be at most 4 KB");
const tooMany = text(429, "too many requests, slow down", { "retry-after": "60" });
const pageHeaders = {
  "content-security-policy":
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

const refusals = {
  IdTaken: () => Effect.succeed(text(500, "could not find a free id, try again")),
  ListMissing: () => Effect.succeed(notFound),
  ListGone: () => Effect.succeed(text(410, "this list was deleted")),
  ListFull: () => Effect.succeed(text(413, "this list is full, delete some strings")),
  WrongKey: () => Effect.succeed(text(401, "missing or wrong key")),
  EntryMissing: () => Effect.succeed(notFound),
};

const readCapped = (body: ReadableStream<Uint8Array> | null) =>
  Effect.promise(async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (body === null) return new Uint8Array();
    const reader = body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(chunk.value);
    }
    const all = new Uint8Array(size);
    chunks.reduce((at, chunk) => (all.set(chunk, at), at + chunk.byteLength), 0);
    return all;
  });

// One IPv6 user usually holds a whole /64, so that is what gets counted.
const client = (ip: string) => (ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip);

const usage = (origin: string) => `inkast: a list anyone can add to and only you can read.

Make a list:
  curl -X POST ${origin}

Docs: https://raw.githubusercontent.com/oskarrough/inkast/main/README.md`;

export default Cloudflare.Worker(
  "Worker",
  {
    main: import.meta.url,
    domain: "inkast.0sk.ar",
  },
  Effect.gen(function* () {
    const lists = yield* List;
    const creates = yield* Cloudflare.RateLimit("CREATES", {
      namespaceId: 4651,
      simple: { limit: 5, period: 60 },
    });
    const writes = yield* Cloudflare.RateLimit("WRITES", {
      namespaceId: 4652,
      simple: { limit: 30, period: 60 },
    });
    const lookups = yield* Cloudflare.RateLimit("LOOKUPS", {
      namespaceId: 4653,
      simple: { limit: 120, period: 60 },
    });
    // Fails open: a broken limiter shouldn't take the service down with it.
    const allowed = (limiter: typeof creates, ip: string) =>
      limiter.limit({ key: ip }).pipe(
        Effect.map(({ success }) => success),
        Effect.catchTag("RateLimitError", () => Effect.succeed(true)),
      );

    const create = Effect.gen(function* () {
      const id = newId();
      const key = newKey();
      yield* lists.getByName(id).create(yield* sha256(key));
      return { id, key };
    }).pipe(Effect.retry({ times: 2, while: (error) => error._tag === "IdTaken" }));

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const raw = yield* Cloudflare.Request;
        const url = new URL(raw.url);
        const method = request.method;
        const ip = client(request.headers["cf-connecting-ip"] ?? "unknown");
        const [id, entry, ...rest] = url.pathname.split("/").filter(Boolean);

        if (method === "OPTIONS") return done;

        if (id === undefined) {
          if (method === "GET" && (request.headers["accept"] ?? "").includes("text/html")) return yield* home;
          if (method === "GET") return text(200, usage(url.origin));
          if (method !== "POST") return notAllowed;
          if (!(yield* allowed(creates, ip))) return tooMany;
          const { id, key } = yield* create;
          return json(201, { id, write: `${url.origin}/${id}`, read: `${url.origin}/${id}#${key}`, key });
        }

        if (!isId(id) || rest.length > 0) return notFound;
        if (method !== "POST" && !(yield* allowed(lookups, ip))) return tooMany;
        const list = lists.getByName(id);
        const key = request.headers["authorization"]?.match(/^Bearer\s+(\S+)$/i)?.[1];
        const hash = key === undefined ? undefined : yield* sha256(key);

        if (entry !== undefined) {
          if (method !== "DELETE") return notAllowed;
          if (entry === "all") return yield* Effect.as(list.clear(hash), done);
          const n = Number(entry);
          if (!Number.isInteger(n) || n < 1) return notFound;
          return yield* Effect.as(list.remove(hash, n), done);
        }

        if (method === "POST") {
          if (!(yield* allowed(writes, ip))) return tooMany;
          if (Number(request.headers["content-length"] ?? 0) > MAX_BYTES) return tooBig;
          const body = yield* readCapped(raw.body);
          if (body === undefined) return tooBig;
          // Stored raw, even when curl -d calls it a form.
          const string = new TextDecoder().decode(body);
          if (string.trim() === "") return text(400, "empty string");
          return json(201, yield* list.append(string));
        }

        if (method === "GET") {
          // Browsers never send the # part of the read link, so they get the page, which reads it.
          if (key === undefined && (request.headers["accept"] ?? "").includes("text/html")) {
            return yield* Effect.andThen(list.check(), page);
          }
          const since = Number(url.searchParams.get("since") ?? 0);
          if (!Number.isInteger(since)) return text(400, "since must be a whole number");
          return json(200, yield* list.read(hash, since));
        }

        if (method === "DELETE") return yield* Effect.as(list.destroy(hash), done);

        return notAllowed;
      }).pipe(Effect.catchTags(refusals)),
    };
  }).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding)),
);
