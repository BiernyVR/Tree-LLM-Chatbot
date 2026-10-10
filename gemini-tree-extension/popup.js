document.addEventListener('DOMContentLoaded', async () => {
  const statNodesEl = document.getElementById('stat-nodes-count');
  const statBranchesEl = document.getElementById('stat-branches-count');
  const btnOpenGemini = document.getElementById('btn-open-gemini');
  const btnClearCurrent = document.getElementById('btn-clear-current');
  const statusBadge = document.getElementById('status-badge');
  const extensionToggle = document.getElementById('extension-toggle');
  const toggleSubtitle = document.getElementById('toggle-subtitle');
  const chatIdLabel = document.getElementById('chat-id-label');

  // Load master toggle state
  const { gt_extension_enabled = true } = await chrome.storage.local.get('gt_extension_enabled');
  extensionToggle.checked = gt_extension_enabled;
  updateToggleUI(gt_extension_enabled);

  extensionToggle.addEventListener('change', async (e) => {
    const isEnabled = e.target.checked;
    await chrome.storage.local.set({ gt_extension_enabled: isEnabled });
    updateToggleUI(isEnabled);
  });

  function updateToggleUI(isEnabled) {
    if (isEnabled) {
      toggleSubtitle.textContent = 'Włączona na gemini.google.com';
      toggleSubtitle.style.color = '#8e918f';
      statusBadge.innerHTML = '<span class="status-dot"></span> Aktywna';
    } else {
      toggleSubtitle.textContent = 'Wyłączona (wstrzykiwanie wstrzymane)';
      toggleSubtitle.style.color = '#f87171';
      statusBadge.innerHTML = '<span class="status-dot" style="background: #f87171; box-shadow: none;"></span> Wyłączona';
    }
  }

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
      chatIdLabel.textContent = `Sesja: ${match ? match[1].slice(0, 16) + '...' : 'Bieżąca'}`;

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
      chatIdLabel.textContent = 'Brak otwartej karty Gemini';
      statNodesEl.textContent = '-';
      statBranchesEl.textContent = '-';
    }
  } catch (e) {
    console.warn('Error reading tab status:', e);
  }

  // Button: Open Gemini
  btnOpenGemini.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://gemini.google.com' });
  });

  // Button: Clear current tree
  btnClearCurrent.addEventListener('click', async () => {
    if (!confirm('Czy na pewno chcesz wyczyścić wszystkie gałęzie i zresetować to drzewo?')) {
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
      alert('✓ Pomyślnie wyczyszczono gałęzie!');
    } catch (err) {
      console.error('Błąd podczas czyszczenia:', err);
      alert('Wystąpił błąd podczas czyszczenia: ' + err.message);
    }
  });
});
