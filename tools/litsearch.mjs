// litsearch.mjs — 无人值守文献检索（Crossref + arXiv），产出可归档的检索结果
// 用法:
//   node litsearch.mjs --queries "query one|query two" --rows 15 --out <path.md>
//   node litsearch.mjs --queries-file q.txt --rows 15
// 输出: 控制台表格 + Markdown 文件（含检索式、时间、来源、命中、去重结果）
import { writeFileSync, readFileSync } from "node:fs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) research-bot/1.0 (mailto:noreply@example.com)";
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const rows = Number(opt("rows", "15"));
const outPath = opt("out", "");
let queries = [];
if (opt("queries-file", "")) {
  queries = readFileSync(opt("queries-file", ""), "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
} else if (opt("queries", "")) {
  queries = opt("queries", "").split("|").map(s => s.trim()).filter(Boolean);
}
if (queries.length === 0) {
  console.error("no queries. use --queries \"a|b\" or --queries-file q.txt");
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function jget(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": UA, accept: "application/json" } });
      clearTimeout(t);
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return { error: `HTTP ${r.status}` };
      return { json: await r.json() };
    } catch (e) {
      clearTimeout(t);
      await sleep(800);
      if (i === tries - 1) return { error: e.name + ": " + e.message };
    }
  }
  return { error: "rate limited" };
}

async function tget(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": UA } });
      clearTimeout(t);
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return { error: `HTTP ${r.status}` };
      return { text: await r.text() };
    } catch (e) {
      clearTimeout(t);
      await sleep(800);
      if (i === tries - 1) return { error: e.name + ": " + e.message };
    }
  }
  return { error: "rate limited" };
}

async function crossref(q) {
  const url = "https://api.crossref.org/works?rows=" + rows +
    "&query.bibliographic=" + encodeURIComponent(q) +
    "&select=DOI,title,issued,author,container-title,is-referenced-by-count,type";
  const r = await jget(url);
  if (r.error) return { source: "crossref", error: r.error, items: [] };
  const items = (r.json.message?.items ?? []).map(it => ({
    source: "crossref",
    title: (it.title ?? [""])[0] ?? "",
    doi: (it.DOI ?? "").toLowerCase(),
    year: it.issued?.["date-parts"]?.[0]?.[0] ?? null,
    venue: (it["container-title"] ?? [""])[0] ?? "",
    cited: it["is-referenced-by-count"] ?? 0,
    authors: (it.author ?? []).slice(0, 3).map(a => [a.given, a.family].filter(Boolean).join(" ")).join(", "),
    type: it.type ?? "",
  }));
  return { source: "crossref", items };
}

function parseArxivXml(xml) {
  const items = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const pick = tag => {
      const r = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">").exec(e);
      return r ? r[1].replace(/\s+/g, " ").trim() : "";
    };
    const id = pick("id");
    items.push({
      source: "arxiv",
      title: pick("title"),
      doi: "",
      year: pick("published").slice(0, 4) || null,
      venue: "arXiv",
      cited: 0,
      authors: [...e.matchAll(/<name>([^<]+)<\/name>/g)].slice(0, 3).map(x => x[1]).join(", "),
      url: id,
      type: "preprint",
    });
  }
  return items;
}

async function arxiv(q) {
  const url = "https://export.arxiv.org/api/query?search_query=all:%22" +
    encodeURIComponent(q).replace(/%20/g, "+") + "%22&max_results=" + rows;
  const r = await tget(url);
  if (r.error) return { source: "arxiv", error: r.error, items: [] };
  return { source: "arxiv", items: parseArxivXml(r.text) };
}

const norm = s => (s ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");
const seenDoi = new Set();
const seenTitle = new Set();
const all = [];
const log = [];
const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");

for (const q of queries) {
  for (const fn of [crossref, arxiv]) {
    const res = await fn(q);
    let added = 0;
    for (const it of res.items) {
      const dk = it.doi || null;
      const tk = norm(it.title).slice(0, 64);
      if ((dk && seenDoi.has(dk)) || (!dk && seenTitle.has(tk))) continue;
      if (dk) seenDoi.add(dk);
      seenTitle.add(tk);
      it.query = q;
      all.push(it);
      added++;
    }
    log.push({ q, source: res.source, got: res.items.length, added, error: res.error ?? null });
    console.log(`[${res.source}] "${q}" → 返回 ${res.items.length}，新增 ${added}${res.error ? " | " + res.error : ""}`);
    await sleep(400);
  }
}

console.log("\n=== 结果（按引用数降序）===");
all.sort((a, b) => (b.cited ?? 0) - (a.cited ?? 0));
all.forEach((it, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${it.year ?? "????"} | ${it.title.slice(0, 90)}`);
  console.log(`    ${it.source} | ${it.doi || it.url || "无 DOI"} | 引 ${it.cited} | ${it.venue.slice(0, 60)}`);
});

if (outPath) {
  const lines = [];
  lines.push(`# 自动检索结果 ${stamp}`);
  lines.push("");
  lines.push("| 检索式 | 来源 | 返回 | 新增 | 错误 |");
  lines.push("|---|---|---|---|---|");
  for (const l of log) lines.push(`| ${l.q} | ${l.source} | ${l.got} | ${l.added} | ${l.error ?? ""} |`);
  lines.push("");
  lines.push("| # | 年 | 题名 | 来源 | DOI / URL | 被引 | 期刊 |");
  lines.push("|---|---|---|---|---|---|---|");
  all.forEach((it, i) => {
    lines.push(`| ${i + 1} | ${it.year ?? ""} | ${it.title.replace(/\|/g, "/")} | ${it.source} | ${it.doi || it.url || ""} | ${it.cited} | ${(it.venue || "").replace(/\|/g, "/")} |`);
  });
  writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\n已写入 ${outPath}`);
}
