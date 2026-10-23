import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import List from "./list.ts";
import { page } from "./page.ts";

const MAX_BYTES = 4096;
// No l, o, 0 or 1, and 32 letters so a random byte maps without bias.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const ID = /^[a-km-np-z2-9]{8}$/;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "86400",
};

const text = (status: number, body: string, headers = {}) =>
  HttpServerResponse.text(body + "\n", { status, headers: { ...cors, ...headers } });
const json = (status: number, body: unknown) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: cors });
const done = HttpServerResponse.empty({ status: 204, headers: cors });

const notFound = text(404, "not found");
const notAllowed = text(405, "method not allowed");
const tooBig = text(413, "a string can be at most 4 KB");
const tooMany = text(429, "too many requests, slow down", { "retry-after": "60" });
const refusals = {
  missing: notFound,
  gone: text(410, "this list was deleted"),
  denied: text(401, "missing or wrong key"),
};

const random = (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes));
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const newId = () => Array.from(random(8), (b) => ALPHABET[b % 32]).join("");
const newKey = () => `k_${hex(random(16))}`;
const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).pipe(
    Effect.map((digest) => hex(new Uint8Array(digest))),
  );

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
    // Per IP, counted roughly per Cloudflare location. Calls that need the key aren't limited.
    const creates = yield* Cloudflare.RateLimit("CREATES", {
      namespaceId: 4651,
      simple: { limit: 5, period: 60 },
    });
    const writes = yield* Cloudflare.RateLimit("WRITES", {
      namespaceId: 4652,
      simple: { limit: 30, period: 60 },
    });
    // Fails open if the limiter itself breaks.
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
        const answer = <A>(result: A | keyof typeof refusals, ok: (a: A) => HttpServerResponse.HttpServerResponse) =>
          typeof result === "string" && result in refusals ? refusals[result as keyof typeof refusals] : ok(result as A);

        if (method === "OPTIONS") return done;

        if (id === undefined) {
          if (method === "GET") return text(200, usage(url.origin));
          if (method !== "POST") return notAllowed;
          if (!(yield* allowed(creates, ip))) return tooMany;
          for (let attempt = 0; attempt < 3; attempt++) {
            const id = newId();
            const key = newKey();
            if (yield* lists.getByName(id).create(yield* sha256(key))) {
              return json(201, { id, write: `${url.origin}/${id}`, read: `${url.origin}/${id}#${key}`, key });
            }
          }
          return text(500, "could not find a free id, try again");
        }

        if (!ID.test(id) || rest.length > 0) return notFound;
        const list = lists.getByName(id);
        const key = request.headers["authorization"]?.match(/^Bearer\s+(\S+)$/i)?.[1];
        const hash = key === undefined ? undefined : yield* sha256(key);

        if (entry !== undefined) {
          if (method !== "DELETE") return notAllowed;
          if (entry === "all") return answer(yield* list.clear(hash), () => done);
          const n = Number(entry);
          if (!Number.isInteger(n) || n < 1) return notFound;
          return answer(yield* list.remove(hash, n), (removed) => (removed ? done : notFound));
        }

        if (method === "POST") {
          if (!(yield* allowed(writes, ip))) return tooMany;
          if (Number(request.headers["content-length"] ?? 0) > MAX_BYTES) return tooBig;
          const body = yield* request.arrayBuffer;
          if (body.byteLength > MAX_BYTES) return tooBig;
          // Stored as-is, whatever the content type says (curl -d sends a form type).
          const string = new TextDecoder().decode(body);
          if (string.trim() === "") return text(400, "empty string");
          return answer(yield* list.append(string), (added) => json(201, added));
        }

        if (method === "GET") {
          // The key in the read link sits after the #, so a browser asks without
          // one. It gets the page, which reads the key and fetches the list.
          if (key === undefined && (request.headers["accept"] ?? "").includes("text/html")) {
            return answer(yield* list.status(), () =>
              HttpServerResponse.text(page, { headers: cors, contentType: "text/html; charset=utf-8" }),
            );
          }
          const since = Number(url.searchParams.get("since") ?? 0);
          if (!Number.isInteger(since)) return text(400, "since must be a whole number");
          return answer(yield* list.read(hash, since), (entries) => json(200, entries));
        }

        if (method === "DELETE") return answer(yield* list.destroy(hash), () => done);

        return notAllowed;
      }),
    };
  }).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding)),
);
