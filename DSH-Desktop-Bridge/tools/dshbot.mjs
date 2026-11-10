// dshbot.mjs — call dsh Desktop's own POST /api/bot endpoints through the running host,
// so changes go through the same checks the Bot UI uses. No file-level edits of state.json.
// Usage:
//   node dshbot.mjs state
//   node dshbot.mjs call <endpoint> <payload.json>
//   node dshbot.mjs batch <ops.json>      (array of {endpoint, payload, note?})
import { readFileSync } from "node:fs";

const CRED = "C:\\Users\\ZhouXuan\\.hanako\\app-data\\dshdesk\\cli-cookie.json";
const cred = JSON.parse(readFileSync(CRED, "utf8"));
const port = cred.port;
const cookie = cred.cookie;
if (!port || !cookie) {
  console.error("no port/cookie in credential cache");
  process.exit(2);
}

async function call(endpoint, payload) {
  const res = await fetch(`http://127.0.0.1:${port}/api/bot`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ endpoint, payload }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const [cmd, a1, a2] = process.argv.slice(2);

if (cmd === "state" || cmd === "view") {
  const r = await call("state", {});
  if (r.json?.ok === false) {
    console.log("ERROR", JSON.stringify(r.json.error));
    process.exit(1);
  }
  const v = r.json?.value ?? r.json;
  console.log("status", r.status, "revision", v?.revision, "bots", v?.bots?.length, "rooms", v?.rooms?.length);
  for (const b of v?.bots ?? []) {
    console.log(`  ${b.id} | ${b.name} | role=${b.role ?? ""} | instr=${(b.instructions ?? "").length}`);
  }
} else if (cmd === "call") {
  const payload = a2 ? JSON.parse(readFileSync(a2, "utf8")) : {};
  const r = await call(a1, payload);
  console.log(JSON.stringify(r.json, null, 2).slice(0, 3000));
  if (r.json?.ok === false) process.exit(1);
} else if (cmd === "batch") {
  const ops = JSON.parse(readFileSync(a1, "utf8"));
  let failed = 0;
  for (const op of ops) {
    const r = await call(op.endpoint, op.payload ?? {});
    const okFlag = r.json?.ok !== false;
    if (!okFlag) failed += 1;
    const note = op.note ?? op.endpoint;
    let detail = "";
    if (!okFlag) detail = " :: " + JSON.stringify(r.json?.error ?? r.json).slice(0, 400);
    else if (r.json?.value?.id) detail = " :: id=" + r.json.value.id;
    console.log(`${okFlag ? "OK  " : "FAIL"} ${note}${detail}`);
  }
  console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
  if (failed > 0) process.exit(1);
} else {
  console.log("usage: node dshbot.mjs state | call <endpoint> <payload.json> | batch <ops.json>");
}
