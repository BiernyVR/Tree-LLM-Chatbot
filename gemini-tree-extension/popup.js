document.addEventListener('DOMContentLoaded', async () => {
  const statNodesEl = document.getElementById('stat-nodes-count');
  const statBranchesEl = document.getElementById('stat-branches-count');
  const btnOpenGemini = document.getElementById('btn-open-gemini');
  const btnClearCurrent = document.getElementById('btn-clear-current');
  const statusBadge = document.getElementById('status-badge');

  // Check current active tab
  let currentChatKey = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && activeTab.url.includes('gemini.google.com')) {
      statusBadge.innerHTML = '<span class="status-dot"></span> Aktywna w Gemini';
      const match = activeTab.url.match(/\/app\/([a-zA-Z0-9_-]+)/);
      const chatId = match ? match[1] : 'default';
      currentChatKey = `geminitree_data_${chatId}`;

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
      statusBadge.innerHTML = '<span class="status-dot" style="background: #94a3b8; box-shadow: none;"></span> Oczekuje na Gemini';
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
      if (confirm('Czy na pewno chcesz zresetować drzewo rozgałęzień dla tej rozmowy?')) {
        await chrome.storage.local.remove(currentChatKey);
        statNodesEl.textContent = '0';
        statBranchesEl.textContent = '1';
        alert('Zresetowano drzewo bieżącej sesji.');
      }
    } else {
      alert('Przejdź najpierw na kartę gemini.google.com');
    }
  });
});
