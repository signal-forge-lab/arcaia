(() => {
  'use strict';

  const APP_VERSION = '0.1.371';
  const OPERATION_MODE_STORAGE_KEY = 'arcaia_operation_mode_v1';
  const FEATURE_SETTINGS_STORAGE_KEY = 'arcaia_feature_settings_v1';
  const EXTENSION_ENABLED_STORAGE_KEY = 'arcaia_extension_enabled_v1';
  const LITE_SHOW_IMAGES_STORAGE_KEY = 'arcaia_lite_show_images_v1';
  const LITE_TURN_COUNT_STORAGE_KEY = 'arcaia_lite_turn_count_v1';
  const ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY = 'arcaia_assistant_completion_sound_enabled_v1';
  const ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY = 'arcaia_assistant_completion_sound_id_v1';
  const ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY = 'arcaia_assistant_completion_sound_volume_v1';
  const DEFAULT_ASSISTANT_COMPLETION_SOUND_ID = 'classic_chime';
  const VALID_ASSISTANT_COMPLETION_SOUND_IDS = new Set([
    'classic_chime',
    'soft_chime',
    'notification_sound_03',
    'notification_sound_04',
    'notification_sound_05',
    'notification_sound_06',
    'notification_sound_07',
    'notification_sound_08',
    'notification_sound_09',
    'notification_sound_10',
    'notification_sound_11',
    'notification_sound_12',
    'notification_sound_13',
    'notification_sound_14'
  ]);
  const DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME = 0.153;
  const ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT = 30;
  const MAX_ASSISTANT_COMPLETION_SOUND_VOLUME = DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME / (ASSISTANT_COMPLETION_SOUND_REFERENCE_UI_PERCENT / 100);
  const DEFAULT_LITE_TURN_COUNT = 3;
  const UI_SETTINGS_SCHEMA_VERSION = 2;
  const LEGACY_DEBUG_STORAGE_KEYS = [
    'arcaia_debug_events_v1',
    'arcaia_debug_mode_enabled_v1',
    'arcaia_debug_logging_preference_v1',
    'arcaia_diagnostic_only_v1',
    'arcaia_diagnostic_preset_v1'
  ];
  const CONTENT_SCRIPT_FILES = [
    'content_toolbar.js',
    'content_markdown.js',
    'content_filename.js',
    'content_model_selector.js',
    'content_recent_view_renderer.js',
    'content.js'
  ];
  const DEFAULT_FEATURE_SETTINGS = Object.freeze({
    liteView: true,
    liteImages: true,
    messageTimestamps: true,
    turnNumbers: true,
    modelDecoration: true,
    modelDecorationStyle: 'aurora',
    blockCollapser: true,
    toolHistoryCompaction: false,
    ctrlEnterSend: true,
    loadingTitle: true,
    completionSound: false,
    pinnedSort: true,
    pinnedIcons: true,
    turnMarkdownButtons: true,
    headerMarkdownButton: true
  });
  const FEATURE_TOGGLE_IDS = Object.freeze({
    liteView: 'liteViewToggle',
    liteImages: 'liteShowImagesToggle',
    messageTimestamps: 'messageTimestampsToggle',
    turnNumbers: 'turnNumbersToggle',
    modelDecoration: 'modelDecorationToggle',
    blockCollapser: 'blockCollapserToggle',
    toolHistoryCompaction: 'toolHistoryCompactionToggle',
    ctrlEnterSend: 'ctrlEnterSendToggle',
    loadingTitle: 'loadingTitleToggle',
    completionSound: 'assistantCompletionSoundToggle',
    pinnedSort: 'pinnedSortToggle',
    pinnedIcons: 'pinnedIconsToggle',
    turnMarkdownButtons: 'turnMarkdownButtonsToggle',
    headerMarkdownButton: 'headerMarkdownButtonToggle'
  });

  const controls = {
    arcaiaEnabledToggle: document.getElementById('arcaiaEnabledToggle'),
    liteViewToggle: document.getElementById('liteViewToggle'),
    liteShowImagesToggle: document.getElementById('liteShowImagesToggle'),
    liteTurnCountSelect: document.getElementById('liteTurnCountSelect'),
    messageTimestampsToggle: document.getElementById('messageTimestampsToggle'),
    turnNumbersToggle: document.getElementById('turnNumbersToggle'),
    modelDecorationToggle: document.getElementById('modelDecorationToggle'),
    modelDecorationStyleSelect: document.getElementById('modelDecorationStyleSelect'),
    blockCollapserToggle: document.getElementById('blockCollapserToggle'),
    toolHistoryCompactionToggle: document.getElementById('toolHistoryCompactionToggle'),
    ctrlEnterSendToggle: document.getElementById('ctrlEnterSendToggle'),
    loadingTitleToggle: document.getElementById('loadingTitleToggle'),
    assistantCompletionSoundToggle: document.getElementById('assistantCompletionSoundToggle'),
    assistantCompletionSoundSelect: document.getElementById('assistantCompletionSoundSelect'),
    assistantCompletionSoundVolume: document.getElementById('assistantCompletionSoundVolume'),
    assistantCompletionSoundTest: document.getElementById('assistantCompletionSoundTest'),
    pinnedSortToggle: document.getElementById('pinnedSortToggle'),
    pinnedIconsToggle: document.getElementById('pinnedIconsToggle'),
    turnMarkdownButtonsToggle: document.getElementById('turnMarkdownButtonsToggle'),
    headerMarkdownButtonToggle: document.getElementById('headerMarkdownButtonToggle')
  };
  const operationModeStatusEl = document.getElementById('operationModeStatus');
  const settingsSaveStateEl = document.getElementById('settingsSaveState');
  const liteShowImagesHintEl = document.getElementById('liteShowImagesHint');
  const assistantCompletionSoundHintEl = document.getElementById('assistantCompletionSoundHint');
  const assistantCompletionSoundVolumeHintEl = document.getElementById('assistantCompletionSoundVolumeHint');

  let operationMode = 'normal';
  let featureSettings = { ...DEFAULT_FEATURE_SETTINGS };
  let liteTurnCount = DEFAULT_LITE_TURN_COUNT;
  let assistantCompletionSoundId = DEFAULT_ASSISTANT_COMPLETION_SOUND_ID;
  let assistantCompletionSoundVolume = DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME;
  let settingsCommitQueue = Promise.resolve();

  function normalizeFeatureSettings(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const next = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_FEATURE_SETTINGS)) {
      if (key === 'modelDecorationStyle') {
        next[key] = source[key] === 'classic' || source[key] === 'aurora' || source[key] === 'outline' ? source[key] : defaultValue;
      } else {
        next[key] = typeof source[key] === 'boolean' ? source[key] : defaultValue;
      }
    }
    return next;
  }

  function normalizeLiteTurnCount(value) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.max(1, Math.min(10, parsed)) : DEFAULT_LITE_TURN_COUNT;
  }

  function normalizeAssistantCompletionSoundId(value) {
    const soundId = String(value || '');
    if (soundId === 'notification_08') return 'soft_chime';
    return VALID_ASSISTANT_COMPLETION_SOUND_IDS.has(soundId) ? soundId : DEFAULT_ASSISTANT_COMPLETION_SOUND_ID;
  }

  function normalizeAssistantCompletionSoundVolume(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_ASSISTANT_COMPLETION_SOUND_VOLUME;
    return Math.max(0, Math.min(MAX_ASSISTANT_COMPLETION_SOUND_VOLUME, parsed));
  }

  function assistantCompletionSoundVolumeToUiPercent(value) {
    const normalized = normalizeAssistantCompletionSoundVolume(value);
    return Math.max(0, Math.min(100, Math.round((normalized / MAX_ASSISTANT_COMPLETION_SOUND_VOLUME) * 100)));
  }

  function assistantCompletionSoundUiPercentToVolume(value) {
    const percent = Math.max(0, Math.min(100, Number(value) || 0));
    return normalizeAssistantCompletionSoundVolume((percent / 100) * MAX_ASSISTANT_COMPLETION_SOUND_VOLUME);
  }

  function buildUiSettingsPayload() {
    return {
      schemaVersion: UI_SETTINGS_SCHEMA_VERSION,
      operationMode,
      featureSettings: normalizeFeatureSettings(featureSettings),
      liteTurnCount: normalizeLiteTurnCount(liteTurnCount),
      assistantCompletionSoundId: normalizeAssistantCompletionSoundId(assistantCompletionSoundId),
      assistantCompletionSoundVolume: normalizeAssistantCompletionSoundVolume(assistantCompletionSoundVolume)
    };
  }

  function getUiSettingsFingerprint(payload = buildUiSettingsPayload()) {
    return JSON.stringify({
      schemaVersion: payload.schemaVersion,
      operationMode: payload.operationMode,
      featureSettings: payload.featureSettings,
      liteTurnCount: payload.liteTurnCount,
      assistantCompletionSoundId: payload.assistantCompletionSoundId,
      assistantCompletionSoundVolume: payload.assistantCompletionSoundVolume
    });
  }

  function setSettingsSaveState(state = 'saved', text = '') {
    if (!settingsSaveStateEl) return;
    const normalized = ['saved', 'saving', 'error'].includes(state) ? state : 'saved';
    settingsSaveStateEl.hidden = false;
    settingsSaveStateEl.dataset.state = normalized;
    const label = settingsSaveStateEl.querySelector('span:last-child');
    if (!label) return;
    label.textContent = text || (normalized === 'saving'
      ? '保存中…'
      : normalized === 'error'
        ? '保存できませんでした'
        : '保存済み');
  }

  function updateRangeProgress(input, percent) {
    if (!input) return;
    const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
    input.style.setProperty('--range-progress', `${normalized}%`);
    input.setAttribute('aria-valuetext', `${Math.round(normalized)}%`);
  }

  function updateActionBadge() {
    try {
      const text = operationMode === 'off' ? 'OFF' : '';
      chrome.action.setBadgeText({ text });
      if (text) chrome.action.setBadgeBackgroundColor({ color: '#666666' });
    } catch {}
  }

  function updateOperationModeUi() {
    const enabled = operationMode !== 'off';
    if (controls.arcaiaEnabledToggle) {
      controls.arcaiaEnabledToggle.checked = enabled;
      controls.arcaiaEnabledToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    }
    if (operationModeStatusEl) {
      operationModeStatusEl.dataset.mode = enabled ? 'normal' : 'off';
      operationModeStatusEl.textContent = enabled ? '' : 'Arcaiaは停止中です。';
    }
    updateActionBadge();
  }

  function updateFeatureSettingsUi() {
    const extensionEnabled = operationMode !== 'off';
    for (const [featureKey, controlId] of Object.entries(FEATURE_TOGGLE_IDS)) {
      const control = controls[controlId];
      if (!control) continue;
      control.checked = featureSettings[featureKey] !== false;
      control.setAttribute('aria-checked', control.checked ? 'true' : 'false');
      control.disabled = !extensionEnabled;
      control.closest('.switch-row')?.classList.toggle('is-disabled', !extensionEnabled);
    }
    if (controls.liteTurnCountSelect) {
      controls.liteTurnCountSelect.value = String(liteTurnCount);
      controls.liteTurnCountSelect.disabled = !extensionEnabled || featureSettings.liteView === false;
      controls.liteTurnCountSelect.closest('.select-row')?.classList.toggle('is-disabled', controls.liteTurnCountSelect.disabled);
    }
    const turnNumbersDisabled = !extensionEnabled || featureSettings.messageTimestamps === false;
    if (controls.turnNumbersToggle) controls.turnNumbersToggle.disabled = turnNumbersDisabled;
    controls.turnNumbersToggle?.closest('.switch-row')?.classList.toggle('is-disabled', turnNumbersDisabled);
    if (controls.modelDecorationStyleSelect) {
      controls.modelDecorationStyleSelect.value = featureSettings.modelDecorationStyle;
      controls.modelDecorationStyleSelect.disabled = !extensionEnabled || featureSettings.modelDecoration === false;
      controls.modelDecorationStyleSelect.closest('.select-row')?.classList.toggle('is-disabled', controls.modelDecorationStyleSelect.disabled);
    }
    const liteImagesDisabled = !extensionEnabled || featureSettings.liteView === false;
    if (controls.liteShowImagesToggle) controls.liteShowImagesToggle.disabled = liteImagesDisabled;
    controls.liteShowImagesToggle?.closest('.switch-row')?.classList.toggle('is-disabled', liteImagesDisabled);
    if (liteShowImagesHintEl) {
      liteShowImagesHintEl.textContent = featureSettings.liteView === false
        ? 'Recent View OFF'
        : featureSettings.liteImages === false
          ? 'プレースホルダー'
          : '画像表示';
    }
    updateAssistantCompletionSoundUi();
  }

  function updateAssistantCompletionSoundUi() {
    const extensionEnabled = operationMode !== 'off';
    const soundEnabled = extensionEnabled && featureSettings.completionSound !== false;
    if (assistantCompletionSoundHintEl) assistantCompletionSoundHintEl.textContent = featureSettings.completionSound ? 'ON' : 'OFF';
    if (controls.assistantCompletionSoundSelect) {
      controls.assistantCompletionSoundSelect.value = assistantCompletionSoundId;
      controls.assistantCompletionSoundSelect.disabled = !soundEnabled;
    }
    const volumePercent = assistantCompletionSoundVolumeToUiPercent(assistantCompletionSoundVolume);
    if (controls.assistantCompletionSoundVolume) {
      controls.assistantCompletionSoundVolume.value = String(volumePercent);
      controls.assistantCompletionSoundVolume.disabled = !soundEnabled;
      controls.assistantCompletionSoundVolume.title = `回答完了通知音の相対音量: ${volumePercent}`;
      updateRangeProgress(controls.assistantCompletionSoundVolume, volumePercent);
    }
    if (assistantCompletionSoundVolumeHintEl) assistantCompletionSoundVolumeHintEl.textContent = `${volumePercent}%`;
    if (controls.assistantCompletionSoundTest) controls.assistantCompletionSoundTest.disabled = !soundEnabled;
    document.querySelector('[data-sound-select-row]')?.classList.toggle('is-disabled', !soundEnabled);
    document.querySelector('[data-sound-volume-row]')?.classList.toggle('is-disabled', !soundEnabled);
  }

  function updateUi() {
    updateOperationModeUi();
    updateFeatureSettingsUi();
  }

  async function persistUiSettings(payload = buildUiSettingsPayload()) {
    return chrome.storage.local.set({
      [OPERATION_MODE_STORAGE_KEY]: payload.operationMode,
      [EXTENSION_ENABLED_STORAGE_KEY]: payload.operationMode !== 'off',
      [FEATURE_SETTINGS_STORAGE_KEY]: payload.featureSettings,
      [LITE_SHOW_IMAGES_STORAGE_KEY]: payload.featureSettings.liteImages,
      [LITE_TURN_COUNT_STORAGE_KEY]: payload.liteTurnCount,
      [ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY]: payload.featureSettings.completionSound,
      [ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY]: payload.assistantCompletionSoundId,
      [ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY]: payload.assistantCompletionSoundVolume
    });
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] || null;
  }

  function isChatGPTUrl(url) {
    return typeof url === 'string' && url.startsWith('https://chatgpt.com/');
  }

  function sendMessageToTab(tabId, message) {
    return new Promise((resolve, reject) => {
      const callback = (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      };
      try {
        chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, callback);
      } catch {
        chrome.tabs.sendMessage(tabId, message, callback);
      }
    });
  }

  async function ensureContentScript(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  function isMissingReceiverError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes('Receiving end does not exist') || message.includes('Could not establish connection');
  }

  async function syncSettingsToActiveTab({
    force = false,
    reason = 'popup_settings_changed',
    payload = buildUiSettingsPayload()
  } = {}) {
    const tab = await getActiveTab();
    if (!tab?.id || !isChatGPTUrl(tab.url || '')) return { skipped: true, reason: 'no_chatgpt_tab' };
    const fingerprint = getUiSettingsFingerprint(payload);
    let status = null;
    try {
      status = await sendMessageToTab(tab.id, { type: 'AICE_GET_UI_SETTINGS_STATUS' });
    } catch (error) {
      if (!isMissingReceiverError(error)) throw error;
      await ensureContentScript(tab.id);
      force = true;
    }
    const remoteFingerprint = status?.settingsFingerprint || status?.result?.settingsFingerprint || null;
    if (!force && remoteFingerprint === fingerprint) {
      return { ok: true, skipped: true, reason: 'settings_unchanged', settingsFingerprint: fingerprint };
    }
    return sendMessageToTab(tab.id, {
      type: 'AICE_SET_UI_SETTINGS',
      ...payload,
      settingsFingerprint: fingerprint,
      reason
    });
  }

  function captureState() {
    return buildUiSettingsPayload();
  }

  function restoreState(snapshot) {
    operationMode = snapshot.operationMode;
    featureSettings = { ...snapshot.featureSettings };
    liteTurnCount = snapshot.liteTurnCount;
    assistantCompletionSoundId = snapshot.assistantCompletionSoundId;
    assistantCompletionSoundVolume = snapshot.assistantCompletionSoundVolume;
    updateUi();
  }

  function assertSettingsSyncSucceeded(result) {
    if (result?.skipped && result.reason === 'no_chatgpt_tab') return result;
    if (!result || result.ok === false) {
      throw new Error(result?.error || 'active_tab_settings_apply_failed');
    }
    return result;
  }

  async function rollbackSettings(previous, reason) {
    restoreState(previous);
    await persistUiSettings(previous);
    try {
      const result = await syncSettingsToActiveTab({
        force: true,
        reason: `rollback:${reason}`,
        payload: previous
      });
      assertSettingsSyncSucceeded(result);
    } catch {}
  }

  async function runSettingsCommit(mutator, failureLabel) {
    const previous = captureState();
    setSettingsSaveState('saving', '保存中…');
    try {
      mutator();
      updateUi();
      const next = captureState();
      await persistUiSettings(next);
      const result = assertSettingsSyncSucceeded(await syncSettingsToActiveTab({
        reason: 'popup_settings_changed',
        payload: next
      }));
      setSettingsSaveState('saved', '保存済み');
      return result;
    } catch (error) {
      try { await rollbackSettings(previous, failureLabel); } catch { restoreState(previous); }
      setSettingsSaveState('error', `${failureLabel}を保存できませんでした`);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function commitSettings(mutator, failureLabel) {
    const run = () => runSettingsCommit(mutator, failureLabel);
    const queued = settingsCommitQueue.then(run, run);
    settingsCommitQueue = queued.catch(() => {});
    return queued;
  }

  async function closePopupAfterFocusLoss() {
    await settingsCommitQueue;
    if (!document.hasFocus()) window.close();
  }

  window.addEventListener('blur', () => {
    void closePopupAfterFocusLoss();
  });

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const error = chrome.runtime.lastError;
          resolve(error ? { ok: false, error: error.message } : (response || { ok: false, error: 'empty_response' }));
        });
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  function setSoundTestPlaying(playing) {
    const button = controls.assistantCompletionSoundTest;
    if (!button) return;
    button.classList.toggle('is-playing', Boolean(playing));
    button.setAttribute('aria-busy', playing ? 'true' : 'false');
    const label = button.querySelector('.test-label');
    if (label) label.textContent = playing ? '再生中' : '試聴';
    button.disabled = Boolean(playing) || operationMode === 'off' || featureSettings.completionSound === false;
  }

  async function testAssistantCompletionSound() {
    setSoundTestPlaying(true);
    try {
      const minimumVisualState = new Promise((resolve) => setTimeout(resolve, 650));
      const playback = sendRuntimeMessage({
        type: 'ARCAIA_PLAY_COMPLETION_SOUND',
        appVersion: APP_VERSION,
        reason: 'popup_manual_test_direct',
        soundId: assistantCompletionSoundId,
        volume: assistantCompletionSoundVolume
      });
      await Promise.all([playback, minimumVisualState]);
    } finally {
      setSoundTestPlaying(false);
    }
  }

  async function initialize() {
    let data = {};
    try {
      data = await chrome.storage.local.get([
        OPERATION_MODE_STORAGE_KEY,
        EXTENSION_ENABLED_STORAGE_KEY,
        FEATURE_SETTINGS_STORAGE_KEY,
        LITE_SHOW_IMAGES_STORAGE_KEY,
        LITE_TURN_COUNT_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY,
        ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY
      ]);
    } catch {}
    const storedMode = data?.[OPERATION_MODE_STORAGE_KEY];
    operationMode = storedMode === 'off' || data?.[EXTENSION_ENABLED_STORAGE_KEY] === false ? 'off' : 'normal';
    const storedFeatures = data?.[FEATURE_SETTINGS_STORAGE_KEY];
    featureSettings = normalizeFeatureSettings({
      ...storedFeatures,
      ...(storedFeatures && typeof storedFeatures.liteImages === 'boolean'
        ? {}
        : { liteImages: data?.[LITE_SHOW_IMAGES_STORAGE_KEY] !== false }),
      ...(storedFeatures && typeof storedFeatures.completionSound === 'boolean'
        ? {}
        : { completionSound: data?.[ASSISTANT_COMPLETION_SOUND_ENABLED_STORAGE_KEY] === true })
    });
    liteTurnCount = normalizeLiteTurnCount(data?.[LITE_TURN_COUNT_STORAGE_KEY]);
    assistantCompletionSoundId = normalizeAssistantCompletionSoundId(data?.[ASSISTANT_COMPLETION_SOUND_ID_STORAGE_KEY]);
    assistantCompletionSoundVolume = normalizeAssistantCompletionSoundVolume(data?.[ASSISTANT_COMPLETION_SOUND_VOLUME_STORAGE_KEY]);
    try { await chrome.storage.local.remove(LEGACY_DEBUG_STORAGE_KEYS); } catch {}
    await persistUiSettings();
    updateUi();
    try {
      await syncSettingsToActiveTab({ reason: 'popup_open_settings_check' });
    } catch {}
  }

  controls.arcaiaEnabledToggle?.addEventListener('change', () => {
    const enabled = Boolean(controls.arcaiaEnabledToggle.checked);
    void commitSettings(() => {
      operationMode = enabled ? 'normal' : 'off';
    }, '有効状態');
  });

  for (const [featureKey, controlId] of Object.entries(FEATURE_TOGGLE_IDS)) {
    controls[controlId]?.addEventListener('change', () => {
      const enabled = Boolean(controls[controlId].checked);
      const label = controls[controlId]?.closest('.switch-row')?.querySelector('.switch-title')?.textContent || featureKey;
      void commitSettings(() => {
        featureSettings = normalizeFeatureSettings({ ...featureSettings, [featureKey]: enabled });
      }, label);
    });
  }

  controls.liteTurnCountSelect?.addEventListener('change', () => {
    const nextValue = controls.liteTurnCountSelect.value;
    void commitSettings(() => {
      liteTurnCount = normalizeLiteTurnCount(nextValue);
    }, 'ターン数');
  });

  controls.modelDecorationStyleSelect?.addEventListener('change', () => {
    const nextStyle = controls.modelDecorationStyleSelect.value;
    void commitSettings(() => {
      featureSettings = normalizeFeatureSettings({ ...featureSettings, modelDecorationStyle: nextStyle });
    }, 'モデル装飾スタイル');
  });

  controls.assistantCompletionSoundSelect?.addEventListener('change', () => {
    const nextSoundId = controls.assistantCompletionSoundSelect.value;
    void commitSettings(() => {
      assistantCompletionSoundId = normalizeAssistantCompletionSoundId(nextSoundId);
    }, '通知音');
  });

  controls.assistantCompletionSoundVolume?.addEventListener('input', () => {
    const percent = Math.max(0, Math.min(100, Number(controls.assistantCompletionSoundVolume.value || 0)));
    updateRangeProgress(controls.assistantCompletionSoundVolume, percent);
    if (assistantCompletionSoundVolumeHintEl) assistantCompletionSoundVolumeHintEl.textContent = `${Math.round(percent)}%`;
  });

  controls.assistantCompletionSoundVolume?.addEventListener('change', () => {
    const nextPercent = controls.assistantCompletionSoundVolume.value;
    void commitSettings(() => {
      assistantCompletionSoundVolume = assistantCompletionSoundUiPercentToVolume(nextPercent);
    }, '通知音量');
  });

  controls.assistantCompletionSoundTest?.addEventListener('click', testAssistantCompletionSound);

  initialize().catch(() => setSettingsSaveState('error', '設定を読み込めませんでした'));
})();
