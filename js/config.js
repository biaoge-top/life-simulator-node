/* ============================================================
 * config.js — 全局配置（DeepSeek 接口参数 / 数值规则 / 年龄阶段）
 * ============================================================ */
(function (global) {
  'use strict';

  const CONFIG = {
    // 后端代理接口（DeepSeek Key 与提示词均在服务端，前端不接触）
    apiEndpoint: '/api/deepseek',
    temperature: 1.05,
    timeoutMs: 100000,  // 单次请求超时（略大于服务端 90s）
    maxRetries: 1,      // 失败重试次数
    maxTokens: {
      birth: 800,
      event: 2200,
      outcome: 700,
      ending: 2000
    }
  };

  // 七维动态属性元数据
  const ATTR_META = [
    { key: 'health',    name: '健康', icon: '❤', desc: '寿命与体魄' },
    { key: 'emotion',   name: '情感', icon: '☺', desc: '心态与幸福感' },
    { key: 'social',    name: '社会', icon: '☰', desc: '人脉与声望' },
    { key: 'wealth',    name: '资产', icon: '¥', desc: '18岁前为家境' },
    { key: 'knowledge', name: '学识', icon: '✎', desc: '智力与受教育水平' },
    { key: 'morality',  name: '品德', icon: '☖', desc: '心性与口碑' },
    { key: 'luck',      name: '运气', icon: '✦', desc: '动态浮动的运势' }
  ];

  // 单属性变动区间
  const EFFECT_LIMIT = { normal: 20, major: 30 };
  const ATTR_MIN = 0;
  const ATTR_MAX = 100;

  // 年龄阶段（step 返回每次事件结束后的年龄增长）
  const STAGES = [
    // 步长加大：一生约 20-30 次抉择（0岁起按阶段步进至寿命 80-100 岁）
    { name: '婴儿期', min: 0,  max: 2,   step: () => 1 + (Math.random() < 0.4 ? 1 : 0) },
    { name: '幼儿期', min: 3,  max: 6,   step: () => 2 },
    { name: '童年期', min: 7,  max: 12,  step: () => 2 + (Math.random() < 0.5 ? 1 : 0) },
    { name: '青春期', min: 13, max: 18,  step: () => 2 + (Math.random() < 0.5 ? 1 : 0) },
    { name: '青年期', min: 19, max: 30,  step: () => 3 + (Math.random() < 0.5 ? 1 : 0) },
    { name: '壮年期', min: 31, max: 45,  step: () => 4 + (Math.random() < 0.5 ? 1 : 0) },
    { name: '中年期', min: 46, max: 60,  step: () => 4 + (Math.random() < 0.5 ? 1 : 0) },
    { name: '老年期', min: 61, max: 80,  step: () => 4 + (Math.random() < 0.5 ? 1 : 0) },
    { name: '暮年期', min: 81, max: 199, step: () => 3 + (Math.random() < 0.5 ? 1 : 0) }
  ];

  // 资产单位即"万"（W）：wealth 数值 1:1 等于万元，如 wealth 85 = 85W
  const MONEY_PER_POINT = 1;
  function formatWan(points) {
    const wan = Math.round(points * MONEY_PER_POINT);
    const sign = wan > 0 ? '+' : '';
    if (Math.abs(wan) >= 10000) return sign + (wan / 10000).toFixed(1) + '亿';
    return sign + wan + 'W';
  }
  // 资产属性值 → 金额文本（如 85 → "85W"）
  function wealthToMoney(v) {
    if (v >= 10000) return (v / 10000).toFixed(1) + '亿';
    return v + 'W';
  }

  // 固定人生节点（到达该年龄 ± 容差时强制触发，由 AI 围绕节点生成剧情）
  const MILESTONES = [
    { age: 3,  label: '第一次上幼儿园' },
    { age: 7,  label: '正式入读小学' },
    { age: 13, label: '升入初中，步入青春期' },
    { age: 16, label: '中考与高中抉择' },
    { age: 18, label: '高考——人生第一场大考' },
    { age: 22, label: '大学毕业，初入社会' },
    { age: 28, label: '婚恋、成家的压力与选择' },
    { age: 60, label: '告别职场，退休生活' }
  ];

  // 属性极端区间提示（供 Prompt 注入）
  function attrLevel(key, v) {
    if (v >= 90) return '极佳';
    if (v >= 70) return '良好';
    if (v >= 40) return '普通';
    if (v >= 20) return '较差';
    return '病危/极低';
  }

  global.CONFIG = CONFIG;
  global.ATTR_META = ATTR_META;
  global.ATTR_KEYS = ATTR_META.map(a => a.key);
  global.EFFECT_LIMIT = EFFECT_LIMIT;
  global.ATTR_MIN = ATTR_MIN;
  global.ATTR_MAX = ATTR_MAX;
  global.STAGES = STAGES;
  global.MILESTONES = MILESTONES;
  global.MONEY_PER_POINT = MONEY_PER_POINT;
  global.formatWan = formatWan;
  global.wealthToMoney = wealthToMoney;
  global.attrLevel = attrLevel;
})(window);
