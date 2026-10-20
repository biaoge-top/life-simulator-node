/* ============================================================
 * storage.js — 本地存储：设置 / 存档 / 结局图鉴
 * ============================================================ */
(function (global) {
  'use strict';

  const KEYS = {
    settings: 'lts_settings_v1',
    save: 'lts_save_v1',
    gallery: 'lts_gallery_v1'
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('读取本地数据失败', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('写入本地数据失败', key, e);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* ---------- 设置 ---------- */
  function getSettings() {
    return read(KEYS.settings, { endpoint: '' });
  }
  function saveSettings(settings) {
    return write(KEYS.settings, settings);
  }

  // 实际生效的后端接口地址：用户设置优先，否则用默认
  function effectiveEndpoint() {
    const s = getSettings();
    return (s.endpoint && s.endpoint.trim()) || CONFIG.apiEndpoint;
  }

  /* ---------- 存档 ---------- */
  function saveGame(state) {
    return write(KEYS.save, { savedAt: Date.now(), state });
  }
  function loadGame() {
    const data = read(KEYS.save, null);
    return data && data.state ? data : null;
  }
  function hasSave() {
    return !!read(KEYS.save, null);
  }
  function clearSave() {
    remove(KEYS.save);
  }

  /* ---------- 结局图鉴 ---------- */
  function getGallery() {
    return read(KEYS.gallery, []);
  }
  function addGallery(record) {
    const list = getGallery();
    list.unshift(record);
    write(KEYS.gallery, list.slice(0, 99));
    return list;
  }
  function galleryCount() {
    return getGallery().length;
  }

  global.StorageX = {
    getSettings, saveSettings,
    effectiveEndpoint,
    saveGame, loadGame, hasSave, clearSave,
    getGallery, addGallery, galleryCount
  };
})(window);
