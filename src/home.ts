export const home = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>inkast</title>
<style>
  body { font: 17px/1.6 Georgia, serif; max-width: 38rem; margin: 4rem auto; padding: 0 1.25rem; color: #222; background: #fdfcf8; }
  h1 { font-size: 3rem; margin: 0; letter-spacing: -.02em; }
  h1 + p { font-size: 1.25rem; margin-top: 0; }
  pre, code { font: 14px/1.6 ui-monospace, Menlo, monospace; }
  pre { background: #f2efe6; padding: .9rem 1rem; overflow-x: auto; border-radius: 4px; }
  button { font: inherit; padding: .4rem .9rem; cursor: pointer; }
  #made { word-break: break-all; }
  a { color: inherit; }
</style>
<h1>inkast</h1>
<p>A list anyone can add to and only you can read.</p>
<pre>anyone ──URL──▶ ┃       ┃
anyone ──URL──▶ ┃  list ┃ ──key──▶ you
anyone ──URL──▶ ┃       ┃</pre>
<p>Make one and you get a URL and a key. Anyone with the URL can add to the list. Anyone with the key can read it, or delete it. Nothing in between: no editing, no accounts.</p>
<p><button id="make">Make a list</button></p>
<div id="made"></div>
<pre>curl -X POST https://inkast.0sk.ar
curl -d "the save button does nothing" https://inkast.0sk.ar/&lt;id&gt;
curl -H "Authorization: Bearer &lt;key&gt;" https://inkast.0sk.ar/&lt;id&gt;</pre>
<p><a href="https://github.com/oskarrough/inkast#readme">How it works</a></p>
<script>
  document.getElementById("make").onclick = async () => {
    const made = document.getElementById("made");
    const res = await fetch("/", { method: "POST" });
    if (!res.ok) return (made.textContent = await res.text());
    const list = await res.json();
    made.replaceChildren(...[["Send to", list.write], ["Read at", list.read, true], ["Key, shown once:", list.key]].map(([label, value, link]) => {
      const p = document.createElement("p");
      const v = document.createElement(link ? "a" : "code");
      v.textContent = value;
      if (link) v.href = value;
      p.append(label + " ", v);
      return p;
    }));
  };
</script>
`;
