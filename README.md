# inkast
A list anyone can add to and only you can read, set up in thirty seconds.

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

Anyone, from anywhere:

```sh
curl -d "the save button does nothing" https://inkast.0sk.ar/x7k2q9mf
```

```js
fetch("https://inkast.0sk.ar/x7k2q9mf", {
  method: "POST",
  body: `${location.href}\n${message}`,
})
```

A string is plain text, up to 4 KB. The body is stored as-is, whatever the content type says. An empty string gets a 400, anything over 4 KB a 413, never cut short. Nothing else is stored except the time it arrived.

Only lists made with `POST /` exist. Any other id gets a 404, and writing to it doesn't create one.

## Read it

```sh
curl -H "Authorization: Bearer k_8f3a…" https://inkast.0sk.ar/x7k2q9mf
curl -H "Authorization: Bearer k_8f3a…" "https://inkast.0sk.ar/x7k2q9mf?since=41"
```

```json
[{ "id": 42, "time": 1792764855, "text": "the save button does nothing" }]
```

Reading never removes anything. Ids count up per list, so a reader keeps its place with `?since=<last id>`.

Open the `read` link in a browser to see the list. The key sits after the `#`, so it never reaches a server log. That means the browser asks without a key, so the Accept header decides: a request for HTML gets a small page, which reads the key from after the `#` and fetches the list with it. Any other request without the right key gets a 401.

## Delete

```sh
curl -X DELETE -H "Authorization: Bearer k_8f3a…" https://inkast.0sk.ar/x7k2q9mf/42   # one
curl -X DELETE -H "Authorization: Bearer k_8f3a…" https://inkast.0sk.ar/x7k2q9mf      # all
```

Deleting all clears the strings. The list and its key keep working, and ids keep counting up, so `?since=` never skips or repeats.

## Not yet

Spam protection, names instead of ids, email in, retention, recovering a lost key.
