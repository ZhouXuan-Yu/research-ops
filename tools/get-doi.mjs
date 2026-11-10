// get-doi.mjs — 取 Crossref 记录的 abstract / link / license（绕过 MCP 的 429）
const doi = process.argv[2];
if (!doi) { console.error("usage: node get-doi.mjs <doi>"); process.exit(2); }
const r = await fetch("https://api.crossref.org/works/" + encodeURIComponent(doi), {
  headers: { "user-agent": "research-bot/1.0 (mailto:noreply@example.com)" },
});
if (!r.ok) { console.log("HTTP", r.status); process.exit(1); }
const j = await r.json();
const m = j.message;
console.log("title:", (m.title ?? [""])[0]);
console.log("journal:", (m["container-title"] ?? [""])[0], "| vol", m.volume, "| page", m.page, "| cited", m["is-referenced-by-count"]);
console.log("license:", (m.license ?? []).map(l => l.URL + " (" + l["content-version"] + ")").join(" ; "));
console.log("abstract:", m.abstract ? m.abstract.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 2000) : "(no abstract deposited)");
console.log("links:", (m.link ?? []).map(l => l.URL).join(" ; ") || "(none)");
console.log("oA locator:", JSON.stringify(m["alternative-id"] ?? []));
