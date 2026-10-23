# inkast
A list anyone can add to and only you can read, set up in thirty seconds.

## Make a list

```sh
curl -X POST https://inkast.dev
```

```json
{
  "id": "x7k2q9mf",
  "write": "https://inkast.dev/x7k2q9mf",
  "read": "https://inkast.dev/x7k2q9mf#k_8f3a…",
  "key": "k_8f3a…"
}
```

The key is shown once. Whoever holds it owns the list.

## Add to it

Anyone, from anywhere:

```sh
curl -d "the save button does nothing" https://inkast.dev/x7k2q9mf
```

```js
fetch("https://inkast.dev/x7k2q9mf", {
  method: "POST",
  body: `${location.href}\n${message}`,
})
```

A string is plain text, up to 4 KB. Nothing else is stored except the time it arrived.

## Read it

```sh
curl -H "Authorization: Bearer k_8f3a…" https://inkast.dev/x7k2q9mf
curl -H "Authorization: Bearer k_8f3a…" "https://inkast.dev/x7k2q9mf?since=41"
```

```json
[{ "id": 42, "time": 1792764855, "text": "the save button does nothing" }]
```

Reading never removes anything. Ids count up per list, so a reader keeps its place with `?since=<last id>`.

Open the `read` link in a browser to see the list. The key sits after the `#`, so it never reaches a server log.

## Delete

```sh
curl -X DELETE -H "Authorization: Bearer k_8f3a…" https://inkast.dev/x7k2q9mf/42   # one
curl -X DELETE -H "Authorization: Bearer k_8f3a…" https://inkast.dev/x7k2q9mf      # all
```

## Not yet

Spam protection, names instead of ids, email in, retention, recovering a lost key.
