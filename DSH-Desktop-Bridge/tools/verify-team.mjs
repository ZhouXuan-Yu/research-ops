// verify-team.mjs — read the on-disk team state and print verifiable fingerprints
// so a change can be checked without trusting the bot chat.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const STATE = process.env.APPDATA + "\\dsh-desktop\\harness\\bot\\state.json";
const s = JSON.parse(readFileSync(STATE, "utf8"));

console.log("revision", s.revision, "| bots", Object.keys(s.bots).length, "| rooms", Object.keys(s.rooms).length);
console.log("");
const rows = Object.values(s.bots).map(b => {
  const t = b.instructions ?? "";
  return {
    id: b.id,
    name: b.name,
    role: b.role ?? "",
    model: b.model,
    chars: t.length,
    sha: createHash("sha256").update(t, "utf8").digest("hex").slice(0, 12),
    tail: t.slice(-24).replace(/\n/g, " "),
  };
});
for (const r of rows) {
  console.log(`${r.name}\t${r.role}\t${r.chars}c\tsha=${r.sha}\tmodel=${r.model}`);
  console.log(`\ttail: ${r.tail}`);
}
console.log("");
for (const room of Object.values(s.rooms)) {
  console.log(`ROOM ${room.name} | admin=${room.admin} | members=${room.members.length} | mode=${room.mode}`);
  for (const m of room.members) {
    const b = s.bots[m];
    console.log(`   - ${b ? b.name : "UNKNOWN " + m}`);
  }
}
