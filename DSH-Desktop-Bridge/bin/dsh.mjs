#!/usr/bin/env node
/**
 * dsh —— 桌面 DSH 的命令行接管工具（跨会话可用，不依赖 App 是否安装）。
 *
 * 设计要点：
 *   - 自带凭证链：读 harness.log 的最后一条启动行 → 用 token 换 cookie → 缓存；
 *     收到 401/403 时强制重取一次。缓存位置固定，不与 App 依赖。
 *   - 只做一件事：把人/Agent 的话送进 DSH 的会话，并把回复读回来。
 *
 * 用法：
 *   node bin/dsh.mjs status
 *   node bin/dsh.mjs list [--limit 20]
 *   node bin/dsh.mjs open  --text "..." [--cwd <绝对路径>] [--wait] [--timeout 120]
 *   node bin/dsh.mjs reply --session session-xxx --text "..." [--wait]
 *   node bin/dsh.mjs read  --session session-xxx
 *   node bin/dsh.mjs cancel --session session-xxx
 *   node bin/dsh.mjs send  --text "..." [--session session-xxx] [--cwd <p>] [--timeout 120]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** 审计是可选增强：limbs/audit.mjs 不在时静默跳过，不影响下发。 */
async function auditSafe(actor, action, opts) {
  try {
    const m = await import("../../limbs/audit.mjs");
    m.audit(actor, action, opts);
  } catch {
    /* 审计不可用 */
  }
}

/** 文本来源：优先 --text-file <路径>（UTF-8 整文件），否则 --text <字符串>。 */
function textArg() {
  const f = arg("text-file");
  if (f && f !== true) return readFileSync(String(f), "utf8");
  const t = arg("text");
  return t && t !== true ? String(t) : null;
}

const STATE_DIR = "C:/Users/ZhouXuan/.hanako/app-data/dshdesk";
const LOG_PATH = join("C:/Users/ZhouXuan/AppData/Roaming/dsh-desktop/logs", "harness.log");
const COOKIE_CACHE = join(STATE_DIR, "cli-cookie.json");
const DEFAULT_PROVIDER = "deepseek-official";
const DEFAULT_MODEL = "deepseek-flash";

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  if (i >= 0) return true;
  return dflt;
}

function lastLaunch() {
  const text = readFileSync(LOG_PATH, "utf8");
  const re = /dsh web:\s*(http:\/\/127\.0\.0\.1:(\d+)\/)\?token=([A-Za-z0-9_-]+)/g;
  let m;
  let last = null;
  while ((m = re.exec(text))) last = m;
  if (!last) throw new Error("harness.log 里没有找到 DSH 启动行");
  return { base: last[1], port: Number(last[2]), token: last[3] };
}

async function exchange(base, token) {
  const res = await fetch(`${base}?token=${encodeURIComponent(token)}`, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  const sc = res.headers.get("set-cookie") || "";
  const m = sc.match(/^(dsh-auth-[^=]+=[^;]+)/);
  if (!m) throw new Error(`换 cookie 失败，HTTP ${res.status}`);
  return m[1];
}

let CRED = null; // { base, cookie, port }

async function cred(force) {
  const launch = lastLaunch();
  if (!force && CRED && CRED.port === launch.port) return CRED;
  // 命中缓存文件且端口一致就直接用（避免每次启动都换一次）
  if (!force) {
    try {
      const c = JSON.parse(readFileSync(COOKIE_CACHE, "utf8"));
      if (c && c.port === launch.port && c.cookie) {
        CRED = { base: launch.base, cookie: c.cookie, port: launch.port };
        return CRED;
      }
    } catch {
      /* 没有缓存就换 */
    }
  }
  const cookie = await exchange(launch.base, launch.token);
  CRED = { base: launch.base, cookie, port: launch.port };
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(COOKIE_CACHE, JSON.stringify({ port: launch.port, cookie }), "utf8");
  } catch {
    /* 缓存写失败不影响本次 */
  }
  return CRED;
}

async function rpc(endpoint, args, isRetry) {
  const c = await cred(false);
  const body = {
    type: "client-request",
    rpcId: `${endpoint.replace(/\//g, "-")}-${Date.now().toString(36)}`,
    method: endpoint,
    payload: { args },
  };
  const res = await fetch(`${c.base}api/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: c.cookie },
    body: JSON.stringify(body),
  });
  if ((res.status === 401 || res.status === 403) && !isRetry) {
    await cred(true);
    return rpc(endpoint, args, true);
  }
  const t = await res.text();
  let j;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error(`${endpoint} 非 JSON (${res.status}): ${t.slice(0, 120)}`);
  }
  if (j.result?.ok !== true) throw new Error(`${endpoint} 失败: ${JSON.stringify(j.result?.error || j).slice(0, 240)}`);
  return j.result.value;
}

const listSessions = () => rpc("session/list", { _request: {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function conclusion(sessionId) {
  const items = (await listSessions()).items || [];
  const it = items.find((i) => i.sessionId === sessionId);
  if (!it) throw new Error(`会话不存在: ${sessionId}`);
  const value = await rpc("session/page", {
    request: { address: { kind: "session", sessionId }, throughSeq: it.projections.asOfSeq, maxMessages: 80 },
  });
  const events = (value.records || []).map((r) => r.event).filter(Boolean);
  let lastUser = -1;
  events.forEach((e, i) => {
    if (e.type === "user/message") lastUser = i;
  });
  for (let i = events.length - 1; i > lastUser; i -= 1) {
    const e = events[i];
    if (e.type === "assistant/message") {
      const parts = e.data?.message?.content || [];
      return { text: parts.filter((c) => c.type === "text").map((c) => c.text).join("\n") };
    }
    if (e.type === "turn/end" && e.data?.reason?.kind === "error") return { error: e.data.reason.error };
  }
  return { pending: true };
}

async function waitFor(sessionId, timeoutSec) {
  const deadline = Date.now() + (Number(timeoutSec) || 120) * 1000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const out = await conclusion(sessionId);
    if (!out.pending) return out;
  }
  return { pending: true, note: "等待超时，任务可能仍在运行" };
}

async function submit(sessionId, text, mode) {
  return rpc("session/prompt", {
    request: {
      requestId: `cli-${Date.now().toString(36)}`,
      sessionId,
      mode: mode === "steer" ? "steer" : "queue",
      content: [{ type: "text", text }],
    },
  });
}

const cmd = process.argv[2];

(async () => {
  try {
    if (cmd === "status") {
      const c = await cred(false);
      const items = (await listSessions()).items || [];
      const mod = await import("./dsh-core.mjs");
      const run = mod.LAST_RUN || {};
      console.log(
        JSON.stringify(
          {
            port: c.port,
            sessions: items.length,
            cookie: c.cookie.split("=")[0],
            dshWasRunning: !run.started,
            autoStarted: !!run.started,
            note: run.note || null,
            autostartEnabled: process.env.DSH_NO_AUTOSTART !== "1",
          },
          null,
          2,
        ),
      );
      return;
    }

    if (cmd === "list") {
      const limit = Number(arg("limit", 20));
      const items = (await listSessions()).items || [];
      console.log(`会话数: ${items.length}`);
      items.slice(0, limit).forEach((i) => {
        console.log(
          `- ${i.sessionId}  ${i.running ? "[运行中] " : ""}${(i.projections?.values?.title || "(无标题)").slice(0, 40)}`,
        );
      });
      return;
    }

    if (cmd === "open") {
      const text = arg("text");
      if (!text || text === true) throw new Error("需要 --text");
      const created = await rpc("session/create", { request: arg("cwd") && arg("cwd") !== true ? { cwd: arg("cwd") } : {} });
      console.log(`已建会话: ${created.sessionId}`);
      const sel = await rpc("session/selectModel", {
        request: { sessionId: created.sessionId, provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL },
      });
      console.log(`已选模型: ${sel.selected.provider}/${sel.selected.model}`);
      await submit(created.sessionId, String(text), arg("mode"));
      console.log("提示词已投递");
      if (arg("wait", false)) {
        const out = await waitFor(created.sessionId, arg("timeout", 120));
        console.log("回复:\n" + (out.text || JSON.stringify(out)));
      } else {
        console.log(`读回用: node bin/dsh.mjs read --session ${created.sessionId}`);
      }
      return;
    }

    if (cmd === "reply") {
      const sessionId = arg("session");
      const text = textArg();
      if (!sessionId || sessionId === true) throw new Error("需要 --session");
      if (!text || text === true) throw new Error("需要 --text");
      await submit(String(sessionId), String(text), arg("mode"));
      console.log(`已向 ${sessionId} 投递`);
      if (arg("wait", false)) {
        const out = await waitFor(String(sessionId), arg("timeout", 120));
        console.log("回复:\n" + (out.text || JSON.stringify(out)));
      }
      return;
    }

    if (cmd === "send") {
      const text = textArg();
      if (!text || text === true) throw new Error("需要 --text");
      const t0 = Date.now();
      let sessionId = arg("session");
      const newSession = !(sessionId && sessionId !== true);
      if (sessionId && sessionId !== true) {
        await submit(String(sessionId), String(text), arg("mode"));
        console.log(`已向 ${sessionId} 投递`);
      } else {
        const created = await rpc("session/create", { request: arg("cwd") && arg("cwd") !== true ? { cwd: arg("cwd") } : {} });
        sessionId = created.sessionId;
        await rpc("session/selectModel", {
          request: { sessionId, provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL },
        });
        await submit(String(sessionId), String(text), arg("mode"));
        console.log(`已建会话并投递: ${sessionId}`);
      }
      const out = await waitFor(String(sessionId), arg("timeout", 120));
      console.log("回复:\n" + (out.text || JSON.stringify(out)));
      await auditSafe("dsh", "send", {
        target: String(sessionId),
        ok: !out.pending,
        ms: Date.now() - t0,
        detail: { newSession, chars: String(text).length, timeoutSec: Number(arg("timeout", 120)) },
        error: out.pending ? "pending: wait timed out" : null,
      });
      return;
    }

    if (cmd === "read") {
      const sessionId = arg("session");
      if (!sessionId || sessionId === true) throw new Error("需要 --session");
      const out = await conclusion(String(sessionId));
      console.log(out.text || JSON.stringify(out, null, 2));
      return;
    }

    if (cmd === "cancel") {
      const sessionId = arg("session");
      if (!sessionId || sessionId === true) throw new Error("需要 --session");
      const out = await rpc("session/cancel", { request: { sessionId: String(sessionId) } });
      console.log(JSON.stringify(out));
      return;
    }

    console.log(
      [
        "用法：node bin/dsh.mjs <command> [options]",
        "  status                                    看端口、凭证、会话数",
        "  list [--limit 20]                         列会话",
        "  open --text <s> [--cwd <p>] [--wait]      建会话并投提示词",
        "  reply --session <id> (--text <s> | --text-file <path>) [--wait]   向已有会话续投",
        "  send (--text <s> | --text-file <path>) [--session <id>] [--cwd <p>] 一步到位并发等回复",
        "  read --session <id>                       读回最近一轮结论",
        "  cancel --session <id>                     取消在跑的任务",
      ].join("\n"),
    );
  } catch (ex) {
    console.error("dsh 出错：" + String(ex?.message || ex));
    process.exit(1);
  }
})();
