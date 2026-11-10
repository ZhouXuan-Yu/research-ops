// unpaywall.mjs — 查开放获取副本
const email = "zhouxuan.research@gmail.com";
const url = `https://api.unpaywall.org/v2/10.1016/j.neucom.2024.128897?email=${encodeURIComponent(email)}`;
const r = await fetch(url, { headers: { "user-agent": "research-bot/1.0" } });
console.log("HTTP", r.status);
const t = await r.text();
try {
  const j = JSON.parse(t);
  console.log("is_oa:", j.is_oa, "| oa_status:", j.oa_status);
  for (const loc of j.oa_locations ?? []) {
    console.log("  loc:", loc.host_type, "|", loc.url_for_pdf || loc.url, "|", loc.version);
  }
} catch {
  console.log(t.slice(0, 400));
}
