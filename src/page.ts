// The page a browser gets for GET /<id>. The key lives after the # in the
// read link, so it never reaches the server. The page reads it and fetches
// the list as JSON with it.
export const page = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>inkast</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  li { display: flex; gap: 1rem; align-items: baseline; padding: .5rem 0; border-bottom: 1px solid #ddd; }
  pre { flex: 1; margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
  time { color: #777; font-size: .85em; white-space: nowrap; }
  ul { list-style: none; padding: 0; }
</style>
<h1>inkast</h1>
<p id="status">Loading…</p>
<p><button id="clear" hidden>Delete all strings</button> <button id="destroy" hidden>Delete this list</button></p>
<ul id="list"></ul>
<script>
  const key = location.hash.slice(1);
  const status = document.getElementById("status");
  const list = document.getElementById("list");
  const clear = document.getElementById("clear");
  const destroy = document.getElementById("destroy");
  const call = (path, method = "GET") =>
    fetch(path, { method, headers: { Authorization: "Bearer " + key, Accept: "application/json" } });

  async function load() {
    if (!key) return (status.textContent = "This link is missing its key (the part after #).");
    const res = await call(location.pathname);
    if (!res.ok) return (status.textContent = res.status === 401 ? "Wrong key." : res.status === 410 ? "This list was deleted." : "Error " + res.status);
    const entries = await res.json();
    status.textContent = entries.length + (entries.length === 1 ? " string" : " strings");
    clear.hidden = entries.length === 0;
    destroy.hidden = false;
    list.replaceChildren(...entries.reverse().map((entry) => {
      const li = document.createElement("li");
      const text = document.createElement("pre");
      text.textContent = entry.text;
      const time = document.createElement("time");
      time.textContent = new Date(entry.time * 1000).toLocaleString();
      const remove = document.createElement("button");
      remove.textContent = "Delete";
      remove.onclick = async () => { await call(location.pathname + "/" + entry.id, "DELETE"); load(); };
      li.append(text, time, remove);
      return li;
    }));
  }

  clear.onclick = async () => {
    if (confirm("Delete every string in this list?")) { await call(location.pathname + "/all", "DELETE"); load(); }
  };

  destroy.onclick = async () => {
    if (!confirm("Delete this list for good? Its key stops working and nothing can be sent to it again.")) return;
    await call(location.pathname, "DELETE");
    list.replaceChildren();
    clear.hidden = destroy.hidden = true;
    status.textContent = "This list was deleted.";
  };
  load();
</script>
`;
