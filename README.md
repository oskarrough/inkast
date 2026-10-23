# inkast

A list anyone can add to and only you can read.

```
anyone ──URL──▶ ┃       ┃
anyone ──URL──▶ ┃  list ┃ ──key──▶ you
anyone ──URL──▶ ┃       ┃
```

inkast is a hosted list. Make one and you get a URL and a key. Anyone with the URL can add to the list. Anyone with the key can read it, or delete it. Nothing in between: no editing, no accounts.

```sh
curl -X POST https://inkast.0sk.ar                                  # make a list
curl -d "the save button does nothing" https://inkast.0sk.ar/<id>   # anyone adds to it
curl -H "Authorization: Bearer <key>" https://inkast.0sk.ar/<id>    # only you read it
```

## Make a list

```sh
curl -X POST https://inkast.0sk.ar
```

```json
{
  "id": "x7k2q9mf",
  "write": "https://inkast.0sk.ar/x7k2q9mf",
  "read": "https://inkast.0sk.ar/x7k2q9mf#k_8f3a…",
  "key": "k_8f3a…"
}
```

The key is shown once. Whoever holds it owns the list.

## Add to it

Anyone can, from any page, without an account:

```js
fetch("https://inkast.0sk.ar/<id>", {
  method: "POST",
  body: `${location.href}\n${message}`,
})
```

A string is plain text, up to 4 KB. Nothing is kept but the string and the time it arrived, so put any context you want into the string itself, like the page it came from.

A list holds 10,000 strings.

## Read it

Open the `read` link in a browser to see the list and delete from it. Or ask for JSON:

```sh
curl -H "Authorization: Bearer <key>" "https://inkast.0sk.ar/<id>?since=41"
```

```json
[{ "id": 42, "time": 1792764855, "text": "the save button does nothing" }]
```

Reading never removes anything. Ids count up per list, so a reader keeps its place with `?since=<last id>`. A read returns at most 1,000 strings; ask again from the last id for more.

## Delete

```sh
curl -X DELETE -H "Authorization: Bearer <key>" https://inkast.0sk.ar/<id>/42    # one string
curl -X DELETE -H "Authorization: Bearer <key>" https://inkast.0sk.ar/<id>/all   # all strings
curl -X DELETE -H "Authorization: Bearer <key>" https://inkast.0sk.ar/<id>       # the list
```

Deleting the list is for good.

## Limits

Per IP and minute: 5 lists made, 30 strings sent, 120 reads. Rough, enough to stop a runaway script.

## Not yet

Spam protection beyond rate limits, names instead of ids, email in, retention, recovering a lost key.

## Develop

```sh
pnpm install
pnpm dev                                # runs locally on http://localhost:1337
test/smoke.sh http://localhost:1337     # the API, end to end
test/ratelimit.sh http://localhost:1337 # the 429s, run it apart from smoke.sh
pnpm alchemy deploy --stage prod
```
