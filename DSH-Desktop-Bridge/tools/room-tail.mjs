// room-tail.mjs [n] — print the last n lines of each group room's log from state.json.
import { readFileSync } from "node:fs";
const STATE = process.env.APPDATA + "\\dsh-desktop\\harness\\bot\\state.json";
const s = JSON.parse(readFileSync(STATE, "utf8"));
const n = Number(process.argv[2] ?? 3);
for (const room of Object.values(s.rooms)) {
  const log = room.log ?? [];
  console.log(`ROOM ${room.name} | log=${log.length} | seq=${room.seq}`);
  for (const e of log.slice(-n)) {
    const body = String(e.text ?? "").replace(/\n/g, " ⏎ ");
    console.log(`--- ${e.who} (seq ${e.seq ?? "?"}) ---`);
    console.log(body.slice(0, 1200));
  }
}
