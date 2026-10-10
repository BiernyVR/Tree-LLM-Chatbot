document.addEventListener('DOMContentLoaded', async () => {
  const statNodesEl = document.getElementById('stat-nodes-count');
  const statBranchesEl = document.getElementById('stat-branches-count');
  const btnOpenGemini = document.getElementById('btn-open-gemini');
  const btnClearCurrent = document.getElementById('btn-clear-current');
  const statusBadge = document.getElementById('status-badge');
  const statusBadgeText = document.getElementById('status-badge-text');
  const extensionToggle = document.getElementById('extension-toggle');
  const toggleSubtitle = document.getElementById('toggle-subtitle');
  const chatIdLabel = document.getElementById('chat-id-label');
  const popupLangBtn = document.getElementById('popup-lang-btn');
  const popupLangLabel = document.getElementById('popup-lang-label');

  // I18N dictionary for popup
  const POPUP_I18N = {
    en: {
      statusActive: 'Active',
      statusInactive: 'Disabled',
      toggleTitle: 'Extension Activity',
      toggleOn: 'Enabled on gemini.google.com',
      toggleOff: 'Disabled (injection paused)',
      statNodes: 'Nodes in this chat',
      statBranches: 'Branches in this chat',
      feature1Title: 'On-demand Branching',
      feature1Desc: '"Branch" button appears next to user prompts.',
      feature2Title: 'Branch Isolation',
      feature2Desc: 'Only messages from the active branch are visible.',
      feature3Title: 'Version Selector',
      feature3Desc: 'Smoothly switch between alternative question paths.',
      feature4Title: 'Tree Visualization',
      feature4Desc: 'Slide-out panel with an interactive hierarchical graph.',
      btnOpenGemini: 'Open Google Gemini',
      btnClearTree: 'Clear Current Chat Tree',
      clearConfirm: 'Are you sure you want to clear all branches and reset this tree?',
      clearSuccess: '✓ Conversation branches cleared successfully!',
      sessionLabel: (id) => `Session: ${id}`,
      noGeminiTab: 'No active Gemini tab open',
      langToggleTitle: 'Switch language / Zmień język (EN / PL)'
    },
    pl: {
      statusActive: 'Aktywna',
      statusInactive: 'Wyłączona',
      toggleTitle: 'Aktywność wtyczki',
      toggleOn: 'Włączona na gemini.google.com',
      toggleOff: 'Wyłączona (wstrzykiwanie wstrzymane)',
      statNodes: 'Węzłów w tym czacie',
      statBranches: 'Gałęzi w tym czacie',
      feature1Title: 'Rozgałęzianie na żądanie',
      feature1Desc: 'Przycisk „Rozgałęź” obok prompta użytkownika.',
      feature2Title: 'Izolacja gałęzi',
      feature2Desc: 'Widzisz tylko pytania i odpowiedzi z wybranej gałęzi.',
      feature3Title: 'Selektor Wersja 1 z X',
      feature3Desc: 'Szybkie przełączanie alternatywnych ścieżek.',
      feature4Title: 'Wizualizacja Drzewa',
      feature4Desc: 'Prawy panel z grafem punktów (Drzewo Gałęzi).',
      btnOpenGemini: 'Otwórz Google Gemini',
      btnClearTree: 'Wyczyść drzewo tego czatu',
      clearConfirm: 'Czy na pewno chcesz wyczyścić wszystkie gałęzie i zresetować to drzewo?',
      clearSuccess: '✓ Pomyślnie wyczyszczono gałęzie!',
      sessionLabel: (id) => `Sesja: ${id}`,
      noGeminiTab: 'Brak otwartej karty Gemini',
      langToggleTitle: 'Zmień język / Switch language (PL / EN)'
    }
  };

  let currentLang = 'en';
  let cachedTabInfo = null;

  function pt(key, ...args) {
    const dict = POPUP_I18N[currentLang] || POPUP_I18N['en'];
    const val = dict[key] !== undefined ? dict[key] : (POPUP_I18N['en'][key] !== undefined ? POPUP_I18N['en'][key] : key);
    if (typeof val === 'function') {
      return val(...args);
    }
    return val;
  }

  // Determine language
  try {
    const res = await chrome.storage.local.get('gt_language');
    if (res && res.gt_language) {
      currentLang = res.gt_language;
    } else {
      const navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
      currentLang = navLang.startsWith('pl') ? 'pl' : 'en';
    }
  } catch (e) {
    currentLang = 'en';
  }

  // Load master toggle state
  const { gt_extension_enabled = true } = await chrome.storage.local.get('gt_extension_enabled');
  extensionToggle.checked = gt_extension_enabled;

  function updateToggleUI(isEnabled) {
    if (isEnabled) {
      toggleSubtitle.textContent = pt('toggleOn');
      toggleSubtitle.style.color = '#8e918f';
      if (statusBadgeText) statusBadgeText.textContent = pt('statusActive');
      statusBadge.style.color = '#34d399';
      statusBadge.querySelector('.status-dot').style.background = '#34d399';
    } else {
      toggleSubtitle.textContent = pt('toggleOff');
      toggleSubtitle.style.color = '#f87171';
      if (statusBadgeText) statusBadgeText.textContent = pt('statusInactive');
      statusBadge.style.color = '#f87171';
      statusBadge.querySelector('.status-dot').style.background = '#f87171';
    }
  }

  function applyLocalizedTexts() {
    popupLangLabel.textContent = currentLang.toUpperCase();
    popupLangBtn.title = pt('langToggleTitle');

    document.getElementById('lbl-toggle-title').textContent = pt('toggleTitle');
    updateToggleUI(extensionToggle.checked);

    document.getElementById('lbl-stat-nodes').textContent = pt('statNodes');
    document.getElementById('lbl-stat-branches').textContent = pt('statBranches');

    document.getElementById('lbl-feat1-title').textContent = pt('feature1Title');
    document.getElementById('lbl-feat1-desc').textContent = pt('feature1Desc');
    document.getElementById('lbl-feat2-title').textContent = pt('feature2Title');
    document.getElementById('lbl-feat2-desc').textContent = pt('feature2Desc');
    document.getElementById('lbl-feat3-title').textContent = pt('feature3Title');
    document.getElementById('lbl-feat3-desc').textContent = pt('feature3Desc');
    document.getElementById('lbl-feat4-title').textContent = pt('feature4Title');
    document.getElementById('lbl-feat4-desc').textContent = pt('feature4Desc');

    document.getElementById('lbl-btn-open').textContent = pt('btnOpenGemini');
    document.getElementById('lbl-btn-clear').textContent = pt('btnClearTree');

    if (cachedTabInfo) {
      chatIdLabel.textContent = pt('sessionLabel', cachedTabInfo);
    } else {
      chatIdLabel.textContent = pt('noGeminiTab');
    }
  }

  // Language button handler
  popupLangBtn.addEventListener('click', async () => {
    currentLang = currentLang === 'en' ? 'pl' : 'en';
    await chrome.storage.local.set({ gt_language: currentLang });
    applyLocalizedTexts();
  });

  // Master toggle handler
  extensionToggle.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    await chrome.storage.local.set({ gt_extension_enabled: isEnabled });
    updateToggleUI(isEnabled);
  });

  // Check current active tab
  let activeTabId = null;
  let currentChatKey = null;

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('gemini.google.com')) {
      activeTabId = activeTab.id;
      const match = activeTab.url.match(/\/app\/([a-zA-Z0-9_-]+)/);
      const chatId = match ? `chat_${match[1]}` : 'current_session';
      currentChatKey = `geminitree_data_${chatId}`;
      cachedTabInfo = match ? match[1].slice(0, 16) + '...' : (currentLang === 'pl' ? 'Bieżąca' : 'Current');
      chatIdLabel.textContent = pt('sessionLabel', cachedTabInfo);

      // Check both keys with and without prefix just in case
      const allData = await chrome.storage.local.get(null);
      const tree = allData[currentChatKey] || allData[`geminitree_data_${match ? match[1] : ''}`];

      if (tree && tree.nodes) {
        const userNodes = Object.values(tree.nodes).filter(n => n.role === 'user');
        const branches = Object.values(tree.nodes).filter(n => (n.childrenIds || []).length > 1);
        statNodesEl.textContent = userNodes.length.toString();
        statBranchesEl.textContent = (branches.length + 1).toString();
      } else {
        statNodesEl.textContent = '0';
        statBranchesEl.textContent = '1';
      }
    } else {
      cachedTabInfo = null;
      chatIdLabel.textContent = pt('noGeminiTab');
      statNodesEl.textContent = '-';
      statBranchesEl.textContent = '-';
    }
  } catch (e) {
    console.warn('Error reading tab status:', e);
  }

  applyLocalizedTexts();

  // Button: Open Gemini
  btnOpenGemini.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://gemini.google.com' });
  });

  // Button: Clear current tree
  btnClearCurrent.addEventListener('click', async () => {
    if (!confirm(pt('clearConfirm'))) {
      return;
    }

    try {
      // 1. Send live message to active tab to clear in-memory state & DOM
      if (activeTabId) {
        try {
          await chrome.tabs.sendMessage(activeTabId, { action: 'CLEAR_TREE' });
        } catch (mErr) {
          console.log('Content script message not delivered, removing from storage:', mErr);
        }
      }

      // 2. Remove all related keys from chrome.storage.local
      const all = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(all).filter(k => k.startsWith('geminitree_data_'));
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }

      statNodesEl.textContent = '0';
      statBranchesEl.textContent = '1';
      alert(pt('clearSuccess'));
    } catch (err) {
      console.error('Error clearing:', err);
      alert('Error clearing: ' + err.message);
    }
  });
});
