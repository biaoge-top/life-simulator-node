/* ============================================================
 * prompts.js — 前端展示辅助（属性名映射 / 结局倾向 / 变动文案）
 * 注意：所有发给 AI 的提示词均已移至服务端 api/prompts.php，
 * 前端不再持有任何系统提示词，防止被查看或篡改。
 * ============================================================ */
(function (global) {
  'use strict';

  const ATTR_NAME = {
    health: '健康', emotion: '情感', social: '社会', wealth: '资产',
    knowledge: '学识', morality: '品德', luck: '运气'
  };

  // 属性变动 → 中文文案（用于本地降级结果提示）
  function formatEffects(effects) {
    const keys = Object.keys(effects || {}).filter(k => ATTR_NAME[k]);
    if (!keys.length) return '无明显变化';
    return keys.map(k => ATTR_NAME[k] + (effects[k] > 0 ? '+' : '') + effects[k]).join('，');
  }

  // 结局倾向（本地降级/界面展示用；AI 结局时由服务端判定）
  function endingTier(state) {
    const a = state.attrs;
    const avg = (a.health + a.emotion + a.social + Math.min(100, a.wealth) + a.knowledge + a.morality) / 6;
    if (state.age < 40) return { label: '悲剧结局', hint: '英年早逝，人生戛然而止，基调悲怆' };
    if (avg >= 75 && a.wealth >= 300) return { label: '传奇结局', hint: '成就卓越、人生圆满，可写得传奇色彩' };
    if (avg >= 60) return { label: '顺遂结局', hint: '一生平稳安康，平淡中见幸福' };
    if (avg >= 42) return { label: '浮沉结局', hint: '有起有落，苦乐参半' };
    return { label: '坎坷/悲剧结局', hint: '多灾多难、挣扎求生，基调沉重但保留尊严' };
  }

  global.Prompts = { formatEffects, endingTier, ATTR_NAME };
})(window);
