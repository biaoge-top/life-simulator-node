/* ============================================================
 * deepseek.js — AI 代理客户端
 * 请求发送到本站 PHP 后端（api/deepseek.php），由服务端拼装固定
 * 提示词并携带 Key 调用 DeepSeek；前端只传场景参数与角色状态，
 * 永远不接触 API Key，也无法篡改系统提示词。
 * - AbortController 超时
 * - 网络/解析错误自动重试
 * ============================================================ */
(function (global) {
  'use strict';

  /**
   * 调用后端代理，期望模型返回 JSON 对象
   * @param {{kind:'birth'|'event'|'outcome'|'ending', state:object, extra?:object}} payload
   * @param {object} [_opts] 兼容旧调用（maxTokens 等由服务端决定）
   * @returns {Promise<object>} 解析后的 JSON 对象
   */
  async function chatJSON(payload, _opts) {
    const maxRetries = CONFIG.maxRetries;
    let lastErr;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const content = await doRequest(payload);
        return parseJsonLoose(content);
      } catch (err) {
        lastErr = err;
        console.warn('AI 请求失败（第 ' + (attempt + 1) + ' 次）：', err.message);
        if (attempt < maxRetries) {
          await sleep(700 * (attempt + 1));
        }
      }
    }
    throw lastErr || new Error('AI 接口调用失败');
  }

  async function doRequest(payload) {
    const endpoint = StorageX.effectiveEndpoint();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

    let resp;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('AI 响应超时，请检查网络后重试');
      throw new Error('网络异常，无法连接后端接口：' + e.message);
    }
    clearTimeout(timer);

    if (!resp.ok) {
      let msg = '';
      try { msg = (await resp.json()).error || ''; } catch (_) { /* ignore */ }
      if (resp.status === 429) throw new Error(msg || '请求过于频繁，请稍后再试');
      if (resp.status === 404) throw new Error('未找到后端接口（需用 PHP 环境运行，如 php -S localhost:8000）');
      throw new Error(msg || ('后端接口返回错误 ' + resp.status));
    }

    const data = await resp.json();
    if (!data || typeof data.content !== 'string' || !data.content.trim()) {
      throw new Error('AI 返回内容为空');
    }
    return data.content;
  }

  // 宽松 JSON 解析：去掉可能的 ```json 包裹、截取首个 { 到末个 }
  function parseJsonLoose(text) {
    let t = text.trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    }
    try {
      return JSON.parse(t);
    } catch (_) {
      const start = t.indexOf('{');
      const end = t.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(t.slice(start, end + 1));
      }
      throw new Error('AI 返回不是合法 JSON');
    }
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  global.DeepSeek = { chatJSON };
})(window);
