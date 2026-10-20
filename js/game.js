/* ============================================================
 * game.js — 核心逻辑层
 * 生命周期管理 / 属性结算 / 天赋修正 / 年龄阶段 / 事件循环 / 死亡判定
 * AI 不可用时使用本地降级事件，保证流程永不卡死
 * ============================================================ */
(function (global) {
  'use strict';

  const STAGE_BLURB = {
    '婴儿期': '襁褓之中，你用哭声与睡梦认识这个世界。',
    '幼儿期': '蹒跚学步，牙牙学语，世界在你眼前缓缓展开。',
    '童年期': '背起小小的书包，你有了玩伴、课堂与烦恼。',
    '青春期': '荷尔蒙与叛逆一同到来，你急于向世界证明自己。',
    '青年期': '离开校园的港湾，你开始独自面对生活的风浪。',
    '壮年期': '肩头担子最重的年纪，上有老来下有小。',
    '中年期': '不惑而后知天命，得失起落渐渐看淡。',
    '老年期': '告别职场，身体开始提醒你把脚步放慢。',
    '暮年期': '夕阳正红，你坐在时光的岸边，回望长长的一生。'
  };

  let state = null;

  function getState() { return state; }
  function setState(s) { state = s; }

  function stageForAge(age) {
    return STAGES.find(s => age >= s.min && age <= s.max) || STAGES[STAGES.length - 1];
  }

  function clamp(v) {
    return Math.max(ATTR_MIN, Math.min(ATTR_MAX, Math.round(v)));
  }

  /* ============================================================
   * 开局
   * ============================================================ */
  async function newLife(onLoading) {
    const ch = createCharacter();
    state = {
      phase: 'birth',
      age: 0,
      stage: '婴儿期',
      gender: ch.gender,
      talents: ch.talents,
      attrs: ch.attrs,
      lifespan: ch.lifespan,
      family: ch.family,
      peak: mapAttrs(ch.attrs),
      trough: mapAttrs(ch.attrs),
      history: [],
      pendingEvent: null,
      usedMilestones: [],
      deathInfo: null,
      ending: null,
      lastFallback: false,
      viewedBirth: false
    };

    // 出生剧情
    onLoading && onLoading('一个新生命即将降临……');
    let birth;
    try {
      birth = await DeepSeek.chatJSON({ kind: 'birth', state }, { maxTokens: CONFIG.maxTokens.birth });
      if (!birth.description) throw new Error('出生剧情缺字段');
    } catch (e) {
      console.warn('出生剧情降级：', e.message);
      birth = fallbackBirth();
      state.lastFallback = true;
    }

    state.history.push({
      age: 0, stage: '婴儿期', type: 'birth',
      title: birth.title || '降生',
      description: birth.description,
      choiceTitle: null, choiceDetail: null, effects: null, outcome: null
    });
    state.phase = 'event';

    await generateEvent(onLoading);
    return state;
  }

  function mapAttrs(attrs) {
    const o = {};
    ATTR_KEYS.forEach(k => { o[k] = attrs[k]; });
    return o;
  }

  /* ============================================================
   * 生成事件（AI 优先，失败降级）
   * ============================================================ */
  async function generateEvent(onLoading, prev) {
    onLoading && onLoading(prev ? '尘埃落定的同时，命运正在书写下一程……' : '命运正在书写下一程……');
    const milestone = dueMilestone(state);

    let event, outcome = null;
    try {
      const raw = await DeepSeek.chatJSON({
        kind: 'event',
        state,
        extra: {
          milestone: milestone ? { label: milestone.label } : null,
          prev: prev || null // 上一次抉择（若有），AI 会顺带产出 outcome 结果文案
        }
      }, {
        maxTokens: CONFIG.maxTokens.event,
        temperature: CONFIG.temperature
      });
      if (prev && raw.outcome) {
        const o = String(raw.outcome).trim();
        if (o.length >= 10) outcome = o;
      }
      event = sanitizeEvent(raw, !!milestone);
      state.lastFallback = false;
    } catch (e) {
      console.warn('事件生成降级：', e.message);
      event = fallbackEvent(state, milestone);
      state.lastFallback = true;
    }
    event.milestoneLabel = milestone ? milestone.label : null;
    state.pendingEvent = event;
    state.phase = 'event';
    return { event, outcome };
  }

  // 找到当前应触发的固定节点；错过的节点直接标记
  function dueMilestone(s) {
    let due = null;
    MILESTONES.forEach(m => {
      if (s.usedMilestones.includes(m.age)) return;
      if (s.age > m.age + 3) { s.usedMilestones.push(m.age); return; }
      if (s.age >= m.age - 1 && s.age <= m.age + 3) {
        if (!due || m.age < due.age) due = m;
      }
    });
    if (due) s.usedMilestones.push(due.age);
    return due;
  }

  /* ============================================================
   * 选项数据清洗与校验
   * ============================================================ */
  function sanitizeEffects(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    ATTR_KEYS.forEach(k => {
      if (raw[k] == null) return;
      let n = Math.round(Number(raw[k]));
      if (!isFinite(n) || n === 0) return;
      n = Math.max(-EFFECT_LIMIT.major, Math.min(EFFECT_LIMIT.major, n));
      out[k] = n;
    });
    return out;
  }

  function sanitizeEvent(raw, isMilestone) {
    if (!raw || typeof raw !== 'object') throw new Error('事件数据为空');
    const title = String(raw.title || '人生一刻').slice(0, 20);
    const description = String(raw.description || '').trim();
    if (description.length < 20) throw new Error('事件描述过短');

    let choices = Array.isArray(raw.choices) ? raw.choices : [];
    choices = choices.slice(0, 5).map((c, idx) => {
      if (!c || typeof c !== 'object') return null;
      const effects = sanitizeEffects(c.effects);
      return {
        title: String(c.title || ('选择' + (idx + 1))).slice(0, 20),
        detail: String(c.detail || '').slice(0, 120),
        effects,
        hint: String(c.hint || '').slice(0, 60)
      };
    }).filter(Boolean).filter(c => c.title);

    if (choices.length < 2) throw new Error('有效选项不足');

    // 保证每个选项都有属性变动（开发规范：禁止无效选项）
    choices.forEach(c => {
      if (!Object.keys(c.effects).length) c.effects = { emotion: 1 };
      if (!c.detail) c.detail = '你打算' + c.title + '。';
    });
    if (choices.length < 3) {
      choices.push({
        title: '顺其自然',
        detail: '不刻意做什么，让事情按它本来的样子发展。',
        effects: { emotion: 2, luck: 1 },
        hint: '佛系也是一种活法。'
      });
    }
    return {
      title,
      description,
      is_milestone: !!isMilestone || !!raw.is_milestone,
      choices,
      fallback: false
    };
  }

  /* ============================================================
   * 玩家抉择：结算属性 → 岁月推进 → 死亡判定 → 生成下一事件
   * （结果文案由"下一事件"请求顺带产出，省一次 AI 调用）
   * ============================================================ */
  async function choose(index, onLoading) {
    if (!state.pendingEvent) throw new Error('当前没有待抉择事件');
    const event = state.pendingEvent;
    const choice = event.choices[index];
    if (!choice) throw new Error('选项不存在');

    // 属性结算（天赋链修正）
    const talentIds = state.talents.map(t => t.id);
    const applied = {};
    Object.keys(choice.effects).forEach(k => {
      const modified = Math.round(applyTalentMods(talentIds, k, choice.effects[k]));
      const before = state.attrs[k];
      // 资产无上限：只保底 0，不封顶；其余属性 0-100
      state.attrs[k] = k === 'wealth'
        ? Math.max(0, Math.round(before + modified))
        : clamp(before + modified);
      applied[k] = state.attrs[k] - before; // 实际生效值（含封顶）
      if (state.attrs[k] > (state.peak[k] ?? -1)) state.peak[k] = state.attrs[k];
      if (state.attrs[k] < (state.trough[k] ?? 101)) state.trough[k] = state.attrs[k];
    });

    // 上一次抉择上下文（交给 AI 顺带写结果）
    const prev = {
      eventTitle: event.title,
      choiceTitle: choice.title,
      choiceDetail: choice.detail,
      effects: applied
    };
    const historyEntry = {
      age: state.age,
      stage: state.stage,
      type: 'event',
      title: event.title,
      description: event.description,
      choiceTitle: choice.title,
      choiceDetail: choice.detail,
      effects: applied,
      outcome: null
    };

    // 岁月推进
    const oldStage = state.stage;
    const step = stageForAge(state.age).step();
    state.age += step;
    const newStage = stageForAge(state.age).name;
    state.stage = newStage;

    // 运气随机小幅波动
    const bias = hasLuckBias(state.talents.map(t => t.id));
    const drift = bias ? randInt(-2, 7) : randInt(-3, 5);
    if (drift !== 0) state.attrs.luck = clamp(state.attrs.luck + drift);

    // 死亡判定：若身故，本次抉择的结果由结局总结一并收束
    const death = checkDeath();
    if (death) {
      state.history.push(historyEntry);
      state.pendingEvent = null;
      return await endGame(death, onLoading);
    }

    if (newStage !== oldStage) {
      state.history.push({
        age: state.age, stage: newStage, type: 'stage',
        title: '步入' + newStage,
        description: STAGE_BLURB[newStage] || '',
        choiceTitle: null, choiceDetail: null, effects: null, outcome: null
      });
    }

    // 合并请求：生成下一事件，AI 同时返回本次抉择的 outcome
    onLoading && onLoading('你做出了选择，尘埃正在落定……');
    const gen = await generateEvent(null, prev);
    const outcome = gen.outcome || fallbackOutcome(event, choice, applied);

    historyEntry.outcome = outcome;
    state.history.push(historyEntry);

    state.phase = 'outcome';
    return { phase: 'outcome', event, choice, effects: applied, outcome };
  }

  function checkDeath() {
    if (state.attrs.health <= 0) {
      return { cause: '病重不治，溘然长逝', kind: 'illness' };
    }
    if (state.age >= state.lifespan) {
      return { cause: '寿终正寝，无疾而终', kind: 'natural' };
    }
    // 病危区间：每回合 25% 概率不治
    if (state.attrs.health <= 9 && Math.random() < 0.25) {
      return { cause: '突发急病，抢救无效', kind: 'critical' };
    }
    return null;
  }

  /* ============================================================
   * 人生结局
   * ============================================================ */
  async function endGame(deathInfo, onLoading) {
    state.deathInfo = deathInfo;
    state.phase = 'ended';
    state.age = Math.min(state.age, Math.max(state.age, state.lifespan));

    onLoading && onLoading('一生的卷轴正在合上……');
    let ending;
    try {
      const raw = await DeepSeek.chatJSON({
        kind: 'ending',
        state,
        extra: { cause: deathInfo.cause, deathKind: deathInfo.kind }
      }, {
        maxTokens: CONFIG.maxTokens.ending,
        temperature: 0.9
      });
      ending = sanitizeEnding(raw);
    } catch (e) {
      console.warn('结局生成降级：', e.message);
      ending = fallbackEnding(state, deathInfo);
    }
    state.ending = ending;

    StorageX.addGallery({
      id: 'e' + Date.now(),
      savedAt: Date.now(),
      endingTitle: ending.ending_title,
      tier: Prompts.endingTier(state).label,
      age: state.age,
      gender: state.gender,
      evaluation: ending.evaluation,
      summary: ending.summary,
      highlights: ending.highlights,
      attrs: mapAttrs(state.attrs),
      talents: state.talents.map(t => t.name),
      cause: deathInfo.cause
    });

    return { phase: 'ended', ending, deathInfo };
  }

  function sanitizeEnding(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('结局数据为空');
    const title = String(raw.ending_title || '一生落幕').slice(0, 12);
    const summary = String(raw.summary || '').trim();
    const evaluation = String(raw.evaluation || '').trim();
    let highlights = Array.isArray(raw.highlights)
      ? raw.highlights.map(h => String(h)).filter(Boolean).slice(0, 8)
      : [];
    if (summary.length < 30 || evaluation.length < 10) throw new Error('结局内容过短');
    if (!highlights.length) highlights = ['一生平凡，亦有微光'];
    return { ending_title: title, summary, evaluation, highlights };
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /* ============================================================
   * 本地降级内容（仅在 AI 不可用时启用，防止剧情卡死）
   * ============================================================ */
  function fallbackBirth() {
    const tNames = state.talents.map(t => '「' + t.name + '」').join('、');
    return {
      title: '降生',
      description:
        '你降生在一个' + state.family.level + '的家庭里。' + state.family.desc +
        '。接生的人把你裹进襁褓，你用响亮的哭声回应这个陌生的世界。家人们很快发现，这孩子似乎有些与众不同——' +
        tNames + '，命运的伏笔已在襁褓中悄悄埋下。属于你的一生，就这样开始了。'
    };
  }

  const FALLBACK_POOL = {
    '婴儿期': [
      { title: '夜半啼哭', description: '连续几天夜里你都哭闹不止，父母睡得很少，白天还要强打精神照看你。邻居建议他们带你去医院看看。',
        choices: [
          { title: '带去大医院', detail: '请假挂专家号，彻查哭闹原因。', effects: { health: 8, wealth: -6 }, hint: '花钱买个踏实。' },
          { title: '用土办法', detail: '听老人的，喂点偏方、收收惊。', effects: { health: -8, emotion: -2 }, hint: '省下钱，但风险暗伏。' },
          { title: '耐心安抚', detail: '轮流抱着哄，慢慢摸索规律。', effects: { emotion: 5, health: 2 }, hint: '辛苦但温馨。' }
        ]},
      { title: '蹒跚学步', description: '你扶着沙发边摇摇晃晃站起来，又一屁股摔下去。妈妈张开手臂在不远处等你，眼里满是鼓励。',
        choices: [
          { title: '勇敢迈步', detail: '松开手，朝妈妈扑过去。', effects: { health: 5, emotion: 4 }, hint: '总要迈出第一步。' },
          { title: '继续爬', detail: '摔怕了，还是爬着稳当。', effects: { emotion: -2, health: 1 }, hint: '慢一点也无妨。' },
          { title: '哭闹求抱', detail: '伸着胳膊要大人抱。', effects: { emotion: 3, social: -2 }, hint: '撒娇的童年。' }
        ]}
    ],
    '幼儿期': [
      { title: '初入幼儿园', description: '第一天上幼儿园，教室里哭声一片。你攥着妈妈的衣角，也有些不知所措。',
        choices: [
          { title: '主动交朋友', detail: '擦擦眼睛，找旁边的小朋友玩积木。', effects: { social: 8, emotion: 3 }, hint: '从小就是社牛。' },
          { title: '安静待着', detail: '坐在角落玩自己的，等放学。', effects: { knowledge: 3, social: -2 }, hint: '独处也有收获。' },
          { title: '大哭要回家', detail: '拽着老师要找妈妈。', effects: { emotion: -5, social: -3 }, hint: '分离需要练习。' }
        ]}
    ],
    '童年期': [
      { title: '期末考试', description: '期末考试快到了，同学们都在复习。同桌约你放学去打游戏，而你的数学还有几道大题没搞懂。',
        choices: [
          { title: '埋头复习', detail: '拒绝游戏，把错题本刷两遍。', effects: { knowledge: 10, health: -3, emotion: -2 }, hint: '分数不会骗人。' },
          { title: '先玩再说', detail: '痛快打一下午游戏，晚上随便翻翻书。', effects: { emotion: 8, knowledge: -5 }, hint: '快乐一时，成绩堪忧。' },
          { title: '请教同学', detail: '找学习好的同学一起复习，互相讲题。', effects: { knowledge: 7, social: 5 }, hint: '人脉也是学习力。' }
        ]},
      { title: '被人欺负', description: '班上有个高大的同学抢你的文具，还推了你一把。周围的同学都看着，老师还没来。',
        choices: [
          { title: '大声制止', detail: '盯着他，要求他立刻归还。', effects: { social: 5, emotion: 4, health: -4 }, hint: '勇气可能挨一拳。' },
          { title: '告诉老师', detail: '事后向老师和家长说明情况。', effects: { social: 2, emotion: -2 }, hint: '规则内解决。' },
          { title: '忍气吞声', detail: '算了，惹不起躲得起。', effects: { emotion: -8, social: -5 }, hint: '隐忍留下阴影。' }
        ]}
    ],
    '青春期': [
      { title: '叛逆的夏天', description: '你开始嫌父母唠叨，房间门总想关着。这天妈妈又翻看你的日记，你撞见了，怒火一下窜了上来。',
        choices: [
          { title: '大吵一架', detail: '摔门而出，宣布隐私神圣不可侵犯。', effects: { emotion: -6, social: -4 }, hint: '冷战在所难免。' },
          { title: '冷静沟通', detail: '压着火，和父母谈边界与信任。', effects: { emotion: 4, social: 6, morality: 2 }, hint: '成熟得令人意外。' },
          { title: '写上锁的日记', detail: '什么也不说，换个带锁的本子。', effects: { emotion: -2, knowledge: 2 }, hint: '保留自己的世界。' }
        ]},
      { title: '朦胧好感', description: '你对班上某个同学产生了说不清的好感，总想多看对方一眼，成绩也有些走神。',
        choices: [
          { title: '专心学习', detail: '把心思收回来，好感埋在心底。', effects: { knowledge: 8, emotion: -3 }, hint: '青涩的克制。' },
          { title: '递小纸条', detail: '鼓起勇气表达心意。', effects: { emotion: 8, social: 3, knowledge: -4 }, hint: '少年心事。' },
          { title: '请教功课', detail: '以学习的名义多接触。', effects: { knowledge: 5, emotion: 4, social: 3 }, hint: '两全其美的小心机。' }
        ]}
    ],
    '青年期': [
      { title: '求职碰壁', description: '投出的简历大多石沉大海，好不容易有个面试，HR 压价压得很厉害，工资只够勉强生活。',
        choices: [
          { title: '先签约就业', detail: '骑驴找马，先生存再发展。', effects: { wealth: 8, emotion: -3, knowledge: 3 }, hint: '手里有粮心不慌。' },
          { title: '继续等机会', detail: '拒掉低价 offer，宁缺毋滥。', effects: { wealth: -6, emotion: -2, knowledge: 2 }, hint: '赌一个更好的。' },
          { title: '尝试创业', detail: '和朋友合伙做点小生意。', effects: { wealth: -12, social: 5, luck: 3 }, hint: '高风险高回报。' }
        ]},
      { title: '房租上涨', description: '房东通知续租要涨三成房租，你工资涨幅远跟不上，合租室友也准备搬走。',
        choices: [
          { title: '搬到远郊', detail: '牺牲通勤，换取便宜房租。', effects: { wealth: 6, health: -5, emotion: -3 }, hint: '每天多挤一小时地铁。' },
          { title: '咬牙续租', detail: '留在市区，多打一份零工。', effects: { wealth: -4, health: -6, knowledge: 2 }, hint: '用身体换时间。' },
          { title: '找人合租', detail: '重新找人分摊房租。', effects: { wealth: 3, social: 4 }, hint: '社交能力变现。' }
        ]}
    ],
    '壮年期': [
      { title: '晋升机会', description: '部门有个管理岗空缺，领导暗示你可以争取，但需要接手一个棘手的项目，加班将成为常态。',
        choices: [
          { title: '全力争取', detail: '立下军令状，死磕项目。', effects: { wealth: 14, social: 8, health: -10, emotion: -3 }, hint: '事业腾飞的代价。' },
          { title: '推给同事', detail: '陪家人更重要，让出机会。', effects: { emotion: 8, wealth: -5, social: -3 }, hint: '得失寸心知。' },
          { title: '谈条件', detail: '争取资源和加薪后再接手。', effects: { wealth: 8, social: 4, health: -5 }, hint: '成熟的谈判。' }
        ]},
      { title: '父母生病', description: '深夜接到电话，父亲突发疾病住院，需要人轮流陪护，而你手上正有重要工作脱不开身。',
        choices: [
          { title: '请假陪护', detail: '工作可以再找，爸只有一个。', effects: { emotion: 10, morality: 8, wealth: -10 }, hint: '亲情不留遗憾。' },
          { title: '请护工', detail: '花钱请专业护工，自己远程协调。', effects: { wealth: -12, emotion: -4, morality: -2 }, hint: '用钱买两全。' },
          { title: '托付兄妹', detail: '让兄弟姐妹先顶着。', effects: { emotion: -8, social: -4, morality: -5 }, hint: '家人心里有本账。' }
        ]}
    ],
    '中年期': [
      { title: '中年体检', description: '体检报告上多了几个箭头：血脂、颈椎、脂肪肝。医生建议改变生活方式，别再硬扛。',
        choices: [
          { title: '开始健身', detail: '办卡、跑步、清淡饮食。', effects: { health: 12, wealth: -4, emotion: 4 }, hint: '自律给人自由。' },
          { title: '照吃照熬', detail: '道理都懂，应酬躲不开。', effects: { health: -10, wealth: 3, emotion: -2 }, hint: '报告压进抽屉。' },
          { title: '调养身心', detail: '规律作息，培养慢爱好。', effects: { health: 6, emotion: 8, luck: 2 }, hint: '慢下来也是进。' }
        ]},
      { title: '同学聚会', description: '多年不见的老同学聚会，有人发了迹高谈阔论，有人离了异沉默寡言。大家起哄问你这些年过得如何。',
        choices: [
          { title: '真诚分享', detail: '聊聊真实的甘苦，不装不比。', effects: { emotion: 6, social: 6 }, hint: '从容是最好的体面。' },
          { title: '低调买单', detail: '少说多听，悄悄结了账。', effects: { wealth: -6, social: 10, morality: 3 }, hint: '人情账记下了。' },
          { title: '借故不去', detail: '推掉聚会，省得攀比闹心。', effects: { emotion: 2, social: -5 }, hint: '清净但少了联系。' }
        ]}
    ],
    '老年期': [
      { title: '带孙之乐', description: '子女工作忙，提出想让你帮忙带孩子。老伴看着你，等你拿主意。',
        choices: [
          { title: '欣然帮带', detail: '享受天伦之乐，帮子女分忧。', effects: { emotion: 10, social: 4, health: -6 }, hint: '累并快乐着。' },
          { title: '量力而行', detail: '白天帮忙，晚上子女自己带。', effects: { emotion: 5, health: 2, social: 3 }, hint: '边界感保住晚年。' },
          { title: '安享晚年', detail: '出钱不出力，保留自己的生活。', effects: { emotion: 3, wealth: -8, social: -4 }, hint: '两代人的观念差。' }
        ]},
      { title: '老毛病犯了', description: '膝盖的老毛病又犯了，医生建议手术置换关节，费用不低；也可以保守治疗，但行动会越来越受限。',
        choices: [
          { title: '接受手术', detail: '趁身体还行，一次解决。', effects: { health: 12, wealth: -14 }, hint: '花钱买生活质量。' },
          { title: '保守治疗', detail: '吃药理疗，能拖一天是一天。', effects: { health: -5, wealth: -3, emotion: -3 }, hint: '越拖越被动。' },
          { title: '锻炼康复', detail: '遵医嘱做康复训练。', effects: { health: 6, emotion: 4, wealth: -2 }, hint: '和慢性病共处。' }
        ]}
    ],
    '暮年期': [
      { title: '回望一生', description: '阳光好的午后，你坐在院子里翻起发黄的老照片。许多面孔、许多名字涌上心头，有些已经不在了。',
        choices: [
          { title: '讲给孙辈听', detail: '把照片里的故事一代代讲下去。', effects: { emotion: 10, social: 6, morality: 3 }, hint: '记忆因此不朽。' },
          { title: '写回忆录', detail: '戴上老花镜，把一生写下来。', effects: { knowledge: 5, emotion: 6 }, hint: '与自己和解。' },
          { title: '静静晒晒太阳', detail: '什么也不说，挺好。', effects: { emotion: 5, health: 2 }, hint: '平安喜乐。' }
        ]}
    ]
  };

  const FALLBACK_MILESTONE = {
    3: { title: '第一天上幼儿园', description: '三岁这年，父母牵着你的手把你送进幼儿园。陌生的教室、小小的桌椅、一群和你一样哭闹的孩子——你要第一次独自面对外面的世界了。',
      choices: [
        { title: '开心探索', detail: '松开父母的手，跑去玩玩具。', effects: { social: 8, emotion: 4 }, hint: '适应力满分。' },
        { title: '紧紧不放', detail: '抱着妈妈的腿不肯撒手。', effects: { emotion: -6, social: -3 }, hint: '成长需要时间。' },
        { title: '先观察再说', detail: '安静坐在一旁观察大家。', effects: { knowledge: 3, emotion: 1 }, hint: '谨慎的小观察者。' }
      ]},
    7: { title: '背起新书包', description: '七岁，你背上崭新的书包走进小学。课本散发着油墨味，讲台上的老师念到你的名字——从今天起，你是一名真正的学生了。',
      choices: [
        { title: '争当第一', detail: '上课坐第一排，事事争先。', effects: { knowledge: 9, social: 2, health: -2 }, hint: '学霸的起点。' },
        { title: '广交朋友', detail: '很快和前后桌打成一片。', effects: { social: 9, knowledge: 2 }, hint: '孩子王气质。' },
        { title: '默默跟上', detail: '不出风头，按部就班。', effects: { knowledge: 4, emotion: 3 }, hint: '稳扎稳打。' }
      ]},
    13: { title: '初中来了', description: '十三岁，你升入初中，课程变多，青春期也悄悄到来。身体和心思都在发生陌生的变化，你对未来第一次有了模糊的想象。',
      choices: [
        { title: '埋头苦读', detail: '把青春期的能量用在学习上。', effects: { knowledge: 10, emotion: -3, health: -2 }, hint: '厚积薄发。' },
        { title: '发展爱好', detail: '加入社团，找到热爱的事。', effects: { emotion: 8, social: 5, knowledge: -2 }, hint: '青春该有色彩。' },
        { title: '跟风叛逆', detail: '学着逃课、追潮流。', effects: { knowledge: -7, social: 2, morality: -3 }, hint: '叛逆的代价。' }
      ]},
    16: { title: '中考关口', description: '十六岁，中考在即。重点高中、普通高中、职校，人生第一次分流近在眼前，家里的气氛也紧张起来。',
      choices: [
        { title: '冲刺重点', detail: '拼尽全力冲一把重点高中。', effects: { knowledge: 12, health: -6, emotion: -2 }, hint: '改变跑道的一战。' },
        { title: '稳妥就好', detail: '按自己节奏考个合适的学校。', effects: { knowledge: 5, emotion: 4 }, hint: '适合的才是最好的。' },
        { title: '考虑职校', detail: '学一门实在技术早点工作。', effects: { knowledge: 2, wealth: 4, social: -2 }, hint: '另一条人生路径。' }
      ]},
    18: { title: '高考', description: '十八岁，高考。三天的考试像一道闸门，十二年的寒窗都压在几张试卷上。交卷铃响，你走出考场，盛夏的阳光晃得人睁不开眼。',
      choices: [
        { title: '超常发挥', detail: '沉着冷静，会的全对。', effects: { knowledge: 10, emotion: 10, luck: 6 }, hint: '命运抛来橄榄枝。' },
        { title: '正常发挥', detail: '不功不过，成绩在意料之中。', effects: { knowledge: 4, emotion: 2 }, hint: '平凡也踏实。' },
        { title: '发挥失常', detail: '紧张到失眠，几门考砸了。', effects: { emotion: -12, knowledge: -4, luck: -5 }, hint: '人生第一道大坎。' }
      ]},
    22: { title: '毕业季', description: '二十二岁，你站在大学与社会的交界线上。有人考研，有人考公，有人北漂南下，宿舍楼下的行李箱装着四年和未来。',
      choices: [
        { title: '进入名企', detail: '拿着不错的 offer 去大城市打拼。', effects: { wealth: 10, knowledge: 6, health: -4 }, hint: '光鲜与压力并存。' },
        { title: '继续深造', detail: '考研/出国，把书读透。', effects: { knowledge: 12, wealth: -6, emotion: 2 }, hint: '延迟兑现的价值。' },
        { title: '回乡发展', detail: '考公或接手家里的安排。', effects: { wealth: 5, emotion: 6, social: 3 }, hint: '安稳的护城河。' }
      ]},
    28: { title: '婚恋压力', description: '二十八岁，逢年过节的话题都绕不开结婚生子。有人介绍对象，家里开始旁敲侧击，你也说不清自己到底在等什么。',
      choices: [
        { title: '认真相亲', detail: '不排斥合适的人，试着交往。', effects: { emotion: 8, wealth: -5, social: 4 }, hint: '烟火气的幸福。' },
        { title: '专注事业', detail: '先立业，后成家。', effects: { wealth: 10, knowledge: 5, emotion: -4 }, hint: '甘蔗没有两头甜。' },
        { title: '坚持等真爱', detail: '不将就，缘分急不来。', effects: { emotion: 3, social: -3, luck: 2 }, hint: '灵魂伴侣很贵。' }
      ]},
    60: { title: '退休那天', description: '六十岁，你办完退休手续，交出用了几十年的工牌。回家的路突然变得很长——明天起，再也不用设闹钟了。',
      choices: [
        { title: '发展爱好', detail: '书法、钓鱼、广场舞，重新活一遍。', effects: { emotion: 12, health: 5, social: 4 }, hint: '第二人生开始。' },
        { title: '含饴弄孙', detail: '把时间都给孙辈和家庭。', effects: { emotion: 8, health: -4, social: 2 }, hint: '甜蜜的负担。' },
        { title: '返聘发挥余热', detail: '接受单位返聘，继续做事。', effects: { wealth: 8, knowledge: 4, health: -5 }, hint: '停不下来的人。' }
      ]}
  };

  function fallbackEvent(s, milestone) {
    let pool;
    if (milestone && FALLBACK_MILESTONE[milestone.age]) {
      pool = [FALLBACK_MILESTONE[milestone.age]];
    } else {
      pool = FALLBACK_POOL[s.stage] || FALLBACK_POOL['暮年期'];
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    return {
      title: picked.title,
      description: picked.description,
      is_milestone: !!milestone,
      choices: picked.choices.map(c => ({
        title: c.title, detail: c.detail, effects: sanitizeEffects(c.effects), hint: c.hint
      })),
      fallback: true
    };
  }

  function fallbackOutcome(event, choice, applied) {
    const effText = Object.keys(applied).length
      ? '这一选择在你身上留下了真切的印记：' + Prompts.formatEffects(applied) + '。'
      : '日子像水一样淌过，一切尽在不言中。';
    return '你最终选择了「' + choice.title + '」。' +
      choice.detail +
      '事情有了它的结果——' + effText +
      '生活不提供撤回键，你收拾好心情，继续往前走。';
  }

  function fallbackEnding(s, deathInfo) {
    const tier = Prompts.endingTier(s);
    const keyEvents = s.history.filter(h => h.type === 'event').slice(-6).map(h => h.age + '岁「' + h.title + '」');
    return {
      ending_title: deathInfo.kind === 'natural' ? '寿终正寝' : (s.age < 50 ? '英年早逝' : '一生落幕'),
      summary:
        '你是一名' + s.gender + '性，生于' + s.family.level + '之家，带着' +
        s.talents.map(t => t.name).join('、') + '的天赋来到世间。' +
        (keyEvents.length ? '此生走过的重要关口包括：' + keyEvents.join('，') + '。' : '') +
        '这一生' + tier.hint.replace(/，.*$/, '') + '。' + deathInfo.cause + '，享年 ' + s.age + ' 岁。' +
        '阖眼之际，爱过的人、走过的路、做过的选择，都成了你自己。',
      evaluation: tier.label + '。数字不足以概括一生，但认真活过的每一岁，都算数。',
      highlights: keyEvents.length ? keyEvents.slice(0, 8) : ['一生平凡，亦有微光']
    };
  }

  global.Game = {
    getState, setState,
    newLife,
    generateEvent,
    choose,
    endGame,
    stageForAge
  };
})(window);
