/* ============================================================
 * main.js — UI 交互层
 * 屏幕切换 / 属性渲染动画 / 剧情与选项 / 履历 / 存档读档 / 图鉴 / 设置
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- DOM 快捷方式 ---------------- */
  const $ = id => document.getElementById(id);
  const screens = {
    start: $('start-screen'),
    game: $('game-screen'),
    ending: $('ending-screen')
  };

  const ATTR_COLORS = {
    health: '#4fd18b',
    emotion: '#ffc46b',
    social: '#5cc8e0',
    wealth: '#d9b36c',
    knowledge: '#7c8cff',
    morality: '#b78cf7',
    luck: '#f78fb3'
  };

  let busy = false;

  /* ---------------- 工具 ---------------- */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo(0, 0);
  }

  let toastTimer = null;
  function toast(msg, type) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' toast-' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  function loading(show, text) {
    $('loading-overlay').classList.toggle('hidden', !show);
    if (text) $('loading-text').textContent = text;
  }

  /* ---------------- 属性面板 ---------------- */
  function buildBars() {
    const wrap = $('attr-bars');
    wrap.innerHTML = ATTR_META.map(m => `
      <div class="bar-row" data-key="${m.key}">
        <div class="bar-head">
          <span class="bar-name">${m.icon} ${m.name}<small>${escapeHtml(m.desc)}</small></span>
          <span><span class="bar-val" style="color:${ATTR_COLORS[m.key]}">50</span><sup class="bar-delta"></sup><span class="bar-money"></span></span>
        </div>
        <div class="attr-dot" style="background:${ATTR_COLORS[m.key]}">50</div>
        <div class="bar-track"><div class="bar-fill" style="background:${ATTR_COLORS[m.key]}"></div></div>
      </div>`).join('');
    // 点击属性（手机端胶囊/桌面端进度条）弹出作用说明
    const ATTR_TIPS = {
      health: '寿命与体魄——影响患病概率与寿命长短，归零会猝死',
      emotion: '亲情、友情、爱情——人际温暖程度，低迷时易生婚变与孤独',
      social: '人际与人缘——口碑、贵人运、人脉资源，影响事业与求助',
      wealth: '存款与家境——数值即万元（W），无上限；影响可选的人生道路，见底则可能负债潦倒',
      knowledge: '学习与才智——影响升学、事业、解决问题的能力',
      morality: '品行与口碑——影响信任与人缘，过高过低都会触发专属剧情',
      luck: '机缘与巧合——影响意外事件的好坏走向，隐藏属性'
    };
    wrap.querySelectorAll('.bar-row').forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => {
        const m = ATTR_META.find(a => a.key === row.dataset.key);
        const v = Game.getState() ? Game.getState().attrs[m.key] : null;
        const valText = v == null ? '' : `（当前 ${m.key === 'wealth' ? wealthToMoney(v) : v}）`;
        toast(`${m.icon} ${m.name}${valText}：${ATTR_TIPS[m.key]}`);
      });
    });
  }

  function renderProfile(s) {
    $('profile-gender').textContent = s.gender;
    $('profile-talents').innerHTML = s.talents.map(t =>
      `<span class="talent-chip t-${t.tier}" title="${escapeHtml(t.desc)}">${escapeHtml(t.name)}</span>`
    ).join('');
  }

  function renderHud(s) {
    $('hud-age').textContent = s.age;
    $('hud-stage').textContent = s.stage;
  }

  function renderBars(s, deltas) {
    ATTR_META.forEach(m => {
      const row = document.querySelector('.bar-row[data-key="' + m.key + '"]');
      const v = s.attrs[m.key];
      // 资产数值直接以 W（万）显示，如 "85W"
      row.querySelector('.bar-val').textContent = m.key === 'wealth' ? wealthToMoney(v) : v;
      const moneyEl = row.querySelector('.bar-money');
      moneyEl.textContent = '';
      row.querySelector('.bar-fill').style.width = Math.min(100, v) + '%'; // 资产无上限，条宽封顶100%
      row.querySelector('.attr-dot').textContent = m.key === 'wealth' ? wealthToMoney(v) : v;
      const dEl = row.querySelector('.bar-delta');
      if (deltas && deltas[m.key]) {
        const d = deltas[m.key];
        // 先移除 flash 强制重排，再重新添加，保证每次变动都重新播放淡入动画
        dEl.className = 'bar-delta';
        void dEl.offsetWidth;
        dEl.textContent = m.key === 'wealth' ? formatWan(d) : ((d > 0 ? '+' : '') + d);
        dEl.classList.add(d > 0 ? 'up' : 'down', 'flash');
      } else if (deltas) {
        // 本轮无变动的属性，清掉上一轮残留的增减标记
        dEl.className = 'bar-delta';
        dEl.textContent = '';
      }
    });
  }

  function renderLifespan(s) {
    const pct = Math.min(100, Math.round(s.age / s.lifespan * 100));
    $('lifespan-fill').style.width = pct + '%';
    $('lifespan-text').textContent = s.age + ' / ' + s.lifespan + ' 岁';
    const curIdx = STAGES.findIndex(st => st.name === s.stage);
    $('stage-dots').innerHTML = STAGES.map((st, i) => {
      const cls = i < curIdx ? 'pass' : (i === curIdx ? 'on' : '');
      return `<span class="stage-dot ${cls}" title="${st.name}">${st.name.replace('期', '')}</span>`;
    }).join('');
  }

  function renderAll(s, deltas) {
    renderHud(s);
    renderProfile(s);
    renderBars(s, deltas);
    renderLifespan(s);
  }

  /* ---------------- 剧情卡 ---------------- */
  function effectBadges(effects) {
    // 实际变动为 0 的属性不显示（如触底后扣不动）
    const keys = Object.keys(effects || {}).filter(k => ATTR_COLORS[k] != null && effects[k] !== 0);
    if (!keys.length) return '';
    return keys.map(k => {
      const d = effects[k];
      const meta = ATTR_META.find(m => m.key === k);
      // 资产用具体金额展示（如 资产 +50W），其余属性用点数
      const valText = k === 'wealth' ? formatWan(d) : ((d >= 0 ? '+' : '') + d);
      return `<span class="eff-badge ${d >= 0 ? 'up' : 'down'}">${meta.name} ${valText}</span>`;
    }).join('');
  }

  function eventTagsHtml(s, event) {
    const tags = [`<span class="tag tag-age">${s.age} 岁 · ${s.stage}</span>`];
    if (event.is_milestone) {
      tags.push('<span class="tag tag-fixed">★ 固定人生节点</span>');
    } else {
      tags.push('<span class="tag tag-random">随机际遇</span>');
    }
    if (event.fallback) tags.push('<span class="tag tag-fallback">本地补全</span>');
    return `<div class="event-tags">${tags.join('')}</div>`;
  }

  function renderEvent(s) {
    const ev = s.pendingEvent;
    const card = $('event-card');
    card.innerHTML = `
      ${eventTagsHtml(s, ev)}
      <h2 class="event-title">${escapeHtml(ev.title)}</h2>
      <p class="event-desc">${escapeHtml(ev.description)}</p>
      <div class="event-divider">你 的 抉 择</div>
      <div class="choices">
        ${ev.choices.map((c, i) => `
          <button class="choice-card" data-idx="${i}">
            <div class="choice-head">
              <span class="choice-key">${String.fromCharCode(65 + i)}</span>
              <span class="choice-title">${escapeHtml(c.title)}</span>
            </div>
            <div class="choice-detail">${escapeHtml(c.detail)}</div>
            <div class="choice-foot">
              <div class="choice-hint">${escapeHtml(c.hint) || '前途未卜，谁也说不清结果。'}</div>
            </div>
          </button>`).join('')}
      </div>`;

    card.querySelectorAll('.choice-card').forEach(btn => {
      btn.addEventListener('click', () => onChoose(parseInt(btn.dataset.idx, 10)));
    });
    // 新事件渲染后平滑滚动到内容开头（手机端阅读体验）
    requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function renderBirth(s) {
    const birth = s.history[0];
    const card = $('event-card');
    card.innerHTML = `
      <div class="event-tags"><span class="tag tag-age">0 岁 · 婴儿期</span><span class="tag tag-fixed">★ 降生</span></div>
      <h2 class="event-title">${escapeHtml(birth.title)}</h2>
      <p class="event-desc">${escapeHtml(birth.description)}</p>
      <div class="event-divider">人 生 序 章</div>
      <div class="story-next">
        <button class="btn btn-primary" id="btn-birth-next">开始这一生 →</button>
      </div>`;
    $('btn-birth-next').addEventListener('click', () => {
      s.viewedBirth = true;
      renderEvent(s);
    });
  }

  function renderOutcome(s, picked) {
    // picked: {choice?, effects, outcome, record?} 来自实时抉择或读档
    const card = $('event-card');
    const tags = `<div class="event-tags">
        <span class="tag tag-age">${s.age} 岁 · ${s.stage}</span>
      </div>`;

    let choicesHtml = '';
    if (picked.choice) {
      choicesHtml = `
        <div class="event-divider">你 的 抉 择</div>
        <div class="choices">
          <button class="choice-card choice-picked" disabled>
            <div class="choice-head">
              <span class="choice-key">✓</span>
              <span class="choice-title">${escapeHtml(picked.choice.title)}</span>
            </div>
            <div class="choice-detail">${escapeHtml(picked.choice.detail || '')}</div>
          </button>
        </div>`;
    }

    const revealKeys = Object.keys(picked.effects || {}).filter(k => ATTR_COLORS[k] != null && picked.effects[k] !== 0);
    const revealHtml = revealKeys.length
      ? `<div class="outcome-reveal">
           <span class="outcome-reveal-label">命运结算</span>
           <div class="effect-badges">${effectBadges(picked.effects)}</div>
         </div>`
      : '';

    card.innerHTML = `
      ${tags}
      <h2 class="event-title">${escapeHtml(picked.title)}</h2>
      <p class="event-desc">${escapeHtml(picked.description)}</p>
      ${choicesHtml}
      <div class="outcome-box">
        <div class="outcome-label">结 局 · 反 馈</div>
        <p class="outcome-text">${escapeHtml(picked.outcome)}</p>
        ${revealHtml}
      </div>
      <div class="story-next">
        <span class="age-step">时间继续向前流淌……</span>
        <button class="btn btn-primary" id="btn-continue-life">继续人生 →</button>
      </div>`;
    $('btn-continue-life').addEventListener('click', onContinue);
  }

  /* ---------------- 流程控制 ---------------- */
  async function startNewLife() {
    if (busy) return;
    busy = true;
    loading(true, '一个新生命即将降临……');
    try {
      const s = await Game.newLife((t) => loading(true, t));
      showScreen('game');
      renderAll(s);
      renderBirth(s);
      StorageX.clearSave();
      updateStartUI();
    } catch (e) {
      console.error(e);
      toast('开局失败：' + e.message, 'error');
    } finally {
      loading(false);
      busy = false;
    }
  }

  async function onChoose(idx) {
    if (busy) return;
    const s = Game.getState();
    if (!s || !s.pendingEvent) return;
    busy = true;
    document.querySelectorAll('.choice-card').forEach(b => b.disabled = true);
    try {
      const result = await Game.choose(idx, (t) => loading(true, t));
      if (result.phase === 'ended') {
        // 这一抉择走到了生命终点
        renderBars(s, result.effects || null);
        showEnding(s);
        return;
      }
      renderBars(s, result.effects);
      renderHud(s);
      renderLifespan(s);
      renderOutcome(s, {
        title: result.event.title,
        description: result.event.description,
        choice: result.choice,
        effects: result.effects,
        outcome: result.outcome
      });
    } catch (e) {
      console.error(e);
      toast('抉择处理失败：' + e.message, 'error');
      document.querySelectorAll('.choice-card').forEach(b => b.disabled = false);
    } finally {
      loading(false);
      busy = false;
    }
  }

  function onContinue() {
    if (busy) return;
    // 下一事件在抉择时已生成完毕，直接展示（不再请求 AI）
    const s = Game.getState();
    if (!s || !s.pendingEvent) return;
    s.phase = 'event';
    renderAll(s);
    renderEvent(s); // renderEvent 内已包含自动滚动
  }

  /* ---------------- 结局屏 ---------------- */
  function showEnding(s) {
    const end = s.ending;
    $('ending-title').textContent = end.ending_title;
    $('ending-age').textContent = '享年 ' + s.age + ' 岁';
    $('ending-gender').textContent = s.gender;
    $('ending-tier').textContent = Prompts.endingTier(s).label;
    $('ending-summary').textContent = end.summary;
    $('ending-evaluation').textContent = end.evaluation;
    $('ending-highlights').innerHTML = end.highlights.map(h =>
      `<li>${escapeHtml(h)}</li>`).join('');
    $('ending-attrs').innerHTML = ATTR_META.map(m =>
      `<span class="ending-attr">${m.icon} ${m.name}<b>${m.key === 'wealth' ? wealthToMoney(s.attrs[m.key]) : s.attrs[m.key]}</b></span>`).join('');
    showScreen('ending');
  }

  /* ---------------- 履历弹窗 ---------------- */
  function openHistory() {
    const s = Game.getState();
    const box = $('history-list');
    if (!s || !s.history.length) {
      box.innerHTML = '<div class="tl-empty">尚无人生经历</div>';
    } else {
      box.innerHTML = '<div class="timeline">' + s.history.map(h => {
        const cls = h.type === 'stage' ? 'tl-stage' : (h.type === 'end' ? 'tl-end' : '');
        let body = '';
        if (h.type === 'stage') {
          body = `<div class="tl-title">${escapeHtml(h.title)}</div><div class="tl-desc">${escapeHtml(h.description)}</div>`;
        } else {
          body = `<div class="tl-title">${escapeHtml(h.title)}</div>
            <div class="tl-desc">${escapeHtml(h.description)}</div>`;
          if (h.choiceTitle) body += `<div class="tl-choice">抉择：${escapeHtml(h.choiceTitle)}</div>`;
          if (h.effects && Object.keys(h.effects).length) {
            body += `<div class="tl-effects">${effectBadges(h.effects)}</div>`;
          }
          if (h.outcome) body += `<div class="tl-desc" style="margin-top:6px">${escapeHtml(h.outcome)}</div>`;
        }
        return `<div class="tl-item ${cls}">
          <span class="tl-age">${h.age} 岁 · ${escapeHtml(h.stage || '')}</span>
          ${body}
        </div>`;
      }).join('') + '</div>';
    }
    openModal('modal-history');
  }

  /* ---------------- 结局图鉴 ---------------- */
  let galleryDetailId = null;
  function openGallery() {
    galleryDetailId = null;
    renderGallery();
    openModal('modal-gallery');
  }

  function renderGallery() {
    const box = $('gallery-list');
    const list = StorageX.getGallery();
    if (galleryDetailId) {
      const rec = list.find(r => r.id === galleryDetailId);
      if (rec) {
        box.innerHTML = `
          <a class="link-btn" id="gallery-back">← 返回图鉴</a>
          <div style="text-align:center;margin:14px 0 6px">
            <div class="ending-eyebrow" style="letter-spacing:4px">结局</div>
            <h2 style="font-family:var(--serif);font-size:30px;color:var(--gold-soft);letter-spacing:4px;margin-top:6px">${escapeHtml(rec.endingTitle)}</h2>
            <div class="ending-meta" style="margin-top:8px">${rec.age} 岁 · ${escapeHtml(rec.gender)} · ${escapeHtml(rec.tier)} · ${escapeHtml(rec.cause || '')}</div>
          </div>
          <div class="ending-summary" style="margin:18px 0">${escapeHtml(rec.summary)}</div>
          <div class="ending-eval"><div class="ending-eval-label">一生评价</div><p>${escapeHtml(rec.evaluation)}</p></div>
          <div class="ending-block-label">关键节点</div>
          <ul class="highlight-list">${(rec.highlights || []).map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
          <div class="ending-attrs" style="margin-top:16px">${ATTR_META.map(m =>
            `<span class="ending-attr">${m.name}<b>${rec.attrs ? rec.attrs[m.key] : '-'}</b></span>`).join('')}</div>`;
        $('gallery-back').addEventListener('click', () => { galleryDetailId = null; renderGallery(); });
        return;
      }
    }
    if (!list.length) {
      box.innerHTML = '<div class="gallery-empty">图鉴还是空的。<br>走完一段人生，结局便会收录于此。</div>';
      return;
    }
    box.innerHTML = '<div class="gallery-grid">' + list.map(r => `
      <div class="gallery-card" data-id="${r.id}">
        <div class="gallery-title">${escapeHtml(r.endingTitle)}</div>
        <div class="gallery-meta">${r.age} 岁 · ${escapeHtml(r.gender)} · ${escapeHtml(r.tier)}</div>
        <div class="gallery-eval">${escapeHtml(r.evaluation || '')}</div>
      </div>`).join('') + '</div>';
    box.querySelectorAll('.gallery-card').forEach(c =>
      c.addEventListener('click', () => { galleryDetailId = c.dataset.id; renderGallery(); }));
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    const s = StorageX.getSettings();
    $('input-endpoint').value = s.endpoint || '';
    openModal('modal-settings');
  }

  function saveSettingsFromForm() {
    StorageX.saveSettings({
      endpoint: $('input-endpoint').value.trim()
    });
    closeModal('modal-settings');
    toast('设置已保存', 'success');
  }

  /* ---------------- 存档 / 读档 / 重开 ---------------- */
  function doSave() {
    const s = Game.getState();
    if (!s) { toast('还没有开始的人生', 'error'); return; }
    if (StorageX.saveGame(s)) {
      toast('人生已存档', 'success');
      updateStartUI();
    } else {
      toast('存档失败：本地存储不可用', 'error');
    }
  }

  function doLoad() {
    const data = StorageX.loadGame();
    if (!data) { toast('没有找到存档', 'error'); return; }
    const s = data.state;
    Game.setState(s);
    showScreen(s.phase === 'ended' ? 'ending' : 'game');
    if (s.phase === 'ended') {
      showEnding(s);
    } else {
      renderAll(s);
      if (!s.viewedBirth) {
        renderBirth(s);
      } else if (s.pendingEvent && s.phase === 'event') {
        renderEvent(s);
      } else {
        // outcome 阶段：用最后一条履历还原
        const rec = s.history[s.history.length - 1];
        renderOutcome(s, {
          title: rec.title,
          description: rec.description,
          choice: rec.choiceTitle ? { title: rec.choiceTitle, detail: rec.choiceDetail || '' } : null,
          effects: rec.effects,
          outcome: rec.outcome,
          record: rec
        });
      }
    }
    closeAllModals();
    toast('读档成功，回到 ' + s.age + ' 岁', 'success');
  }

  function doRestart() {
    const s = Game.getState();
    if (s && s.phase !== 'ended' && !confirm('当前人生尚未结束，确定放弃并重新开始吗？')) return;
    startNewLife();
  }

  function updateStartUI() {
    $('btn-continue').disabled = !StorageX.hasSave();
    $('gallery-count').textContent = StorageX.galleryCount();
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(id) { $(id).classList.add('active'); }
  function closeModal(id) { $(id).classList.remove('active'); }
  function closeAllModals() {
    document.querySelectorAll('.modal-mask').forEach(m => m.classList.remove('active'));
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    $('btn-new-life').addEventListener('click', startNewLife);
    $('btn-continue').addEventListener('click', doLoad);
    $('open-gallery-start').addEventListener('click', openGallery);
    $('btn-gallery').addEventListener('click', openGallery);
    $('open-settings-start').addEventListener('click', openSettings);
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-settings-save').addEventListener('click', saveSettingsFromForm);
    $('btn-save').addEventListener('click', doSave);
    $('btn-load').addEventListener('click', doLoad);
    $('btn-history').addEventListener('click', openHistory);
    $('btn-restart').addEventListener('click', doRestart);
    $('btn-reincarnate').addEventListener('click', startNewLife);
    $('btn-ending-history').addEventListener('click', openHistory);

    document.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => closeModal(b.dataset.close)));
    document.querySelectorAll('.modal-mask').forEach(mask =>
      mask.addEventListener('click', e => { if (e.target === mask) mask.classList.remove('active'); }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeAllModals();
    });

    // 数字键 1-5 快捷选择
    document.addEventListener('keydown', e => {
      if (busy) return;
      const s = Game.getState();
      if (!s || !s.pendingEvent || screens.game.classList.contains('active') === false) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= s.pendingEvent.choices.length) onChoose(n - 1);
    });
  }

  /* ---------------- 启动 ---------------- */
  buildBars();
  bindEvents();
  updateStartUI();
})();
