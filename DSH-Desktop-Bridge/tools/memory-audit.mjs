// memory-audit.mjs — 记忆体检：条数、字符数、超限条目、悬空主题链接。
// 上限依据 ds-bot v0.2.3 README：单条 300 字符，MEMORY.md 4000 字符，主题 16000，每作用域 40 主题。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.APPDATA + "\\dsh-desktop\\harness\\bot\\memory";
const LIM = { entry: 300, file: 4000, topic: 16000 };

function audit(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const entries = lines.filter(l => l.startsWith("- "));
  const over = entries
    .map((l, i) => ({ i, len: l.length, head: l.slice(2, 40) }))
    .filter(e => e.len > LIM.entry);
  const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
  const dir = join(file, "..");
  const dangling = links.filter(n => !existsSync(join(dir, n + ".md")));
  const missingSrc = entries.filter(l => !/\[source: .*; added: \d{4}-\d{2}-\d{2}\]$/.test(l)).length;
  return { chars: text.length, entries: entries.length, over, dangling, missingSrc };
}

function walk(dir, depth = 0) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "snapshots" || name === "summaries" || name === "archive") continue;
      out.push(...walk(p, depth + 1));
    } else if (name === "MEMORY.md") out.push(p);
  }
  return out;
}

const files = [join(ROOT, "team", "MEMORY.md"), ...walk(join(ROOT, "bots")), ...(existsSync(join(ROOT, "groups")) ? walk(join(ROOT, "groups")) : [])];
let problems = 0;
for (const f of files) {
  if (!existsSync(f)) { console.log("MISSING", f); problems++; continue; }
  const a = audit(f);
  const rel = f.slice(ROOT.length + 1).replace(/\\\\/g, "/");
  const fileOver = a.chars > LIM.file;
  const bad = fileOver || a.over.length > 0 || a.dangling.length > 0 || a.missingSrc > 0;
  if (bad) problems++;
  console.log(`${bad ? "WARN" : "OK  "} ${rel}  chars=${a.chars} entries=${a.entries}`);
  if (fileOver) console.log(`     ! over file limit ${LIM.file}`);
  for (const o of a.over) console.log(`     ! entry ${o.i} len=${o.len} :: ${o.head}`);
  if (a.dangling.length) console.log(`     ! dangling topic links: ${a.dangling.join(", ")}`);
  if (a.missingSrc) console.log(`     ! ${a.missingSrc} entries without trailing [source: ...; added: YYYY-MM-DD]`);
}
console.log(problems === 0 ? "ALL CLEAN" : `${problems} file(s) need attention`);
