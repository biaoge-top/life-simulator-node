/* ============================================================
 * talents.js — 出生天赋池 & 新角色随机生成
 * ============================================================ */
(function (global) {
  'use strict';

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = v => Math.max(0, Math.min(100, Math.round(v)));

  /* 天赋定义
   * tier: 普通天赋 / 优秀天赋 / 逆天天赋 / 缺陷天赋
   * mod: 属性修正钩子，参数 (key, delta) 返回修正后的 delta
   */
  const TALENTS = [
    {
      id: 'strong', tier: '优秀天赋', name: '体魄强健',
      desc: '健康类增益效果 +20%，更易长寿',
      mod: (k, d) => (k === 'health' && d > 0) ? d * 1.2 : d
    },
    {
      id: 'genius', tier: '逆天天赋', name: '天资聪颖',
      desc: '学识类增益效果 +30%，考试学习事半功倍',
      mod: (k, d) => (k === 'knowledge' && d > 0) ? d * 1.3 : d
    },
    {
      id: 'sickly', tier: '缺陷天赋', name: '体弱多病',
      desc: '健康损耗 +15%，幼年多灾',
      mod: (k, d) => (k === 'health' && d < 0) ? d * 1.15 : d
    },
    {
      id: 'charm', tier: '优秀天赋', name: '情商卓绝',
      desc: '情感与社会类增益 +20%',
      mod: (k, d) => ((k === 'emotion' || k === 'social') && d > 0) ? d * 1.2 : d
    },
    {
      id: 'tough', tier: '普通天赋', name: '坚韧不拔',
      desc: '情感类损耗 -20%，逆境中不易崩溃',
      mod: (k, d) => (k === 'emotion' && d < 0) ? d * 0.8 : d
    },
    {
      id: 'lucky', tier: '逆天天赋', name: '福星高照',
      desc: '运气类增益 +30%，运势更容易回升',
      mod: (k, d) => (k === 'luck' && d > 0) ? d * 1.3 : d,
      luckBias: true
    },
    {
      id: 'rich', tier: '优秀天赋', name: '富贵之家',
      desc: '出生即罗马：初始家庭资产大幅提高',
      family: 'rich'
    },
    {
      id: 'poor', tier: '缺陷天赋', name: '寒门子弟',
      desc: '家境贫寒，初始资产低；逆境磨砺使情感损耗 -10%',
      family: 'poor',
      mod: (k, d) => (k === 'emotion' && d < 0) ? d * 0.9 : d
    },
    {
      id: 'virtue', tier: '普通天赋', name: '赤子之心',
      desc: '品德类增益 +25%，天生良善',
      mod: (k, d) => (k === 'morality' && d > 0) ? d * 1.25 : d
    },
    {
      id: 'silver', tier: '普通天赋', name: '口才伶俐',
      desc: '社会类增益 +20%，与人打交道不吃亏',
      mod: (k, d) => (k === 'social' && d > 0) ? d * 1.2 : d
    },
    {
      id: 'beauty', tier: '优秀天赋', name: '容貌出众',
      desc: '初始社会评价更高，情感增益 +15%',
      mod: (k, d) => (k === 'emotion' && d > 0) ? d * 1.15 : d,
      initBonus: { social: 12 }
    },
    {
      id: 'introvert', tier: '缺陷天赋', name: '内向敏感',
      desc: '社会类损耗 +15%，但沉静带来学识增益 +15%',
      mod: function (k, d) {
        if (k === 'social' && d < 0) return d * 1.15;
        if (k === 'knowledge' && d > 0) return d * 1.15;
        return d;
      }
    }
  ];

  // 抽取天赋：70% 一个，30% 两个；缺陷天赋最多一个；至少有一个非缺陷天赋
  function rollTalents() {
    const count = Math.random() < 0.3 ? 2 : 1;
    const pool = TALENTS.slice();
    const result = [];
    let safety = 0;
    while (result.length < count && safety++ < 50) {
      const t = pick(pool);
      if (result.some(r => r.id === t.id)) continue;
      if (t.tier === '缺陷天赋' && result.some(r => r.tier === '缺陷天赋')) continue;
      if (count === 2 && t.family === 'poor' && Math.random() < 0.5) continue;
      result.push(t);
    }
    if (result.every(t => t.tier === '缺陷天赋')) {
      const nonDefect = TALENTS.filter(t => t.tier !== '缺陷天赋' && !result.some(r => r.id === t.id));
      result[0] = pick(nonDefect);
    }
    // 富贫家境天赋互斥
    if (result.some(t => t.family === 'rich')) {
      const idx = result.findIndex(t => t.family === 'poor');
      if (idx >= 0) result.splice(idx, 1, pick(TALENTS.filter(t => !t.family && t.id !== result[0].id)));
    }
    return result;
  }

  // 家境分层（wealth 数值直接以"万"为单位）
  function familyTier(wealth) {
    if (wealth >= 200) return { level: '富裕', desc: '家境优渥，衣食无忧，父母能提供优质教育资源' };
    if (wealth >= 60)  return { level: '小康', desc: '家境殷实安稳，有房有存款，生活体面' };
    if (wealth >= 20)  return { level: '普通', desc: '普通工薪/务农家庭，家境一般，凡事需自己努力' };
    if (wealth >= 8)   return { level: '拮据', desc: '家境拮据，父母为生计奔波，用钱常需精打细算' };
    return { level: '贫困', desc: '一贫如洗，负债或低保边缘，童年早早尝到生活的苦' };
  }

  /* 生成一个新角色的初始状态（不含剧情，剧情由 AI 生成） */
  function createCharacter() {
    const gender = Math.random() < 0.51 ? '男' : '女';
    const talents = rollTalents();
    const familyTalent = talents.find(t => t.family);

    let wealth; // 单位：万（W）
    if (familyTalent && familyTalent.family === 'rich') wealth = rand(200, 600);
    else if (familyTalent && familyTalent.family === 'poor') wealth = rand(3, 16);
    else wealth = rand(20, 120);

    const attrs = {
      health:    clamp(rand(74, 96) + (talents.some(t => t.id === 'sickly') ? -15 : 0) + (talents.some(t => t.id === 'strong') ? 5 : 0)),
      emotion:   clamp(rand(58, 82)),
      social:    clamp(rand(35, 62)),
      wealth:    Math.max(0, wealth), // 资产无上限，单位万
      knowledge: rand(0, 6),
      morality:  clamp(rand(52, 72)),
      luck:      clamp(rand(35, 72) + (talents.some(t => t.id === 'lucky') ? 12 : 0))
    };

    // 天赋初始加成
    talents.forEach(t => {
      if (t.initBonus) {
        Object.keys(t.initBonus).forEach(k => {
          attrs[k] = clamp(attrs[k] + t.initBonus[k]);
        });
      }
    });

    // 寿命：50-100 三角分布（均值约 75），受初始健康与天赋微调
    let lifespan = 50 + rand(0, 25) + rand(0, 25);
    lifespan += Math.round((attrs.health - 80) * 0.2);
    if (talents.some(t => t.id === 'strong')) lifespan += rand(2, 5);
    if (talents.some(t => t.id === 'sickly')) lifespan -= rand(2, 6);
    lifespan = Math.max(50, Math.min(100, lifespan));

    return {
      gender,
      talents: talents.map(t => ({ id: t.id, tier: t.tier, name: t.name, desc: t.desc })),
      attrs,
      lifespan,
      family: familyTier(attrs.wealth)
    };
  }

  // 根据天赋链计算属性变动
  function applyTalentMods(talentIds, key, delta) {
    const mods = TALENTS.filter(t => talentIds.includes(t.id) && typeof t.mod === 'function');
    let v = delta;
    mods.forEach(t => { v = t.mod(key, v); });
    return v;
  }

  function hasLuckBias(talentIds) {
    return TALENTS.some(t => talentIds.includes(t.id) && t.luckBias);
  }

  global.TALENTS = TALENTS;
  global.rollTalents = rollTalents;
  global.createCharacter = createCharacter;
  global.familyTier = familyTier;
  global.applyTalentMods = applyTalentMods;
  global.hasLuckBias = hasLuckBias;
})(window);
