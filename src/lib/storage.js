/**
 * chrome.storage.local wrapper. Nothing here ever touches chrome.storage.sync:
 * license numbers, immunization dates and API keys stay on this machine.
 */
(function (root) {
  'use strict';
  const NA = (root.NA = root.NA || {});

  const KEYS = {
    profile: 'na_profile',
    settings: 'na_settings',
    tracker: 'na_tracker',
    cachePrefix: 'na_cache_',
    stats: 'na_stats'
  };

  const DEFAULT_SETTINGS = {
    apiKey: '',
    provider: 'moonshot',
    baseUrl: '',
    model: '',
    autopilot: false,
    autoAdvance: true,
    mappingModel: 'claude-haiku-4-5-20251001',
    parsingModel: 'claude-sonnet-5',
    enableLlmFallback: false,
    enableTracker: true,
    highlightFilled: true,
    highlightColor: '#14b8a6',
    autoFillOnLoad: false,
    fillDemographics: true,
    hudPosition: 'bottom-right',
    debug: false
  };

  function area() {
    return chrome.storage.local;
  }

  function get(keys) {
    return new Promise((resolve, reject) => {
      area().get(keys, (res) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve(res);
      });
    });
  }

  function set(obj) {
    return new Promise((resolve, reject) => {
      area().set(obj, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve();
      });
    });
  }

  function remove(keys) {
    return new Promise((resolve, reject) => {
      area().remove(keys, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message)); else resolve();
      });
    });
  }

  async function getProfile() {
    const res = await get(KEYS.profile);
    return NA.schema.hydrate(res[KEYS.profile]);
  }

  async function setProfile(profile) {
    await set({ [KEYS.profile]: profile });
    return profile;
  }

  async function getSettings() {
    const res = await get(KEYS.settings);
    return Object.assign({}, DEFAULT_SETTINGS, res[KEYS.settings] || {});
  }

  async function setSettings(partial) {
    const current = await getSettings();
    const next = Object.assign({}, current, partial);
    await set({ [KEYS.settings]: next });
    return next;
  }

  /* ------------------------------------------------------------- tracker */

  async function getTracker() {
    const res = await get(KEYS.tracker);
    const list = res[KEYS.tracker];
    return Array.isArray(list) ? list : [];
  }

  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /**
   * Upsert keyed on company + role, per the dedupe rule. Returns the record.
   */
  async function upsertApplication(entry) {
    const list = await getTracker();
    const key = slug(entry.company) + '|' + slug(entry.role);
    const idx = list.findIndex(
      (r) => slug(r.company) + '|' + slug(r.role) === key
    );
    const now = new Date().toISOString();
    if (idx === -1) {
      const record = Object.assign(
        {
          id: 'app_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
          company: '', role: '', location: '', atsType: '', url: '',
          dateStarted: now, dateUpdated: now, status: 'Draft', notes: '',
          fieldsFilled: 0, fieldsSkipped: 0
        },
        entry
      );
      list.unshift(record);
      await set({ [KEYS.tracker]: list });
      return record;
    }
    const merged = Object.assign({}, list[idx], entry, {
      dateStarted: list[idx].dateStarted,
      dateUpdated: now,
      status: list[idx].status,
      notes: list[idx].notes
    });
    list[idx] = merged;
    await set({ [KEYS.tracker]: list });
    return merged;
  }

  async function updateApplication(id, patch) {
    const list = await getTracker();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch, {
      dateUpdated: new Date().toISOString()
    });
    await set({ [KEYS.tracker]: list });
    return list[idx];
  }

  async function deleteApplication(id) {
    const list = await getTracker();
    await set({ [KEYS.tracker]: list.filter((r) => r.id !== id) });
  }

  /* --------------------------------------------------------- mapping cache */

  function cacheKey(hostname, fingerprint) {
    return KEYS.cachePrefix + hostname + '_' + fingerprint;
  }

  async function getCachedMapping(hostname, fingerprint) {
    const k = cacheKey(hostname, fingerprint);
    const res = await get(k);
    const hit = res[k];
    if (!hit) return null;
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - (hit.savedAt || 0) > THIRTY_DAYS) {
      await remove(k);
      return null;
    }
    return hit.mapping;
  }

  async function setCachedMapping(hostname, fingerprint, mapping) {
    await set({
      [cacheKey(hostname, fingerprint)]: { savedAt: Date.now(), mapping }
    });
  }

  async function clearCache() {
    const all = await get(null);
    const keys = Object.keys(all).filter((k) => k.indexOf(KEYS.cachePrefix) === 0);
    if (keys.length) await remove(keys);
    return keys.length;
  }

  /* ---------------------------------------------------------------- stats */

  async function bumpStats(patch) {
    const res = await get(KEYS.stats);
    const s = Object.assign({ filled: 0, skipped: 0, sessions: 0 }, res[KEYS.stats] || {});
    Object.keys(patch).forEach((k) => { s[k] = (s[k] || 0) + patch[k]; });
    await set({ [KEYS.stats]: s });
    return s;
  }

  async function getStats() {
    const res = await get(KEYS.stats);
    return Object.assign({ filled: 0, skipped: 0, sessions: 0 }, res[KEYS.stats] || {});
  }

  /* ------------------------------------------------------- export / import */

  async function exportAll() {
    const [profile, settings, tracker] = await Promise.all([
      getProfile(), getSettings(), getTracker()
    ]);
    const safeSettings = Object.assign({}, settings);
    delete safeSettings.apiKey; // never leaves in a backup file
    return {
      exportedAt: new Date().toISOString(),
      app: 'NurseApply',
      schemaVersion: profile.schemaVersion || 1,
      profile,
      settings: safeSettings,
      tracker
    };
  }

  async function importAll(payload) {
    if (!payload || payload.app !== 'NurseApply') {
      throw new Error('That file is not a NurseApply backup.');
    }
    if (payload.profile) await setProfile(NA.schema.hydrate(payload.profile));
    if (payload.settings) await setSettings(payload.settings);
    if (Array.isArray(payload.tracker)) await set({ [KEYS.tracker]: payload.tracker });
  }

  NA.storage = {
    KEYS, DEFAULT_SETTINGS,
    get, set, remove,
    getProfile, setProfile,
    getSettings, setSettings,
    getTracker, upsertApplication, updateApplication, deleteApplication,
    getCachedMapping, setCachedMapping, clearCache,
    bumpStats, getStats,
    exportAll, importAll
  };
})(typeof self !== 'undefined' ? self : this);
