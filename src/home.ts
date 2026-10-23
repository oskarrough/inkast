import { marked } from "marked";
import readme from "../README.md";

// The landing page is the README, plus a button that makes a list.
export const home = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>inkast</title>
<style>
  body { font: 17px/1.6 Georgia, serif; max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; color: #222; background: #fdfcf8; }
  h1 { font-size: 3rem; margin: 0 0 .25rem; letter-spacing: -.02em; }
  h1 + p { font-size: 1.25rem; margin-top: 0; }
  h2 { margin-top: 2.5rem; font-size: 1.2rem; }
  code, pre { font: 14px/1.5 ui-monospace, Menlo, monospace; }
  pre { background: #f2efe6; padding: .9rem 1rem; overflow-x: auto; border-radius: 4px; }
  :not(pre) > code { background: #f2efe6; padding: .1em .3em; border-radius: 3px; }
  a { color: inherit; }
  #make { margin: 1.5rem 0; padding: 1rem 1.1rem; border: 2px solid #222; border-radius: 4px; }
  #make button { font: inherit; padding: .4rem .9rem; cursor: pointer; }
  #made { word-break: break-all; }
</style>
<div id="readme">${marked.parse(readme)}</div>
<script>
  const make = document.createElement("div");
  make.id = "make";
  make.innerHTML = '<button>Make a list</button> <span id="made">or use curl, as below.</span>';
  document.querySelector("#readme h1 + p + p").after(make);
  make.querySelector("button").onclick = async () => {
    const res = await fetch("/", { method: "POST" });
    const made = make.querySelector("#made");
    if (!res.ok) return (made.textContent = await res.text());
    const list = await res.json();
    made.innerHTML = "";
    const line = (label, value, href) => {
      const p = document.createElement("p");
      const a = document.createElement(href ? "a" : "code");
      a.textContent = value;
      if (href) a.href = href;
      p.append(label + " ", a);
      made.append(p);
    };
    line("Send to", list.write);
    line("Read at", list.read, list.read);
    line("Key, shown once:", list.key);
  };
</script>
`;
