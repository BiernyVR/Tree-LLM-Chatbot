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
  let currentChatKey = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('gemini.google.com')) {
      const match = activeTab.url.match(/\/app\/([a-zA-Z0-9_-]+)/);
      const chatId = match ? match[1] : 'current_session';
      currentChatKey = `geminitree_data_${chatId}`;
      chatIdLabel.textContent = `Sesja: ${chatId.length > 18 ? chatId.slice(0, 18) + '...' : chatId}`;

      const data = await chrome.storage.local.get(currentChatKey);
      const tree = data[currentChatKey];
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
    if (currentChatKey) {
      if (confirm('Czy na pewno chcesz wyczyścić drzewo rozgałęzień dla tej rozmowy?')) {
        await chrome.storage.local.remove(currentChatKey);
        statNodesEl.textContent = '0';
        statBranchesEl.textContent = '1';
        alert('Wyczyszczono drzewo tego czatu. Odśwież stronę Gemini, aby rozpocząć od nowa.');
      }
    } else {
      alert('Przejdź najpierw na kartę z otwartym czatem gemini.google.com');
    }
  });
});
