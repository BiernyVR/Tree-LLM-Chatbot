/**
 * Gemini Tree Chrome Extension — Content Script for gemini.google.com
 * Handles:
 * 1. True branch creation: new prompts branched from an origin become siblings.
 * 2. Complete branch isolation: non-active branches are hidden from the DOM.
 * 3. Version switching: toggling versions unhides the selected branch and hides others.
 * 4. High-contrast theme adaptation (Light / Dark).
 * 5. Direct tree clearing & master enable toggle.
 */

(() => {
  'use strict';

  // --- SVGs ---
  const SVG_BRANCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/></svg>`;
  const SVG_NETWORK = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>`;
  const SVG_CLOSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const SVG_CHEVRON_LEFT = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`;
  const SVG_CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;

  // --- State ---
  let isExtensionEnabled = true;
  let activeChatId = null;
  let currentTree = createEmptyTree('init');
  let branchingFromNode = null;
  let drawerOpen = false;
  let scanDebounceTimer = null;
  let isScanning = false;
  let currentGraphScale = 'auto'; // 'auto' or float value
  let lastCalculatedScale = 1.0;
  let renderGraphDebounceTimer = null;

  function createEmptyTree(chatId) {
    return {
      chatId: chatId,
      rootId: 'root',
      currentNodeId: 'root',
      pendingBranchOriginId: null,
      pendingBranchNodeId: null,
      lastActiveSendParentId: null,
      nodes: {
        'root': { id: 'root', parentId: null, role: 'system', content: 'Gemini Session', childrenIds: [], activeChildId: null }
      }
    };
  }

  // --- Detect Current Unique Chat ID ---
  function detectCurrentChatId() {
    const urlMatch = window.location.pathname.match(/\/app\/([a-zA-Z0-9_-]{8,})/);
    if (urlMatch) {
      return `chat_${urlMatch[1]}`;
    }

    let sessId = sessionStorage.getItem('gt_current_session_id');
    if (!sessId) {
      sessId = `new_session_${Date.now()}`;
      sessionStorage.setItem('gt_current_session_id', sessId);
    }
    return sessId;
  }

  function getStorageKey(chatId) {
    return `geminitree_data_${chatId}`;
  }

  // --- Theme Detection ---
  function updateThemeClass() {
    const isDark = 
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      document.body.classList.contains('dark-theme') ||
      document.body.classList.contains('theme-dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (isDark) {
      if (!document.body.classList.contains('gt-theme-dark')) {
        document.body.classList.add('gt-theme-dark');
        document.body.classList.remove('gt-theme-light');
      }
    } else {
      if (!document.body.classList.contains('gt-theme-light')) {
        document.body.classList.add('gt-theme-light');
        document.body.classList.remove('gt-theme-dark');
      }
    }
  }

  // --- Storage Helper ---
  async function loadTreeForCurrentChat() {
    const newChatId = detectCurrentChatId();

    if (newChatId !== activeChatId) {
      activeChatId = newChatId;
      branchingFromNode = null;
      renderBranchBanner();
    }

    const key = getStorageKey(activeChatId);
    try {
      const result = await chrome.storage.local.get(key);
      if (result && result[key] && result[key].nodes) {
        currentTree = result[key];
      } else {
        currentTree = createEmptyTree(activeChatId);
      }
    } catch (e) {
      console.warn('[Gemini Tree] Error loading tree:', e);
      currentTree = createEmptyTree(activeChatId);
    }
  }

  async function saveTree() {
    if (!activeChatId) return;
    const key = getStorageKey(activeChatId);
    try {
      await chrome.storage.local.set({ [key]: currentTree });
    } catch (e) {
      console.warn('[Gemini Tree] Error saving tree:', e);
    }
  }

  // --- UI Elements Management ---
  function initExtensionUI() {
    updateThemeClass();
    ensureTopbarButton();
    ensureDrawer();
    ensureBannerContainer();
  }

  function destroyExtensionUI() {
    document.getElementById('gt-topbar-btn')?.remove();
    document.getElementById('gt-drawer')?.remove();
    document.getElementById('gt-branch-banner-root')?.remove();
    document.querySelectorAll('.gt-branch-action-btn').forEach(b => b.remove());
    document.querySelectorAll('.gt-version-pill-container').forEach(p => p.remove());
    document.querySelectorAll('.gt-hidden-turn').forEach(el => {
      el.classList.remove('gt-hidden-turn');
      el.style.display = '';
    });
    document.querySelectorAll('[data-gt-injected]').forEach(el => delete el.dataset.gtInjected);
    document.body.classList.remove('gt-drawer-open');
    drawerOpen = false;
  }

  // 1. Topbar / Floating Toggle Button
  function ensureTopbarButton() {
    if (!isExtensionEnabled) return;
    if (document.getElementById('gt-topbar-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'gt-topbar-btn';
    btn.className = 'gt-topbar-button gt-floating-toggle-btn';
    btn.innerHTML = `${SVG_NETWORK} <span>Drzewo Gałęzi</span> <span id="gt-branch-badge" class="gt-topbar-badge">0</span>`;
    btn.title = 'Włącz/wyłącz podgląd drzewa konwersacji (Gemini Tree)';
    btn.onclick = toggleDrawer;

    document.body.appendChild(btn);
    updateBadge();
  }

  function updateBadge() {
    const badge = document.getElementById('gt-branch-badge');
    if (!badge) return;
    const userNodes = Object.values(currentTree.nodes).filter(n => n.role === 'user');
    badge.textContent = userNodes.length.toString();
  }

  // 2. Gemini Tree Drawer (Right Slide-out Panel)
  function ensureDrawer() {
    if (!isExtensionEnabled) return;
    let drawer = document.getElementById('gt-drawer');
    if (drawer) return;

    drawer = document.createElement('aside');
    drawer.id = 'gt-drawer';
    drawer.className = 'gt-drawer';
    drawer.innerHTML = `
      <div id="gt-drawer-resizer" class="gt-drawer-resizer" title="Przeciągnij lewą krawędź, aby rozszerzyć panel"></div>
      <div class="gt-drawer-header">
        <div class="gt-drawer-title-wrap">
          <span class="gt-drawer-icon-accent">${SVG_NETWORK}</span>
          <h3>Drzewo Konwersacji Gemini</h3>
        </div>
        <div class="gt-drawer-actions-wrap">
          <button class="gt-drawer-action-btn" id="gt-drawer-clear-btn" title="Wyczyść wszystkie gałęzie w tej sesji">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>Wyczyść</span>
          </button>
          <button class="gt-drawer-close-btn" id="gt-drawer-close" title="Zamknij panel">
            ${SVG_CLOSE}
          </button>
        </div>
      </div>
      <div class="gt-drawer-body">
        <div class="gt-stats-bar">
          <div class="gt-stat-item">
            <span class="gt-stat-value" id="gt-stat-nodes">0</span>
            <span class="gt-stat-label">Węzłów</span>
          </div>
          <div class="gt-stat-item">
            <span class="gt-stat-value" id="gt-stat-depth">0</span>
            <span class="gt-stat-label">Poziomów</span>
          </div>
          <div class="gt-stat-item">
            <span class="gt-stat-value" id="gt-stat-branches">0</span>
            <span class="gt-stat-label">Gałęzi</span>
          </div>
        </div>

        <div class="gt-controls-row">
          <div class="gt-legend">
            <div class="gt-legend-item"><span class="gt-legend-dot active"></span> Aktywna</div>
            <div class="gt-legend-item"><span class="gt-legend-dot current"></span> Jesteś tutaj</div>
            <div class="gt-legend-item"><span class="gt-legend-dot other"></span> Inne odnogi</div>
            <div class="gt-legend-item"><span class="gt-legend-dot fork"></span> Rozwidlenie</div>
          </div>
          <div class="gt-canvas-toolbar">
            <button class="gt-tool-btn" id="gt-zoom-out" title="Zmniejsz (-)">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <span class="gt-zoom-display" id="gt-zoom-display" title="Kliknij, aby przełączyć Auto / 100%">Auto</span>
            <button class="gt-tool-btn" id="gt-zoom-in" title="Powiększ (+)">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="gt-tool-btn gt-tool-fit-btn" id="gt-zoom-fit" title="Automatycznie dopasuj całe drzewo do okna">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
              <span>Dopasuj</span>
            </button>
          </div>
        </div>

        <div id="gt-graph-content" class="gt-graph-container">
          <!-- Rendered dot tree -->
        </div>
      </div>
    `;

    document.body.appendChild(drawer);
    document.getElementById('gt-drawer-close').onclick = toggleDrawer;
    document.getElementById('gt-drawer-clear-btn').onclick = () => clearCurrentTree(false);
    initDrawerResizer(drawer);
    setupZoomControls();
  }

  function initDrawerResizer(drawerEl) {
    const resizer = drawerEl.querySelector('#gt-drawer-resizer');
    if (!resizer) return;

    chrome.storage.local.get('gt_drawer_width', (res) => {
      if (res?.gt_drawer_width && res.gt_drawer_width >= 320) {
        drawerEl.style.width = `${res.gt_drawer_width}px`;
      }
    });

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      startX = e.clientX;
      startWidth = drawerEl.getBoundingClientRect().width;
      resizer.classList.add('is-resizing');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const delta = startX - e.clientX;
      const maxW = Math.min(window.innerWidth - 280, 900);
      const newW = Math.round(Math.min(maxW, Math.max(320, startWidth + delta)));
      drawerEl.style.width = `${newW}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove('is-resizing');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      const finalW = Math.round(drawerEl.getBoundingClientRect().width);
      chrome.storage.local.set({ gt_drawer_width: finalW });
      renderGraph();
    });
  }

  function setupZoomControls() {
    document.getElementById('gt-zoom-in')?.addEventListener('click', (e) => {
      e.stopPropagation();
      let currentVal = currentGraphScale === 'auto' ? lastCalculatedScale : currentGraphScale;
      currentGraphScale = parseFloat((Math.min(1.8, currentVal + 0.12)).toFixed(2));
      renderGraph();
    });

    document.getElementById('gt-zoom-out')?.addEventListener('click', (e) => {
      e.stopPropagation();
      let currentVal = currentGraphScale === 'auto' ? lastCalculatedScale : currentGraphScale;
      currentGraphScale = parseFloat((Math.max(0.35, currentVal - 0.12)).toFixed(2));
      renderGraph();
    });

    document.getElementById('gt-zoom-fit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      currentGraphScale = 'auto';
      renderGraph();
    });

    document.getElementById('gt-zoom-display')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentGraphScale === 'auto') {
        currentGraphScale = 1.0;
      } else {
        currentGraphScale = 'auto';
      }
      renderGraph();
    });
  }

  // --- Clear / Reset Tree for Current Chat ---
  async function clearCurrentTree(skipConfirm = false) {
    if (!skipConfirm) {
      if (!confirm('Czy na pewno chcesz wyczyścić wszystkie gałęzie w tej rozmowie i przywrócić pierwotny widok czatu?')) {
        return;
      }
    }

    try {
      if (activeChatId) {
        const key = getStorageKey(activeChatId);
        await chrome.storage.local.remove(key);
      }
      const all = await chrome.storage.local.get(null);
      const related = Object.keys(all).filter(k => (activeChatId && k.includes(activeChatId)) || k === 'geminitree_data_default');
      if (related.length > 0) {
        await chrome.storage.local.remove(related);
      }

      currentTree = createEmptyTree(activeChatId);
      branchingFromNode = null;

      document.getElementById('gt-branch-banner-root')?.replaceChildren();
      document.querySelectorAll('.gt-version-pill-container').forEach(p => p.remove());
      document.querySelectorAll('.gt-branch-action-btn').forEach(b => b.remove());
      document.querySelectorAll('[data-gt-injected]').forEach(el => delete el.dataset.gtInjected);
      document.querySelectorAll('[data-gt-node-id]').forEach(el => el.removeAttribute('data-gt-node-id'));
      document.querySelectorAll('.gt-hidden-turn').forEach(el => {
        el.classList.remove('gt-hidden-turn');
        el.style.display = '';
      });

      updateBadge();
      renderGraph();

      const toast = document.createElement('div');
      toast.className = 'gt-toast-notice';
      toast.textContent = '✓ Pomyślnie wyczyszczono gałęzie czatu!';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2600);
    } catch (err) {
      console.warn('Error clearing tree:', err);
    }
  }

  function toggleDrawer() {
    drawerOpen = !drawerOpen;
    const drawer = document.getElementById('gt-drawer');
    const btn = document.getElementById('gt-topbar-btn');

    if (drawerOpen) {
      document.body.classList.add('gt-drawer-open');
      drawer?.classList.add('open');
      btn?.classList.add('active');
      renderGraph();
    } else {
      document.body.classList.remove('gt-drawer-open');
      drawer?.classList.remove('open');
      btn?.classList.remove('active');
    }
  }

  // 3. Branch Banner Container
  function ensureBannerContainer() {
    if (!isExtensionEnabled) return;
    if (document.getElementById('gt-branch-banner-root')) return;

    const container = document.createElement('div');
    container.id = 'gt-branch-banner-root';

    const inputContainer = findGeminiInputContainer();
    if (inputContainer && inputContainer.parentNode) {
      inputContainer.parentNode.insertBefore(container, inputContainer);
    } else {
      document.body.appendChild(container);
    }
  }

  function findGeminiInputContainer() {
    return (
      document.querySelector('.input-area-container') ||
      document.querySelector('rich-textarea')?.parentElement ||
      document.querySelector('[contenteditable="true"]')?.closest('.chat-input-container') ||
      document.querySelector('.text-input-field') ||
      document.querySelector('form')
    );
  }

  function renderBranchBanner() {
    const root = document.getElementById('gt-branch-banner-root');
    if (!root) return;

    if (!branchingFromNode) {
      root.innerHTML = '';
      return;
    }

    const snippet = branchingFromNode.content.length > 55 
      ? branchingFromNode.content.slice(0, 55) + '...' 
      : branchingFromNode.content;

    root.innerHTML = `
      <div class="gt-branch-banner">
        <div class="gt-branch-banner-info">
          <span class="gt-banner-icon">${SVG_BRANCH}</span>
          <span class="gt-banner-text">
            <strong>Nowa gałąź:</strong> Rozgałęziasz z pytania «${escapeHtml(snippet)}». Następny wysłany prompt utworzy alternatywną odnogę.
          </span>
        </div>
        <button class="gt-banner-cancel-btn" id="gt-cancel-branch">Anuluj</button>
      </div>
    `;

    document.getElementById('gt-cancel-branch')?.addEventListener('click', () => {
      branchingFromNode = null;
      currentTree.pendingBranchOriginId = null;
      renderBranchBanner();
    });
  }

  // --- Reading Input Field in Gemini ---
  function getPendingInputValue() {
    const el = 
      document.querySelector('rich-textarea [contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea.text-input-field') ||
      document.querySelector('textarea');
    if (!el) return '';
    if (el.value !== undefined && el.value !== '') return el.value.trim();
    return (el.innerText || el.textContent || '').trim();
  }

  // --- Safe Message Detection on Gemini Page ---
  function scanGeminiMessages() {
    if (!isExtensionEnabled || isScanning) return;
    isScanning = true;

    try {
      updateThemeClass();
      const userQueryElements = findUserQueryElements();
      let prevParentId = 'root';
      let changed = false;
      const claimedNodeIds = new Set();

      userQueryElements.forEach((el, index) => {
        const text = extractTextFromElement(el);
        if (!text) return;

        let existingNode = null;

        // Check 1: Already assigned ID on DOM element (must be unclaimed in this scan pass)
        const assignedId = el.getAttribute('data-gt-node-id');
        if (assignedId && currentTree.nodes[assignedId] && !claimedNodeIds.has(assignedId)) {
          existingNode = currentTree.nodes[assignedId];
        } else if (assignedId && claimedNodeIds.has(assignedId)) {
          // Remove duplicate tag so it gets assigned its own unique node
          el.removeAttribute('data-gt-node-id');
        }

        // Check 2: Was this just created as a branch in handleUserSentMessage?
        if (!existingNode && currentTree.pendingBranchNodeId) {
          const pending = currentTree.nodes[currentTree.pendingBranchNodeId];
          if (pending && (!pending.content || pending.content === text || text.includes(pending.content.slice(0, 15)))) {
            existingNode = pending;
            existingNode.content = text;
            currentTree.pendingBranchNodeId = null;
            changed = true;
          }
        }

        // Check 3: Match by exact content ONLY in unclaimed existing nodes
        if (!existingNode) {
          existingNode = Object.values(currentTree.nodes).find(n => 
            n.role === 'user' && 
            n.content === text && 
            !claimedNodeIds.has(n.id)
          );
        }

        // Check 4: If brand new message not recognized, add under current active node
        if (!existingNode) {
          // Parent is the node the user was currently switched to when sending!
          let targetParentId = currentTree.lastActiveSendParentId;
          if (!targetParentId || !currentTree.nodes[targetParentId]) {
            targetParentId = currentTree.currentNodeId;
          }
          if (!targetParentId || !currentTree.nodes[targetParentId] || targetParentId === 'root') {
            targetParentId = prevParentId;
          }

          const nodeId = 'user-' + hashStr(text) + '-' + index + '-' + Date.now();
          existingNode = {
            id: nodeId,
            parentId: targetParentId,
            role: 'user',
            content: text,
            childrenIds: [],
            activeChildId: null,
            timestamp: Date.now()
          };
          currentTree.nodes[nodeId] = existingNode;
          if (currentTree.nodes[targetParentId]) {
            if (!currentTree.nodes[targetParentId].childrenIds.includes(nodeId)) {
              currentTree.nodes[targetParentId].childrenIds.push(nodeId);
            }
            currentTree.nodes[targetParentId].activeChildId = nodeId;
          }
          currentTree.currentNodeId = nodeId;
          currentTree.lastActiveSendParentId = null;
          changed = true;
        }

        el.setAttribute('data-gt-node-id', existingNode.id);
        claimedNodeIds.add(existingNode.id);

        // Only update prevParentId if this turn is on the active path
        if (isNodeOnActivePath(existingNode.id)) {
          prevParentId = existingNode.id;
        }

        // Inject / Update Branch Button position on every scan
        injectBranchAction(el, text);

        // Inject / Update Version Pill
        injectVersionPill(el, existingNode);
      });

      if (changed) {
        saveTree();
        updateBadge();
        if (drawerOpen) renderGraph();
      }

      // Apply branch visibility: hide non-active branches!
      applyBranchVisibility();
    } finally {
      isScanning = false;
    }
  }

  function getSafeMessageElement(userQueryEl) {
    return (
      userQueryEl.closest('user-query') ||
      userQueryEl.closest('.user-query-container') ||
      userQueryEl.closest('.message-container') ||
      userQueryEl.closest('.conversation-turn') ||
      userQueryEl
    );
  }

  function isUserQueryElement(el) {
    return (
      el.tagName?.toLowerCase() === 'user-query' ||
      el.classList?.contains('user-query-container') ||
      el.classList?.contains('user-query') ||
      el.hasAttribute?.('data-gt-node-id') ||
      el.querySelector?.('button[aria-label*="Edytuj" i], button[aria-label*="Edit" i]') !== null
    );
  }

  function isNodeOnActivePath(nodeId) {
    if (!nodeId) return false;
    let curr = currentTree.nodes[currentTree.currentNodeId];
    while (curr) {
      if (curr.id === nodeId) return true;
      curr = curr.parentId ? currentTree.nodes[curr.parentId] : null;
    }
    return false;
  }

  // --- True Branch Visibility: Only the active branch path is shown! ---
  function applyBranchVisibility() {
    const activeNodeIds = new Set();
    let curr = currentTree.nodes[currentTree.currentNodeId];
    while (curr) {
      activeNodeIds.add(curr.id);
      curr = curr.parentId ? currentTree.nodes[curr.parentId] : null;
    }

    const allQueryElements = findUserQueryElements();
    allQueryElements.forEach(el => {
      const nodeId = el.getAttribute('data-gt-node-id');
      const targetEl = getSafeMessageElement(el);
      if (!nodeId || !targetEl) return;

      const node = currentTree.nodes[nodeId];
      if (!node) return;

      // Is this node on the active path?
      const isVisible = activeNodeIds.has(nodeId);

      if (isVisible) {
        targetEl.classList.remove('gt-hidden-turn');
        targetEl.style.display = '';
      } else {
        targetEl.classList.add('gt-hidden-turn');
        targetEl.style.display = 'none';
      }

      // Hide or unhide matching model-response siblings
      let nextEl = targetEl.nextElementSibling;
      while (nextEl && !isUserQueryElement(nextEl)) {
        if (isVisible) {
          nextEl.classList.remove('gt-hidden-turn');
          nextEl.style.display = '';
        } else {
          nextEl.classList.add('gt-hidden-turn');
          nextEl.style.display = 'none';
        }
        nextEl = nextEl.nextElementSibling;
      }
    });
  }

  function findUserQueryElements() {
    const selectors = [
      'user-query',
      '.user-query-container',
      '.query-text',
      '.user-query',
      'div[data-message-author-role="user"]',
      'div.query-content'
    ];

    let found = [];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length > 0) {
        found = els;
        break;
      }
    }

    if (found.length === 0) {
      const editBtns = Array.from(document.querySelectorAll('button[aria-label*="Edytuj" i], button[aria-label*="Edit" i]'));
      found = editBtns.map(b => b.closest('.message-container') || b.closest('.chat-turn') || b.parentElement?.parentElement).filter(Boolean);
    }

    return found;
  }

  function extractTextFromElement(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.gt-branch-action-btn, .gt-version-pill-container, .gt-custom-actions-bar, .gt-branch-banner, script, style').forEach(n => n.remove());
    const textEl = clone.querySelector('.query-text') || clone.querySelector('.query-content') || clone.querySelector('p') || clone;
    return (textEl.innerText || textEl.textContent || '').trim();
  }

  function hashStr(s) {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash) + s.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  // --- Injecting "Rozgałęź" Button ---
  function findActionContainer(userQueryEl) {
    // 1. Existing action buttons container from Gemini
    const geminiActions = 
      userQueryEl.querySelector('.action-buttons') || 
      userQueryEl.querySelector('.actions') || 
      userQueryEl.querySelector('button[aria-label*="Edytuj" i]')?.parentElement ||
      userQueryEl.querySelector('button[aria-label*="Edit" i]')?.parentElement ||
      userQueryEl.querySelector('[data-test-id*="action"]');
    if (geminiActions) return geminiActions;

    // 2. Inside user-query-container next to text
    const queryContainer = 
      userQueryEl.querySelector('.user-query-container') ||
      userQueryEl.querySelector('.query-content')?.parentElement ||
      userQueryEl.querySelector('.query-text')?.parentElement;
    if (queryContainer) {
      let customActions = queryContainer.querySelector('.gt-custom-actions-bar');
      if (!customActions) {
        customActions = document.createElement('div');
        customActions.className = 'gt-custom-actions-bar';
        queryContainer.appendChild(customActions);
      }
      return customActions;
    }

    return userQueryEl;
  }

  function injectBranchAction(userQueryEl, text) {
    const targetContainer = findActionContainer(userQueryEl);
    let btn = userQueryEl.querySelector('.gt-branch-action-btn');

    if (btn) {
      // If button was previously put in fallback container, but now a better container (like Gemini's .actions) is available, move it!
      if (targetContainer && btn.parentElement !== targetContainer && !targetContainer.contains(btn)) {
        targetContainer.appendChild(btn);
      }
      updateBranchButtonHandler(btn, userQueryEl, text);
      return;
    }

    btn = document.createElement('button');
    btn.className = 'gt-branch-action-btn';
    btn.innerHTML = `${SVG_BRANCH} <span>Rozgałęź</span>`;
    btn.title = 'Stwórz nową gałąź (alternatywne pytanie na tym poziomie konwersacji)';
    updateBranchButtonHandler(btn, userQueryEl, text);

    targetContainer.appendChild(btn);
  }

  function updateBranchButtonHandler(btn, userQueryEl, text) {
    btn.onclick = (e) => {
      e.stopPropagation();
      const nodeId = userQueryEl.getAttribute('data-gt-node-id');
      const node = nodeId ? currentTree.nodes[nodeId] : null;
      if (node) {
        onBranchOffClick(node);
      } else {
        const cleanText = extractTextFromElement(userQueryEl) || text;
        const found = Object.values(currentTree.nodes).find(n => n.role === 'user' && n.content === cleanText);
        if (found) onBranchOffClick(found);
      }
    };
  }

  function onBranchOffClick(node) {
    if (!node) return;

    branchingFromNode = node;
    currentTree.pendingBranchOriginId = node.id;
    renderBranchBanner();

    const input = document.querySelector('rich-textarea [contenteditable="true"]') ||
                  document.querySelector('textarea') ||
                  document.querySelector('[contenteditable="true"]');
    if (input) {
      input.focus();
    }
  }

  // --- Injecting Version Pill (< Wersja 1 z 3 >) Cleanly ---
  function injectVersionPill(userQueryEl, node) {
    const parentNode = currentTree.nodes[node.parentId];
    if (!parentNode || !parentNode.childrenIds || parentNode.childrenIds.length <= 1) {
      userQueryEl.querySelector('.gt-version-pill-container')?.remove();
      return;
    }

    const siblings = parentNode.childrenIds;
    const currentIndex = siblings.indexOf(node.id);
    if (currentIndex === -1) return;

    let container = userQueryEl.querySelector('.gt-version-pill-container');
    const pillKey = `${node.id}_${currentIndex}_${siblings.length}`;

    if (container && container.dataset.pillKey === pillKey) {
      return;
    }

    if (!container) {
      container = document.createElement('div');
      container.className = 'gt-version-pill-container';
      userQueryEl.insertBefore(container, userQueryEl.firstChild);
    }

    container.dataset.pillKey = pillKey;
    container.innerHTML = `
      <div class="gt-version-pill">
        <button class="gt-version-arrow-btn" id="gt-prev-${node.id}" ${currentIndex <= 0 ? 'disabled' : ''} title="Poprzednia wersja">
          ${SVG_CHEVRON_LEFT}
        </button>
        <button class="gt-version-label-btn" id="gt-label-${node.id}" title="Kliknij, aby rozwinąć wersje">
          Wersja ${currentIndex + 1} z ${siblings.length}
        </button>
        <button class="gt-version-arrow-btn" id="gt-next-${node.id}" ${currentIndex >= siblings.length - 1 ? 'disabled' : ''} title="Następna wersja">
          ${SVG_CHEVRON_RIGHT}
        </button>
      </div>
      <div class="gt-version-dropdown" id="gt-dropdown-${node.id}" style="display: none;">
        ${siblings.map((sId, sIdx) => {
          const sNode = currentTree.nodes[sId];
          if (!sNode) return '';
          const isAct = sId === node.id;
          return `
            <div class="gt-version-dropdown-item ${isAct ? 'active' : ''}">
              <div class="gt-version-item-click" data-node-id="${sId}" style="display: flex; align-items: center; gap: 8px; flex: 1; cursor: pointer;">
                <span class="gt-item-badge">#${sIdx + 1}</span>
                <span class="gt-item-text">${escapeHtml(sNode.content)}</span>
              </div>
              ${siblings.length > 1 ? `
                <button class="gt-version-delete-btn" data-delete-id="${sId}" title="Usuń tę wersję gałęzi">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelector(`#gt-prev-${node.id}`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      switchBranch(node.parentId, currentIndex - 1);
    });
    container.querySelector(`#gt-next-${node.id}`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      switchBranch(node.parentId, currentIndex + 1);
    });

    const dropdown = container.querySelector(`#gt-dropdown-${node.id}`);
    const labelBtn = container.querySelector(`#gt-label-${node.id}`);
    labelBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = dropdown.style.display !== 'none' ? 'none' : 'flex';
    });

    dropdown?.querySelectorAll('.gt-version-item-click').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = item.getAttribute('data-node-id');
        const targetIdx = siblings.indexOf(targetId);
        if (targetIdx !== -1) {
          switchBranch(node.parentId, targetIdx);
        }
      });
    });

    dropdown?.querySelectorAll('.gt-version-delete-btn').forEach(delBtn => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = delBtn.getAttribute('data-delete-id');
        deleteSpecificBranch(node.parentId, targetId);
      });
    });
  }

  function deleteSpecificBranch(parentId, childIdToDelete) {
    const parentNode = currentTree.nodes[parentId];
    if (!parentNode || !parentNode.childrenIds) return;

    if (!confirm('Czy na pewno chcesz usunąć tę wersję gałęzi?')) return;

    parentNode.childrenIds = parentNode.childrenIds.filter(id => id !== childIdToDelete);

    if (parentNode.activeChildId === childIdToDelete) {
      parentNode.activeChildId = parentNode.childrenIds[0] || null;
    }

    const toDelete = [childIdToDelete];
    while (toDelete.length > 0) {
      const id = toDelete.pop();
      const n = currentTree.nodes[id];
      if (n) {
        (n.childrenIds || []).forEach(cId => toDelete.push(cId));
        delete currentTree.nodes[id];
      }
    }

    let curr = parentNode.id;
    while (currentTree.nodes[curr] && currentTree.nodes[curr].activeChildId) {
      curr = currentTree.nodes[curr].activeChildId;
    }
    currentTree.currentNodeId = curr;

    saveTree();
    applyBranchVisibility();
    updateBadge();
    if (drawerOpen) renderGraph();
    triggerDebouncedScan();
  }

  function switchBranch(parentId, targetIndex) {
    const parentNode = currentTree.nodes[parentId];
    if (!parentNode || !parentNode.childrenIds) return;
    const targetChildId = parentNode.childrenIds[targetIndex];
    if (!targetChildId) return;

    parentNode.activeChildId = targetChildId;

    let curr = targetChildId;
    while (currentTree.nodes[curr] && currentTree.nodes[curr].activeChildId) {
      curr = currentTree.nodes[curr].activeChildId;
    }
    currentTree.currentNodeId = curr;

    saveTree();
    applyBranchVisibility();

    if (drawerOpen) renderGraph();
    scrollToNode(targetChildId);
  }

  function scrollToNode(nodeId) {
    const node = currentTree.nodes[nodeId];
    if (!node) return;
    const queries = findUserQueryElements();
    for (const q of queries) {
      if (extractTextFromElement(q).includes(node.content.slice(0, 30))) {
        q.scrollIntoView({ behavior: 'smooth', block: 'center' });
        q.classList.add('gt-highlight-flash');
        setTimeout(() => q.classList.remove('gt-highlight-flash'), 1500);
        break;
      }
    }
  }

  // --- Intercept Gemini Message Submissions & True Branch Spawning ---
  function interceptSendEvents() {
    // Intercept Enter key in capturing phase
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const isChatInput = e.target.closest('rich-textarea, [contenteditable="true"], textarea, .chat-input-container');
        if (!isChatInput) return;

        // Check if user pressed Enter inside an edited query turn
        const editedTurn = e.target.closest('user-query, .user-query-container, .message-container, .conversation-turn');
        const editedId = editedTurn?.getAttribute('data-gt-node-id');

        if (branchingFromNode || currentTree.pendingBranchOriginId) {
          handleUserSentMessage();
        } else if (editedId && currentTree.nodes[editedId]) {
          currentTree.lastActiveSendParentId = currentTree.nodes[editedId].parentId || 'root';
        } else {
          // Record current active node as parent for this new message
          currentTree.lastActiveSendParentId = currentTree.currentNodeId && currentTree.nodes[currentTree.currentNodeId]
            ? currentTree.currentNodeId
            : 'root';
        }
      }
    }, true);

    // Intercept Send button click in capturing phase
    document.addEventListener('click', (e) => {
      const sendBtn = e.target.closest('button[aria-label*="Wyślij" i], button[aria-label*="Send" i], button[aria-label*="Prześlij" i], button[aria-label*="Submit" i], button[aria-label*="Aktualizuj" i], button[aria-label*="Update" i], .send-button, [data-test-id*="send" i], [mattooltip*="Wyślij" i]');
      if (sendBtn) {
        if (branchingFromNode || currentTree.pendingBranchOriginId) {
          handleUserSentMessage();
        } else {
          // Check if user clicked "Aktualizuj" on an edited turn
          const editedTurn = sendBtn.closest('user-query, .user-query-container, .message-container, .conversation-turn');
          const editedId = editedTurn?.getAttribute('data-gt-node-id');
          if (editedId && currentTree.nodes[editedId]) {
            currentTree.lastActiveSendParentId = currentTree.nodes[editedId].parentId || 'root';
          } else {
            currentTree.lastActiveSendParentId = currentTree.currentNodeId && currentTree.nodes[currentTree.currentNodeId]
              ? currentTree.currentNodeId
              : 'root';
          }
        }
      }

      // Detect New Chat in Gemini sidebar
      const newChatBtn = e.target.closest('a[href="/app"], [aria-label*="Nowy czat" i], [aria-label*="New chat" i]');
      if (newChatBtn) {
        sessionStorage.setItem('gt_current_session_id', `new_session_${Date.now()}`);
        setTimeout(() => {
          loadTreeForCurrentChat().then(() => {
            destroyExtensionUI();
            initExtensionUI();
            triggerDebouncedScan();
          });
        }, 300);
      }
    }, true);
  }

  // CORE: When user sends a message while branching mode is active!
  function handleUserSentMessage() {
    const originNode = branchingFromNode || 
      (currentTree.pendingBranchOriginId ? currentTree.nodes[currentTree.pendingBranchOriginId] : null);

    if (!originNode) return;

    const pendingText = getPendingInputValue();
    const targetParentId = originNode.parentId || 'root';

    console.log('[Gemini Tree] Branching from origin:', originNode.id, 'parent:', targetParentId, 'text:', pendingText);

    // Create the branch node immediately as a sibling of originNode!
    const newNodeId = 'user-' + hashStr(pendingText || ('branch-' + Date.now())) + '-' + Date.now();
    const newNode = {
      id: newNodeId,
      parentId: targetParentId,
      role: 'user',
      content: pendingText || '',
      childrenIds: [],
      activeChildId: null,
      timestamp: Date.now()
    };

    currentTree.nodes[newNodeId] = newNode;

    const parentNode = currentTree.nodes[targetParentId];
    if (parentNode) {
      if (!parentNode.childrenIds.includes(newNodeId)) {
        parentNode.childrenIds.push(newNodeId);
      }
      // Set the new branch as active!
      parentNode.activeChildId = newNodeId;
    }

    currentTree.currentNodeId = newNodeId;
    currentTree.pendingBranchNodeId = newNodeId;

    // Reset branching mode
    branchingFromNode = null;
    currentTree.pendingBranchOriginId = null;

    saveTree();
    renderBranchBanner();

    // Instantly hide the old branch messages!
    applyBranchVisibility();

    setTimeout(() => {
      triggerDebouncedScan();
    }, 500);
  }

  // --- Canvas Panning & Zoom Interaction ---
  let isCanvasPanning = false;
  let panStartX = 0, panStartY = 0;
  let panStartScrollLeft = 0, panStartScrollTop = 0;

  function setupCanvasPanning(container) {
    container.onmousedown = (e) => {
      if (e.target.closest('.gt-tree-dot, .gt-tree-tooltip, button, input')) return;
      isCanvasPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartScrollLeft = container.scrollLeft;
      panStartScrollTop = container.scrollTop;
      container.classList.add('is-panning');
    };

    container.onwheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        let baseVal = currentGraphScale === 'auto' ? lastCalculatedScale : currentGraphScale;
        currentGraphScale = parseFloat((Math.max(0.35, Math.min(1.8, baseVal + delta))).toFixed(2));
        renderGraph();
      }
    };
  }

  window.addEventListener('mousemove', (e) => {
    if (!isCanvasPanning) return;
    const container = document.getElementById('gt-graph-content');
    if (!container) return;
    container.scrollLeft = panStartScrollLeft - (e.clientX - panStartX);
    container.scrollTop = panStartScrollTop - (e.clientY - panStartY);
  });

  window.addEventListener('mouseup', () => {
    if (isCanvasPanning) {
      isCanvasPanning = false;
      document.getElementById('gt-graph-content')?.classList.remove('is-panning');
    }
  });

  window.addEventListener('resize', () => {
    if (drawerOpen) {
      if (renderGraphDebounceTimer) clearTimeout(renderGraphDebounceTimer);
      renderGraphDebounceTimer = setTimeout(() => renderGraph(), 150);
    }
  });

  // --- Render Hierarchical Dot Tree Graph in Drawer ---
  function renderGraph() {
    const container = document.getElementById('gt-graph-content');
    if (!container) return;

    // 1. Compute Active Path IDs (from current active leaf up to root)
    const activePathIds = new Set();
    let currId = currentTree.currentNodeId;
    while (currId && currentTree.nodes[currId] && !activePathIds.has(currId)) {
      activePathIds.add(currId);
      currId = currentTree.nodes[currId].parentId;
    }

    // 2. Identify root nodes
    const rootNode = currentTree.nodes[currentTree.rootId || 'root'] || currentTree.nodes['root'];
    let rootChildrenIds = Array.from(new Set(rootNode?.childrenIds || []))
      .filter(id => currentTree.nodes[id]);

    const totalUserNodes = Object.values(currentTree.nodes).filter(n => n.role === 'user').length;
    const branchesCount = Object.values(currentTree.nodes).filter(n => (n.childrenIds || []).length > 1).length;

    // Resilient fallback: If root.childrenIds is empty but user nodes exist, find root-level queries
    if (rootChildrenIds.length === 0 && totalUserNodes > 0) {
      const allUser = Object.values(currentTree.nodes).filter(n => n.role === 'user');
      const candidates = allUser.filter(n => !n.parentId || n.parentId === 'root' || !currentTree.nodes[n.parentId]);
      rootChildrenIds = candidates.map(n => n.id);
      if (rootNode) rootNode.childrenIds = rootChildrenIds;
    }

    if (totalUserNodes === 0 || rootChildrenIds.length === 0) {
      document.getElementById('gt-stat-nodes').textContent = '0';
      document.getElementById('gt-stat-depth').textContent = '0';
      document.getElementById('gt-stat-branches').textContent = '1';
      container.innerHTML = `
        <div class="gt-graph-empty">
          <div style="font-size: 28px; margin-bottom: 10px;">🌱</div>
          <div style="font-weight: 600; margin-bottom: 4px; color: var(--gt-text, #e2e8f0);">Brak gałęzi do wyświetlenia</div>
          <div>Napisz prompt w Gemini lub użyj <b>🌿 Rozgałęź</b>, aby utworzyć alternatywną ścieżkę.</div>
        </div>
      `;
      return;
    }

    // 3. Build hierarchical tree model
    const visited = new Set();
    function buildTreeNode(nodeId, depth = 1) {
      if (visited.has(nodeId)) return null;
      visited.add(nodeId);

      const rawNode = currentTree.nodes[nodeId];
      if (!rawNode) return null;

      const validChildIds = Array.from(new Set(rawNode.childrenIds || []))
        .filter(cId => currentTree.nodes[cId]);

      const children = validChildIds
        .map(cId => buildTreeNode(cId, depth + 1))
        .filter(Boolean);

      const isActive = activePathIds.has(nodeId);
      const isCurrent = nodeId === currentTree.currentNodeId;
      const isFork = children.length > 1;

      return {
        id: nodeId,
        rawNode,
        content: rawNode.content || '',
        depth,
        isActive,
        isCurrent,
        isFork,
        children,
        width: 1,
        x: 0,
        y: 0
      };
    }

    let treeRoots = [];
    if (rootChildrenIds.length === 1) {
      const singleRoot = buildTreeNode(rootChildrenIds[0], 1);
      if (singleRoot) treeRoots.push(singleRoot);
    } else {
      // First prompt was branched into alternatives: connect them from a clear start origin
      const originChildren = rootChildrenIds.map(cId => buildTreeNode(cId, 2)).filter(Boolean);
      treeRoots.push({
        id: 'gt-root-origin',
        rawNode: { id: 'gt-root-origin', role: 'system', content: 'Rozpoczęcie czatu' },
        content: 'Rozpoczęcie czatu',
        depth: 1,
        isActive: true,
        isCurrent: false,
        isFork: originChildren.length > 1,
        isOrigin: true,
        children: originChildren,
        width: 1,
        x: 0,
        y: 0
      });
    }

    if (treeRoots.length === 0) return;

    // 4. Calculate subtree widths (leaf columns)
    function calculateWidths(node) {
      if (!node.children || node.children.length === 0) {
        node.width = 1;
        return 1;
      }
      let sum = 0;
      for (const child of node.children) {
        sum += calculateWidths(child);
      }
      node.width = Math.max(1, sum);
      return node.width;
    }

    let totalCols = 0;
    for (const root of treeRoots) {
      totalCols += calculateWidths(root);
    }

    // 5. Layout & Position Assignment (Top-down hierarchical layout)
    const ROW_HEIGHT = 70;
    const COL_WIDTH = 58;
    const PADDING_X = 32;
    const PADDING_Y = 28;

    const allRenderNodes = [];
    const allRenderEdges = [];
    let maxDepth = 1;

    const naturalTreeWidth = totalCols * COL_WIDTH;
    const naturalWidth = Math.max(280, naturalTreeWidth + PADDING_X * 2);
    const startOffset = Math.max(PADDING_X, (naturalWidth - naturalTreeWidth) / 2);

    function assignPositions(node, colOffset) {
      const centerCol = colOffset + node.width / 2;
      node.x = Math.round(startOffset + centerCol * COL_WIDTH);
      node.y = Math.round((node.depth - 1) * ROW_HEIGHT + PADDING_Y);

      if (node.depth > maxDepth) maxDepth = node.depth;
      allRenderNodes.push(node);

      let currentOffset = colOffset;
      for (const child of node.children) {
        assignPositions(child, currentOffset);

        allRenderEdges.push({
          id: `${node.id}->${child.id}`,
          from: { x: node.x, y: node.y },
          to: { x: child.x, y: child.y },
          isActive: node.isActive && child.isActive
        });

        currentOffset += child.width;
      }
    }

    let offset = 0;
    for (const root of treeRoots) {
      assignPositions(root, offset);
      offset += root.width;
    }

    const naturalHeight = maxDepth * ROW_HEIGHT + PADDING_Y * 2;

    // Update stats bar
    document.getElementById('gt-stat-nodes').textContent = totalUserNodes.toString();
    document.getElementById('gt-stat-depth').textContent = maxDepth.toString();
    document.getElementById('gt-stat-branches').textContent = (branchesCount + 1).toString();

    // 6. Compute Auto-Fit Scale
    const availWidth = Math.max(260, (container.clientWidth || 340) - 16);
    const availHeight = Math.max(260, (container.clientHeight || (window.innerHeight - 260)) - 24);

    const scaleX = availWidth / naturalWidth;
    const scaleY = availHeight / naturalHeight;

    let autoScale = Math.min(scaleX, scaleY, 1.0);
    autoScale = Math.max(0.38, Math.min(1.0, autoScale));
    lastCalculatedScale = autoScale;

    let activeScale = 1.0;
    if (currentGraphScale === 'auto') {
      activeScale = autoScale;
    } else {
      activeScale = Math.max(0.35, Math.min(1.8, Number(currentGraphScale) || 1.0));
    }

    // Update Zoom display badge
    const displayEl = document.getElementById('gt-zoom-display');
    if (displayEl) {
      const pct = Math.round(activeScale * 100);
      displayEl.textContent = currentGraphScale === 'auto' ? `Auto (${pct}%)` : `${pct}%`;
    }

    // 7. Build Stage DOM with Scale Wrapper
    container.innerHTML = '';

    const stageWidth = naturalWidth;
    const stageHeight = naturalHeight;
    const scaledWidth = Math.round(stageWidth * activeScale);
    const scaledHeight = Math.round(stageHeight * activeScale);

    const stageWrap = document.createElement('div');
    stageWrap.className = 'gt-tree-stage-wrap';
    stageWrap.style.width = `${scaledWidth}px`;
    stageWrap.style.height = `${scaledHeight}px`;

    const stageEl = document.createElement('div');
    stageEl.className = 'gt-tree-stage';
    stageEl.style.width = `${stageWidth}px`;
    stageEl.style.height = `${stageHeight}px`;
    stageEl.style.transform = `scale(${activeScale})`;
    stageEl.style.transformOrigin = 'top center';

    // Counter-scale for tooltips so text is always 100% legible
    const counterScale = activeScale < 0.92 ? `scale(${(1 / activeScale).toFixed(3)})` : 'scale(1)';
    stageEl.style.setProperty('--gt-tooltip-counter-scale', counterScale);

    // Background horizontal depth guidelines
    for (let d = 1; d <= maxDepth; d++) {
      const guideY = (d - 1) * ROW_HEIGHT + PADDING_Y;
      const guideEl = document.createElement('div');
      guideEl.className = 'gt-level-guide';
      guideEl.style.top = `${guideY}px`;
      stageEl.appendChild(guideEl);
    }

    // SVG Connecting Edges (Bezier curves directly from Parent to Child)
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('class', 'gt-tree-svg');
    svgEl.setAttribute('width', stageWidth.toString());
    svgEl.setAttribute('height', stageHeight.toString());

    // Glow filter for active path
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <filter id="gt-active-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="glow" />
        <feMerge>
          <feMergeNode in="glow" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    `;
    svgEl.appendChild(defs);

    allRenderEdges.forEach(edge => {
      const cpY = Math.round((edge.from.y + edge.to.y) / 2);
      const d = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x} ${cpY}, ${edge.to.x} ${cpY}, ${edge.to.x} ${edge.to.y}`;
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', d);
      pathEl.setAttribute('class', `gt-tree-edge ${edge.isActive ? 'gt-edge-active' : 'gt-edge-inactive'}`);
      if (edge.isActive) {
        pathEl.setAttribute('filter', 'url(#gt-active-glow)');
      }
      svgEl.appendChild(pathEl);
    });
    stageEl.appendChild(svgEl);

    // Nodes (Dots with tooltips and jump-to actions)
    allRenderNodes.forEach(node => {
      const nodeWrap = document.createElement('div');
      nodeWrap.className = 'gt-tree-node-wrap';
      nodeWrap.style.left = `${node.x}px`;
      nodeWrap.style.top = `${node.y}px`;

      let dotClass = 'gt-tree-dot';
      if (node.isCurrent) dotClass += ' is-current';
      else if (node.isActive) dotClass += ' is-active';
      else dotClass += ' is-alt';

      if (node.isFork) dotClass += ' is-fork';
      if (node.isOrigin) dotClass += ' is-origin';

      const dotBtn = document.createElement('button');
      dotBtn.className = dotClass;
      dotBtn.setAttribute('title', node.isOrigin ? 'Początek czatu' : 'Kliknij, aby przeskoczyć do tej gałęzi');

      // Inner number or origin icon
      if (node.isOrigin) {
        dotBtn.innerHTML = '🌱';
      } else {
        dotBtn.innerHTML = `<span>${node.depth}</span>`;
      }

      // Current active leaf: animated pulsing ring
      if (node.isCurrent) {
        const pulse = document.createElement('span');
        pulse.className = 'gt-pulse-ring';
        dotBtn.appendChild(pulse);
      }

      // Fork node: fork badge
      if (node.isFork) {
        const forkIndicator = document.createElement('span');
        forkIndicator.className = 'gt-fork-badge';
        forkIndicator.title = `Rozgałęzienie: ${node.children.length} gałęzie`;
        dotBtn.appendChild(forkIndicator);
      }

      // Tooltip
      const tooltip = document.createElement('div');
      let tooltipClass = 'gt-tree-tooltip';
      if (node.x < 110) tooltipClass += ' align-left';
      else if (stageWidth - node.x < 110) tooltipClass += ' align-right';
      tooltip.className = tooltipClass;

      let badgeText = 'Inna gałąź';
      let badgeClass = 'alt';
      if (node.isCurrent) {
        badgeText = 'Jesteś tutaj';
        badgeClass = 'current';
      } else if (node.isActive) {
        badgeText = 'Aktywna ścieżka';
        badgeClass = 'active';
      }

      const snippet = (node.content || '').trim().slice(0, 130);
      const hint = node.isCurrent 
        ? '✓ Wyświetlana w oknie czatu' 
        : (node.isOrigin ? 'Początek rozmowy' : '👉 Kliknij punkt, aby przeskoczyć');

      tooltip.innerHTML = `
        <div class="gt-tooltip-header">
          <span class="gt-tooltip-title">${node.isOrigin ? 'Początek czatu' : `Krok #${node.depth}`}</span>
          <span class="gt-tooltip-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="gt-tooltip-snippet">${escapeHtml(snippet) || '<em>(Brak treści promptu)</em>'}</div>
        ${!node.isOrigin ? `
          <div class="gt-tooltip-actions">
            <button class="gt-tooltip-branch-btn" type="button">
              ${SVG_BRANCH} <span>Rozgałęź z tego kroku</span>
            </button>
          </div>
        ` : ''}
        <div class="gt-tooltip-footer">${hint}</div>
      `;

      // Tooltip branch action button
      const branchBtn = tooltip.querySelector('.gt-tooltip-branch-btn');
      if (branchBtn) {
        branchBtn.onclick = (e) => {
          e.stopPropagation();
          jumpToNode(node.id);
          onBranchOffClick(node.rawNode);
        };
      }

      nodeWrap.appendChild(dotBtn);
      nodeWrap.appendChild(tooltip);

      dotBtn.onclick = (e) => {
        e.stopPropagation();
        if (node.isOrigin) return;
        jumpToNode(node.id);
      };

      dotBtn.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (node.isOrigin) return;
        jumpToNode(node.id);
        onBranchOffClick(node.rawNode);
      };

      stageEl.appendChild(nodeWrap);
    });

    stageWrap.appendChild(stageEl);
    container.appendChild(stageWrap);
    setupCanvasPanning(container);
  }

  function jumpToNode(nodeId) {
    if (nodeId === 'root' || nodeId === 'gt-root-origin') return;
    let curr = currentTree.nodes[nodeId];
    if (!curr) return;

    // Point all ancestors' activeChildId towards this selected node
    while (curr && curr.parentId && currentTree.nodes[curr.parentId]) {
      currentTree.nodes[curr.parentId].activeChildId = curr.id;
      curr = currentTree.nodes[curr.parentId];
    }

    // Set active node directly to the chosen node (so typing continues from here!)
    currentTree.currentNodeId = nodeId;

    saveTree();
    applyBranchVisibility();
    renderGraph();
    scrollToNode(nodeId);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Debounced Scanner ---
  function triggerDebouncedScan() {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => {
      scanGeminiMessages();
      ensureTopbarButton();
      ensureBannerContainer();
    }, 400);
  }

  // --- Master Toggle Listener ---
  async function checkMasterEnabled() {
    const { gt_extension_enabled = true } = await chrome.storage.local.get('gt_extension_enabled');
    isExtensionEnabled = gt_extension_enabled;
    if (!isExtensionEnabled) {
      destroyExtensionUI();
    } else {
      initExtensionUI();
      triggerDebouncedScan();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.gt_extension_enabled !== undefined) {
      isExtensionEnabled = changes.gt_extension_enabled.newValue;
      if (!isExtensionEnabled) {
        destroyExtensionUI();
      } else {
        initExtensionUI();
        triggerDebouncedScan();
      }
    }
  });

  // --- Initialization ---
  async function init() {
    await checkMasterEnabled();
    if (!isExtensionEnabled) return;

    await loadTreeForCurrentChat();
    initExtensionUI();
    triggerDebouncedScan();
    interceptSendEvents();

    // Listen for SPA URL changes
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        loadTreeForCurrentChat().then(() => {
          destroyExtensionUI();
          initExtensionUI();
          triggerDebouncedScan();
        });
      }
    }, 800);

    // Watch for new incoming messages without infinite mutation loops
    const chatContainer = document.querySelector('main') || document.body;
    const observer = new MutationObserver((mutations) => {
      const isOurMutation = mutations.every(m => {
        const target = m.target;
        return (
          target.id?.startsWith('gt-') ||
          target.className?.includes?.('gt-') ||
          target.closest?.('#gt-drawer') ||
          target.closest?.('#gt-branch-banner-root') ||
          target.closest?.('.gt-version-pill-container')
        );
      });

      if (!isOurMutation) {
        triggerDebouncedScan();
      }
    });

    observer.observe(chatContainer, { childList: true, subtree: true });

    // Live CLEAR_TREE message listener
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'CLEAR_TREE') {
        clearCurrentTree(true).then(() => {
          sendResponse({ success: true });
        });
        return true;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
