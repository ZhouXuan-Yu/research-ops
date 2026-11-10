/**
 * dsh-core —— 桌面 DSH 的 RPC 内核（CLI 与 MCP 共用）。
 * 自带凭证链：读 harness.log 最后一条启动行 → 换 cookie → 缓存（端口变则重取）。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { connect as netConnect } from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

/**
 * 同步读取 limbs/config.json。
 * 不用 import limbs/config.mjs：dsh-core 可能被单独拷走，且顶层 await 会影响 DSH 加载时机。
 * 读不到就用内置默认值，保证本模块独立可用。
 */
function readLimbsConfig() {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), "../../limbs/config.json");
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
const LIMBS = readLimbsConfig();

export const STATE_DIR = LIMBS?.stateDir || "C:/Users/ZhouXuan/.hanako/app-data/dshdesk";
export const LOG_PATH =
  LIMBS?.dsh?.logPath || join("C:\\Users\\ZhouXuan\\AppData\\Roaming\\dsh-desktop\\logs", "harness.log");
const COOKIE_CACHE = join(STATE_DIR, "cli-cookie.json");
export const DEFAULT_PROVIDER = LIMBS?.dsh?.provider || "deepseek-official";
export const DEFAULT_MODEL = LIMBS?.dsh?.model || "deepseek-flash";

let CRED = null;

/* ------------------------- 自动拉起桌面 DSH ------------------------- */

const DSH_EXE = LIMBS?.dsh?.exe || "D:\\DSH\\DSH Desktop\\DSH Desktop.exe";
const AUTOSTART = process.env.DSH_NO_AUTOSTART !== "1";

/** 端口是否在监听（连通即视为在运行）。 */
function portOpen(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        try {
          sock.destroy();
        } catch {
          /* 忽略 */
        }
        resolve(v);
      }
    };
    const sock = netConnect({ host: "127.0.0.1", port });
    sock.on("connect", () => finish(true));
    sock.on("error", () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * 连续多轮探活，任一轮连通即视为在运行。
 * 单次探活受瞬时拒绝或超时影响会误判「未运行」，进而触发 launchDsh；
 * 而 DSH 是单实例应用，误拉起会让旧实例退出、正在跑的任务中断。
 * 2026-10-19 实测出现过一次误判（端口本来在监听却被判为不通）。
 */
async function portOpenStable(port, rounds = 3, gapMs = 400) {
  for (let i = 0; i < rounds; i++) {
    if (await portOpen(port)) return true;
    if (i < rounds - 1) await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

async function waitPortOpen(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

/** 启动桌面 DSH（独立进程，不阻塞）。两级机制：直 spawn → 失败则用 PowerShell Start-Process。 */
async function launchDsh() {
  const before = await dshProcessCount();
  try {
    const child = spawn(DSH_EXE, [], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    /* 交给下一级 */
  }
  if (await waitProcessCount(before, 5000)) {
    await auditSafe("dsh", "launch", { target: "DSH Desktop", ok: true, detail: { how: "spawn" } });
    return "spawn";
  }
  try {
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-Command", `Start-Process -FilePath '${DSH_EXE}'`],
      { detached: true, stdio: "ignore" },
    );
    ps.unref();
  } catch {
    /* 两级都失败就上报 */
  }
  if (await waitProcessCount(before, 8000)) {
    await auditSafe("dsh", "launch", { target: "DSH Desktop", ok: true, detail: { how: "powershell" } });
    return "powershell";
  }
  await auditSafe("dsh", "launch", { target: "DSH Desktop", ok: false, error: "both launch methods failed" });
  return null;
}

/** 数一下 DSH Desktop 进程数（用 tasklist，避受权限影响）。 */
function dshProcessCount() {
  return new Promise((resolve) => {
    try {
      const p = spawn("tasklist", ["/FI", "IMAGENAME eq DSH Desktop.exe", "/NH"], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      p.stdout.on("data", (c) => (out += c.toString()));
      p.on("close", () => resolve((out.match(/DSH Desktop\.exe/g) || []).length));
      p.on("error", () => resolve(-1));
    } catch {
      resolve(-1);
    }
  });
}

async function waitProcessCount(before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = await dshProcessCount();
    if (now > before && now > 0) return true;
  }
  return false;
}

/** 等日志里出现一条不同于 prevToken 的启动行。 */
async function waitNewLaunch(prevToken, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const l = lastLaunch();
      if (l && l.token !== prevToken) return l;
    } catch {
      /* 日志还没写就继续等 */
    }
  }
  return null;
}

/** 审计是可选增强，模块不在也不能影响 DSH 调用链。 */
async function auditSafe(actor, action, opts) {
  try {
    const m = await import("../../limbs/audit.mjs");
    m.audit(actor, action, opts);
  } catch {
    /* 审计不可用，不影响主流程 */
  }
}

let ENSURE_INFLIGHT = null;

/** 确保 DSH 在运行；不在就拉起并等到出现新的启动行。返回 { launch, started, note }。 */
export async function ensureRunning(timeoutMs = 120000) {
  // 进程内单飞：并发调用（例如 Promise.all 一次性下发三路）共用同一次探活与拉起。
  // 否则每路各自 spawn，同一实例被反复顶掉。2026-10-19 并发测试实测出现过三路同时拉起。
  if (ENSURE_INFLIGHT) return ENSURE_INFLIGHT;
  const p = ensureRunningOnce(timeoutMs).finally(() => {
    if (ENSURE_INFLIGHT === p) ENSURE_INFLIGHT = null;
  });
  ENSURE_INFLIGHT = p;
  return p;
}

async function ensureRunningOnce(timeoutMs = 120000) {
  let launch = null;
  try {
    launch = lastLaunch();
  } catch {
    launch = null;
  }

  if (launch && (await portOpenStable(launch.port))) {
    return { launch, started: false };
  }

  // 进程守卫：进程还在但端口不通时，绝不 spawn。
  // DSH 是单实例应用，spawn 会顶掉正在运行的实例，在跑的任务随之中断。
  // 宁可上报「不通」，也不擅自杀掉活着的进程。
  const alive = await dshProcessCount();
  if (alive > 0) {
    if (launch && (await waitPortOpen(launch.port, 15000))) {
      return { launch, started: false, note: "port recovered after wait" };
    }
    return {
      launch,
      started: false,
      note: `DSH process alive (${alive}) but port ${launch?.port ?? "?"} not answering; refusing to spawn`,
    };
  }

  if (!AUTOSTART) {
    return { launch, started: false, note: "检测到 DSH 未运行，但已禁用自动拉起（DSH_NO_AUTOSTART=1）" };
  }

  // 未运行：拉起桌面 DSH 并等新启动行
  let started = false;
  let how = null;
  try {
    how = await launchDsh();
    started = !!how;
  } catch (ex) {
    return { launch, started: false, note: "拉起失败：" + String(ex?.message || ex) };
  }
  if (!started) {
    return { launch, started: false, note: "两种方式都未能拉起 DSH，请手动启动 DSH Desktop" };
  }
  const fresh = await waitNewLaunch(launch ? launch.token : null, timeoutMs);
  if (!fresh) {
    return { launch, started, note: `已拉起但 ${Math.round(timeoutMs / 1000)} 秒内未见服务就绪，请到桌面确认` };
  }
  return { launch: fresh, started, note: `已自动拉起桌面 DSH（方式：${how}）` };
}

export function lastLaunch() {
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

export let LAST_RUN = null;

export async function cred(force) {
  // 日志可能因沙箱不可读，所以整条链做成可降级：日志 → 缓存文件 → App 写的 cookie.txt
  // 并且在使用前先确认 DSH 在运行；不在运行就拉起（可用 DSH_NO_AUTOSTART=1 关闭）
  let launch = null;
  try {
    const run = await ensureRunning();
    LAST_RUN = run;
    launch = run.launch;
    if (run.note) process.stderr.write("[dsh] " + run.note + "\n");
  } catch {
    launch = null;
  }

  if (!launch) {
    if (!force && CRED) return CRED;
    try {
      const c = JSON.parse(readFileSync(COOKIE_CACHE, "utf8"));
      if (c && c.cookie) {
        CRED = { base: "http://127.0.0.1:" + (c.port || 43129) + "/", cookie: c.cookie, port: c.port || 43129 };
        return CRED;
      }
    } catch {
      /* 继续 */
    }
    try {
      const txt = readFileSync(join(STATE_DIR, "cookie.txt"), "utf8").trim();
      const m = txt.match(/^(dsh-auth-[^=]+=[^;]+)/);
      if (m) {
        CRED = { base: "http://127.0.0.1:43129/", cookie: m[1], port: 43129 };
        return CRED;
      }
    } catch {
      /* 继续 */
    }
    throw new Error("日志不可读，且没有可用的凭证缓存");
  }

  if (!force && CRED && CRED.port === launch.port) return CRED;
  if (!force) {
    try {
      const c = JSON.parse(readFileSync(COOKIE_CACHE, "utf8"));
      if (c && c.port === launch.port && c.cookie) {
        CRED = { base: launch.base, cookie: c.cookie, port: launch.port };
        return CRED;
      }
    } catch {
      /* 无缓存则换 */
    }
  }
  const cookie = await exchange(launch.base, launch.token);
  CRED = { base: launch.base, cookie, port: launch.port };
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(COOKIE_CACHE, JSON.stringify({ port: launch.port, cookie }), "utf8");
  } catch {
    /* 忽略 */
  }
  return CRED;
}

export async function rpc(endpoint, args, isRetry) {
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

export const listSessions = () => rpc("session/list", { _request: {} });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function conclusion(sessionId) {
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

export async function waitFor(sessionId, timeoutSec) {
  const deadline = Date.now() + (Number(timeoutSec) || 120) * 1000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const out = await conclusion(sessionId);
    if (!out.pending) return out;
  }
  return { pending: true, note: "等待超时，任务可能仍在运行" };
}

export async function submit(sessionId, text, mode) {
  return rpc("session/prompt", {
    request: {
      requestId: `dsh-${Date.now().toString(36)}`,
      sessionId,
      mode: mode === "steer" ? "steer" : "queue",
      content: [{ type: "text", text }],
    },
  });
}

/** 一步到位：有 sessionId 就续投，否则建会话并选模型；随后等待回复。 */
export async function send({ text, sessionId, cwd, mode, timeoutSec }) {
  const t0 = Date.now();
  const newSession = !sessionId;
  let sid = sessionId;
  if (!sid) {
    const created = await rpc("session/create", { request: cwd ? { cwd } : {} });
    sid = created.sessionId;
    await rpc("session/selectModel", { request: { sessionId: sid, provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL } });
  }
  await submit(sid, text, mode);
  const out = await waitFor(sid, timeoutSec || 120);
  await auditSafe("dsh", "send", {
    target: sid,
    ok: !out.pending,
    ms: Date.now() - t0,
    detail: { newSession, chars: String(text || "").length, timeoutSec: timeoutSec || 120 },
    error: out.pending ? "pending: wait timed out" : null,
  });
  return { sessionId: sid, ...out };
}
