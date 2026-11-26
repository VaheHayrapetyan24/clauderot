#!/usr/bin/env node
// clauderot — YouTube Shorts while Claude works.
// Zero dependencies: drives a dedicated Chrome/Chromium window over the
// DevTools protocol using Node 22+'s built-in fetch and WebSocket.
//
//   clauderot.js start          (UserPromptSubmit hook) schedule the player
//   clauderot.js stop [reason]  (Stop / Notification hooks) pause the player
//   clauderot.js on | off       enable / disable the plugin
//   clauderot.js close          close the player window
//   clauderot.js status         print current state

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOME = process.env.CLAUDEROT_HOME || path.join(os.homedir(), '.clauderot');
const STATE = path.join(HOME, 'state.json');
const DISABLED = path.join(HOME, 'disabled');
const PROFILE = path.join(HOME, 'chrome-profile');
const PORT = Number(process.env.CLAUDEROT_PORT || 9877);
const DELAY = Number(process.env.CLAUDEROT_DELAY ?? 3); // seconds before the window appears
const ON_STOP = process.env.CLAUDEROT_ON_STOP || 'pause'; // pause | close
const URL = process.env.CLAUDEROT_URL || 'https://www.youtube.com/shorts';
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(HOME, { recursive: true });

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const writeState = (s) => fs.writeFileSync(STATE, JSON.stringify(s));
const log = (...a) => { try { fs.appendFileSync(path.join(HOME, 'clauderot.log'), `${new Date().toISOString()} ${a.join(' ')}\n`); } catch {} };

// ---------- the script injected into the YouTube page ----------
const PAGE_SCRIPT = String.raw`(() => {
  if (window.__clauderot) return 'present';
  const S = { paused: false, lastId: null, lastT: 0, advancedAt: 0, banner: null };
  const activeVideo = () =>
    document.querySelector('ytd-reel-video-renderer[is-active] video') ||
    [...document.querySelectorAll('video')].find(v => !v.paused && v.readyState > 2) ||
    document.querySelector('#shorts-player video, video');

  const next = () => {
    S.advancedAt = Date.now();
    const btn = document.querySelector(
      '#navigation-button-down button, #navigation-button-down [role="button"], button[aria-label="Next video"]');
    if (btn) { btn.click(); return; }
    const ev = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', ev));
  };

  const banner = (text) => {
    if (S.banner) { S.banner.remove(); S.banner = null; }
    if (!text) return;
    const d = document.createElement('div');
    d.textContent = text;
    Object.assign(d.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: 2147483647,
      padding: '14px', font: '600 16px system-ui, sans-serif', textAlign: 'center',
      background: '#d97757', color: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.4)', cursor: 'pointer'
    });
    d.onclick = () => banner(null);
    document.documentElement.appendChild(d);
    S.banner = d;
  };

  setInterval(() => {
    const v = activeVideo();
    if (S.paused) { if (v && !v.paused) v.pause(); return; }
    if (!location.pathname.startsWith('/shorts') || !v || !(v.duration > 0)) return;
    const id = location.pathname, t = v.currentTime, d = v.duration;
    if (id !== S.lastId) { S.lastId = id; S.lastT = t; return; }
    // Shorts loop forever, so "finished" = near the end, or wrapped from end back to start.
    const nearEnd = t >= d - 0.3;
    const wrapped = S.lastT >= d - 1.5 && t < 1;
    S.lastT = t;
    if ((nearEnd || wrapped) && Date.now() - S.advancedAt > 2000) next();
  }, 200);

  window.__clauderot = {
    pause(msg) { S.paused = true; const v = activeVideo(); if (v) v.pause(); banner(msg); },
    resume() {
      S.paused = false; banner(null);
      const v = activeVideo(); if (v && v.paused) v.play().catch(() => {});
    },
    next,
  };
  return 'injected';
})()`;

// ---------- minimal DevTools protocol client ----------
async function getJSON(p, method = 'GET') {
  const r = await fetch(BASE + p, { method, signal: AbortSignal.timeout(1000) });
  return r.json();
}
const browserUp = async () => { try { await getJSON('/json/version'); return true; } catch { return false; } };

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    ws.onerror = () => reject(new Error('websocket error'));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res) => {
        const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

async function evalIn(target, expression) {
  const c = await cdp(target.webSocketDebuggerUrl);
  try {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  } finally { c.close(); }
}

async function youtubePage() {
  const list = await getJSON('/json/list');
  return list.find((t) => t.type === 'page' && t.url.includes('youtube.com'));
}

function findBrowser() {
  if (process.env.CLAUDEROT_BROWSER) return process.env.CLAUDEROT_BROWSER;
  const candidates = {
    linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser', 'microsoft-edge'],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    win32: [
      `${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ],
  }[process.platform] || [];
  for (const c of candidates) {
    if (path.isAbsolute(c)) { if (fs.existsSync(c)) return c; continue; }
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (fs.existsSync(path.join(dir, c))) return path.join(dir, c);
    }
  }
  return null;
}

function launchBrowser() {
  const bin = findBrowser();
  if (!bin) { log('no Chrome/Chromium found; set CLAUDEROT_BROWSER'); return false; }
  const child = spawn(bin, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=440,820',
    `--app=${URL}`,
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

// Inject once YouTube's app shell exists (injecting earlier can land in a
// throwaway document). Idempotent, so it's safe to call every time.
async function ensureInjected(page) {
  for (let i = 0; i < 60; i++) {
    try {
      if (await evalIn(page, '!!document.querySelector("ytd-app")')) {
        const r = await evalIn(page, PAGE_SCRIPT);
        if (await evalIn(page, 'typeof window.__clauderot === "object"')) return r;
      }
    } catch {}
    await sleep(250);
  }
  return 'inject-failed';
}

// ---------- commands ----------
async function show() {
  if (!(await browserUp())) {
    if (!launchBrowser()) return;
    for (let i = 0; i < 60 && !(await browserUp()); i++) await sleep(250);
  }
  let page;
  for (let i = 0; i < 60; i++) {
    page = await youtubePage().catch(() => null);
    if (page) break;
    if (i === 8) await getJSON(`/json/new?${URL}`, 'PUT').catch(() => {});
    await sleep(250);
  }
  if (!page) { log('youtube page never appeared'); return; }
  const r = await ensureInjected(page);
  await evalIn(page, 'window.__clauderot.resume()');
  await getJSON(`/json/activate/${page.id}`).catch(() => {});
  log('show', r);
}

async function worker(token) {
  await sleep(DELAY * 1000);
  const s = readState();
  // Claude already finished, is waiting on you, or a newer prompt took over.
  if (!s.busy || s.awaiting || s.token !== token || fs.existsSync(DISABLED)) return;
  await show();
}

// PostToolUse: runs after every tool call, so it must be cheap. It only acts
// when we paused for a prompt, which means you just answered it.
async function resume() {
  const s = readState();
  if (!s.busy || !s.awaiting || fs.existsSync(DISABLED)) return;
  writeState({ ...s, awaiting: false });
  if (await browserUp()) {
    const page = await youtubePage().catch(() => null);
    if (page) { await ensureInjected(page); await evalIn(page, 'window.__clauderot.resume()').catch(() => {}); }
  } else {
    // Prompt came before the player opened: open it now.
    spawn(process.execPath, [__filename, '_worker', s.token], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function stop(reason) {
  const s = readState();
  if (reason === 'attention') {
    // Claude is blocked on you (permission prompt, question). Ignore the
    // "idle" notification that arrives after Claude already finished.
    if (!s.busy) return;
    writeState({ ...s, awaiting: true });
  } else {
    writeState({ busy: false });
  }
  if (!(await browserUp())) return;
  if (ON_STOP === 'close') return close();
  const page = await youtubePage().catch(() => null);
  if (!page) return;
  const msg = reason === 'attention' ? '✋ Claude needs your input' : '✅ Claude is done — back to work';
  await ensureInjected(page);
  await evalIn(page, `window.__clauderot.pause(${JSON.stringify(msg)})`).catch(() => {});
}

async function close() {
  writeState({ busy: false });
  try {
    const { webSocketDebuggerUrl } = await getJSON('/json/version');
    const c = await cdp(webSocketDebuggerUrl);
    await c.send('Browser.close');
    c.close();
  } catch {}
}

async function main() {
  const [cmd = 'status', arg] = process.argv.slice(2);
  switch (cmd) {
    case 'start': {
      if (fs.existsSync(DISABLED)) return;
      const token = `${Date.now()}-${process.pid}`;
      writeState({ busy: true, token });
      // Detach a worker so the hook returns instantly.
      spawn(process.execPath, [__filename, '_worker', token], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    case '_worker': return worker(arg);
    case 'show': return show();
    case 'stop': return stop(arg);
    case 'resume': return resume();
    case 'close': await close(); return console.log('clauderot: player closed');
    case 'off': fs.writeFileSync(DISABLED, ''); await close(); return console.log('clauderot: disabled');
    case 'on': fs.rmSync(DISABLED, { force: true }); return console.log('clauderot: enabled');
    case 'status':
      return console.log(`clauderot: ${fs.existsSync(DISABLED) ? 'disabled' : 'enabled'}, ` +
        `player ${(await browserUp()) ? 'open' : 'closed'}, claude ${readState().busy ? 'working' : 'idle'}`);
    default: console.log('usage: clauderot.js start|stop|on|off|close|status');
  }
}

main().catch((e) => { log('error', e.stack || e); }).finally(() => {
  // Hooks must never fail Claude's turn.
  process.exitCode = 0;
});
