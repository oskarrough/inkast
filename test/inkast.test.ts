import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { describe, expect } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import Stack from "../alchemy.run.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});

const stack = beforeAll(deploy(Stack));
afterAll.skipIf(!process.env.CI)(destroy(Stack));

type Init = { body?: BodyInit; headers?: Record<string, string>; method?: string };

const call = (path: string, init: Init = {}) =>
  Effect.gen(function* () {
    const { url } = yield* stack;
    const send = Effect.tryPromise(async () => {
      const response = await fetch(`${url}${path}`, init);
      return { status: response.status, headers: response.headers, text: await response.text() };
    });
    // Locally, a connection can die after a refused body, and the next request on it never arrives.
    return yield* Effect.orDie(Effect.retry(send, { schedule: Schedule.spaced("50 millis"), times: 3 }));
  });
const status = (path: string, init?: Init) => Effect.map(call(path, init), (r) => r.status);
const body = (path: string, init?: Init) => Effect.map(call(path, init), (r) => JSON.parse(r.text));
// Locally, a refused body sometimes loses its 413 to a reset. Nothing gets stored either way.
const refused = (path: string, body: BodyInit) =>
  Effect.gen(function* () {
    const { url } = yield* stack;
    const local = url.startsWith("http://localhost");
    return yield* Effect.promise(() =>
      fetch(`${url}${path}`, { method: "POST", body }).then(
        (response) => response.status === 413,
        () => local,
      ),
    );
  });

const x = (n: number, char = "x") => char.repeat(n);
const html = { accept: "text/html,application/xhtml+xml" };

// Creates are limited to 5 a minute, so one list does the walk-through.
const made = beforeAll(body("/", { method: "POST" }));
const auth = Effect.map(made, ({ key }) => ({ authorization: `Bearer ${key}` }));

describe("a list", () => {
  test(
    "comes back with its links",
    Effect.gen(function* () {
      const { url } = yield* stack;
      const { id, key, write, read } = yield* made;
      expect(write).toBe(`${url}/${id}`);
      expect(read).toBe(`${url}/${id}#${key}`);
      expect(key).toStartWith("k_");
    }),
  );

  test(
    "takes strings up to 4 KB",
    Effect.gen(function* () {
      const { id } = yield* made;
      expect(yield* status(`/${id}`, { method: "POST", body: "the jump feels floaty" })).toBe(201);
      expect(
        yield* status(`/${id}`, {
          method: "POST",
          body: "a=b&c=d",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }),
      ).toBe(201);
      expect(yield* status(`/${id}`, { method: "POST", body: "" })).toBe(400);
      expect(yield* status(`/${id}`, { method: "POST", body: "   " })).toBe(400);
      expect(yield* refused(`/${id}`, x(4097))).toBe(true);
      expect(yield* status(`/${id}`, { method: "POST", body: x(4096, "y") })).toBe(201);
    }),
  );

  test(
    "refuses a big body that doesn't say its length",
    Effect.gen(function* () {
      const { id } = yield* made;
      const chunk = new TextEncoder().encode(x(1024));
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < 64; i++) controller.enqueue(chunk);
          controller.close();
        },
      });
      expect(yield* refused(`/${id}`, stream)).toBe(true);
    }),
  );

  test(
    "reads only with the key",
    Effect.gen(function* () {
      const { id } = yield* made;
      const headers = yield* auth;
      expect(yield* status(`/${id}`, { headers: { accept: "*/*" } })).toBe(401);
      expect(yield* status(`/${id}`, { headers: { authorization: "Bearer k_nope" } })).toBe(401);
      const entries = yield* body(`/${id}`, { headers });
      expect(entries[1].text).toBe("a=b&c=d");
      expect(entries.map((e: { id: number }) => e.id)).toEqual([1, 2, 3]);
      expect((yield* body(`/${id}?since=1`, { headers })).map((e: { id: number }) => e.id)).toEqual([2, 3]);
      expect(yield* body(`/${id}?since=3`, { headers })).toEqual([]);
    }),
  );

  test(
    "gives a browser the page, which reads the key from the hash",
    Effect.gen(function* () {
      const { id } = yield* made;
      const page = yield* call(`/${id}`, { headers: html });
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(page.headers.get("content-security-policy")).toBeTruthy();
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(page.text).toContain("location.hash");
    }),
  );

  test(
    "deletes one string, then all of them, and keeps counting",
    Effect.gen(function* () {
      const { id } = yield* made;
      const headers = yield* auth;
      const ids = Effect.map(body(`/${id}`, { headers }), (es) => es.map((e: { id: number }) => e.id));
      expect(yield* status(`/${id}/3`, { method: "DELETE" })).toBe(401);
      expect(yield* status(`/${id}/3`, { method: "DELETE", headers })).toBe(204);
      expect(yield* status(`/${id}/3`, { method: "DELETE", headers })).toBe(404);
      expect((yield* body(`/${id}`, { method: "POST", body: "after delete" })).id).toBe(4);
      expect(yield* ids).toEqual([1, 2, 4]);
      expect(yield* status(`/${id}/all`, { method: "DELETE" })).toBe(401);
      expect(yield* status(`/${id}/all`, { method: "DELETE", headers })).toBe(204);
      expect(yield* ids).toEqual([]);
      expect((yield* body(`/${id}`, { method: "POST", body: "still works" })).id).toBe(5);
      expect(yield* ids).toEqual([5]);
    }),
  );

  test(
    "answers CORS",
    Effect.gen(function* () {
      const { id } = yield* made;
      const preflight = {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "GET",
          "access-control-request-headers": "authorization",
        },
      };
      expect(yield* status(`/${id}`, preflight)).toBe(204);
      const posted = yield* call(`/${id}`, { method: "POST", body: "x" });
      expect(posted.headers.get("access-control-allow-origin")).toBe("*");
    }),
  );

  test(
    "is gone for good once deleted",
    Effect.gen(function* () {
      const { id } = yield* made;
      const headers = yield* auth;
      expect(yield* status(`/${id}`, { method: "DELETE" })).toBe(401);
      expect(yield* status(`/${id}`, { method: "DELETE", headers: { authorization: "Bearer k_nope" } })).toBe(401);
      expect(yield* status(`/${id}`, { headers })).toBe(200);
      expect(yield* status(`/${id}`, { method: "DELETE", headers })).toBe(204);
      expect(yield* status(`/${id}`, { method: "POST", body: "too late" })).toBe(410);
      expect(yield* status(`/${id}`, { headers })).toBe(410);
      expect(yield* status(`/${id}`)).toBe(410);
      expect(yield* status(`/${id}`, { headers: html })).toBe(410);
      expect(yield* status(`/${id}/5`, { method: "DELETE", headers })).toBe(410);
      expect(yield* status(`/${id}/all`, { method: "DELETE", headers })).toBe(410);
      expect(yield* status(`/${id}`, { method: "DELETE", headers })).toBe(410);
    }),
  );
});

test(
  "an unknown id is not found, whatever the call",
  Effect.gen(function* () {
    const headers = yield* auth;
    const u = "/zzzz9999";
    expect(yield* status(u, { method: "POST", body: "hello" })).toBe(404);
    expect(yield* status(u, { headers: html })).toBe(404);
    expect(yield* status(u, { headers })).toBe(404);
    expect(yield* status(u)).toBe(404);
    expect(yield* status(u, { method: "DELETE", headers })).toBe(404);
    expect(yield* status(`${u}/all`, { method: "DELETE", headers })).toBe(404);
    expect(yield* status(u, { method: "POST", body: "hello" })).toBe(404);
    expect(yield* status("/NOT-AN-ID", { method: "POST", body: "hello" })).toBe(404);
  }),
);

// Last, because it spends this IP's budget for a minute.
test(
  "one IP going over budget gets 429s",
  Effect.gen(function* () {
    const made: { id: string; key: string }[] = [];
    const create = Effect.flatMap(call("/", { method: "POST" }), (r) =>
      Effect.sync(() => {
        if (r.status === 201) made.push(JSON.parse(r.text));
        return r.status;
      }),
    );
    yield* create;
    const { id } = made[0];

    let writes = 0;
    while (writes < 40 && (yield* status(`/${id}`, { method: "POST", body: `flood ${writes}` })) !== 429) writes++;
    expect(writes).toBeLessThan(40);

    let creates = 0;
    while (creates < 10 && (yield* create) !== 429) creates++;
    expect(creates).toBeLessThan(10);

    for (const list of made) {
      yield* status(`/${list.id}`, { method: "DELETE", headers: { authorization: `Bearer ${list.key}` } });
    }
  }),
  { timeout: 30_000 },
);
