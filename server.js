/* ============================================================
 * server.js — 人生模拟器 Node 版（零依赖，Node 14+）
 * 职责：
 *  1. 静态托管前端（index.html / styles.css / js/*）
 *  2. POST /api/deepseek —— 游戏 AI 代理：
 *     固定提示词在服务端拼装，DeepSeek Key 只在服务端，
 *     前端永远不接触 Key，也无法篡改系统提示词
 *  3. 每 IP 限流 + 请求体大小限制，防盗刷余额
 * ============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { buildRequest } = require('./prompts');

/* ---------------- 配置（环境变量 / .env） ---------------- */
loadEnv(path.join(__dirname, '.env'));

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const AI_TIMEOUT_MS = 90000;       // 单次 AI 请求超时
const MAX_BODY_BYTES = 256 * 1024; // 前端请求体上限 256KB，防滥用
const RATE_LIMIT = 30;             // 每 IP 每分钟最多请求次数，防盗刷
const RATE_WINDOW_MS = 60 * 1000;

const ALLOWED_KINDS = new Set(['birth', 'event', 'outcome', 'ending']);

/* ---------------- 简单 .env 解析（零依赖） ---------------- */
function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch (_) { /* .env 不存在则忽略 */ }
}

/* ---------------- 内存限流：每 IP 每分钟 N 次 ---------------- */
const rateBuckets = new Map(); // ip -> { start, count }
function rateLimited(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.start >= RATE_WINDOW_MS) {
    b = { start: now, count: 0 };
    rateBuckets.set(ip, b);
  }
  b.count++;
  if (rateBuckets.size > 5000) rateBuckets.clear(); // 防内存膨胀
  return b.count > RATE_LIMIT;
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(__dirname, urlPath));
  if (!file.startsWith(__dirname) || urlPath.includes('..')) {
    return send(res, 403, { error: '禁止访问' });
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: '文件不存在' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

/* ---------------- 响应工具 ---------------- */
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------------- AI 代理 ---------------- */
async function handleAI(req, res) {
  if (!API_KEY) return send(res, 500, { error: '服务端未配置 DEEPSEEK_API_KEY，请设置环境变量或 .env' });

  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return send(res, 429, { error: '请求过于频繁，请稍后再试' });

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, { error: '请求体不是合法 JSON 或超出大小限制' });
  }

  const kind = body.kind;
  if (!ALLOWED_KINDS.has(kind)) return send(res, 400, { error: '未知的场景类型' });

  const state = body.state;
  if (!state || typeof state !== 'object' || !state.attrs || state.age === undefined) {
    return send(res, 400, { error: '角色状态不完整' });
  }
  // 服务端约束：履历只取最近 40 条，防止超长请求刷 token
  if (Array.isArray(state.history)) state.history = state.history.slice(-40);
  const extra = (body.extra && typeof body.extra === 'object') ? body.extra : {};

  const reqSpec = buildRequest(kind, state, extra);
  if (!reqSpec) return send(res, 400, { error: '未知的场景类型' });

  try {
    const upstream = await postJSON(BASE_URL + '/chat/completions', {
      model: MODEL,
      messages: reqSpec.messages,
      temperature: reqSpec.temperature,
      max_tokens: reqSpec.max_tokens,
      response_format: { type: 'json_object' },
      stream: false
    }, { 'Authorization': 'Bearer ' + API_KEY });

    const data = upstream.json;
    if (upstream.status === 401) return send(res, 502, { error: '服务端 API Key 无效或已过期' });
    if (upstream.status === 429) return send(res, 429, { error: 'AI 服务繁忙或额度不足，请稍后再试' });
    if (upstream.status < 200 || upstream.status >= 300) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + upstream.status);
      return send(res, 502, { error: 'AI 服务返回错误：' + msg });
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    if (!content || !String(content).trim()) return send(res, 502, { error: 'AI 返回内容为空' });
    send(res, 200, { content });
  } catch (e) {
    if (e.message === 'timeout') return send(res, 502, { error: 'AI 响应超时' });
    send(res, 502, { error: '无法连接 AI 服务：' + e.message });
  }
}

/* ---------------- HTTPS POST（Node 14+ 通用，零依赖） ---------------- */
function postJSON(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'POST',
      timeout: AI_TIMEOUT_MS,
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': body.length
      }, headers || {})
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* 保留 null */ }
        resolve({ status: resp.statusCode, json });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ---------------- 入口 ---------------- */
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url && req.url.split('?')[0] === '/api/deepseek') {
    handleAI(req, res).catch(e => send(res, 500, { error: '服务器内部错误：' + e.message }));
    return;
  }
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: '方法不允许' });
});

server.listen(PORT, () => {
  console.log(`人生模拟器（Node 版）已启动: http://localhost:${PORT}`);
  if (!API_KEY) console.warn('警告：未配置 DEEPSEEK_API_KEY，AI 功能不可用（可在 .env 中配置）');
});
