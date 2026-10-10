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

  function createEmptyTree(chatId) {
    return {
      chatId: chatId,
      rootId: 'root',
      currentNodeId: 'root',
      pendingBranchOriginId: null,
      pendingBranchNodeId: null,
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
      <div class="gt-drawer-header">
        <div class="gt-drawer-title-wrap">
          <span class="gt-drawer-icon-accent">${SVG_NETWORK}</span>
          <h3>Drzewo Konwersacji Gemini <span class="gt-version-badge">v1.1</span></h3>
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

        <div class="gt-legend">
          <div class="gt-legend-item"><span class="gt-legend-dot active"></span> Aktywna ścieżka</div>
          <div class="gt-legend-item"><span class="gt-legend-dot other"></span> Inne odnogi</div>
          <div class="gt-legend-item"><span class="gt-legend-dot fork"></span> Rozwidlenie</div>
        </div>

        <div id="gt-graph-content" class="gt-graph-container">
          <!-- Rendered dot tree -->
        </div>
      </div>
    `;

    document.body.appendChild(drawer);
    document.getElementById('gt-drawer-close').onclick = toggleDrawer;
    document.getElementById('gt-drawer-clear-btn').onclick = () => clearCurrentTree(false);
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

      userQueryElements.forEach((el, index) => {
        const text = extractTextFromElement(el);
        if (!text) return;

        let existingNode = null;

        // Check 1: Already assigned ID on DOM element
        const assignedId = el.getAttribute('data-gt-node-id');
        if (assignedId && currentTree.nodes[assignedId]) {
          existingNode = currentTree.nodes[assignedId];
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

        // Check 3: Match by exact content in existing nodes
        if (!existingNode) {
          existingNode = Object.values(currentTree.nodes).find(n => n.role === 'user' && n.content === text);
        }

        // Check 4: If brand new message not recognized, add as standard linear child
        if (!existingNode) {
          const nodeId = 'user-' + hashStr(text) + '-' + index;
          existingNode = {
            id: nodeId,
            parentId: prevParentId,
            role: 'user',
            content: text,
            childrenIds: [],
            activeChildId: null,
            timestamp: Date.now()
          };
          currentTree.nodes[nodeId] = existingNode;
          if (currentTree.nodes[prevParentId]) {
            if (!currentTree.nodes[prevParentId].childrenIds.includes(nodeId)) {
              currentTree.nodes[prevParentId].childrenIds.push(nodeId);
            }
            currentTree.nodes[prevParentId].activeChildId = nodeId;
          }
          currentTree.currentNodeId = nodeId;
          changed = true;
        }

        el.setAttribute('data-gt-node-id', existingNode.id);
        prevParentId = existingNode.id;

        // Inject Branch Button once per element
        if (!el.dataset.gtInjected) {
          injectBranchAction(el, text);
          el.dataset.gtInjected = 'true';
        }

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
    const textEl = el.querySelector('.query-text') || el.querySelector('p') || el;
    return textEl.innerText.trim();
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
  function injectBranchAction(userQueryEl, text) {
    if (userQueryEl.querySelector('.gt-branch-action-btn')) return;

    const actionContainer = 
      userQueryEl.querySelector('.action-buttons') || 
      userQueryEl.querySelector('.actions') || 
      userQueryEl.querySelector('button[aria-label*="Edytuj" i]')?.parentElement ||
      userQueryEl;

    const btn = document.createElement('button');
    btn.className = 'gt-branch-action-btn';
    btn.innerHTML = `${SVG_BRANCH} <span>Rozgałęź</span>`;
    btn.title = 'Stwórz nową gałąź (alternatywne pytanie na tym poziomie konwersacji)';
    btn.onclick = (e) => {
      e.stopPropagation();
      onBranchOffClick(text);
    };

    actionContainer.appendChild(btn);
  }

  function onBranchOffClick(promptText) {
    const node = Object.values(currentTree.nodes).find(n => n.role === 'user' && n.content === promptText);
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
        if (branchingFromNode || currentTree.pendingBranchOriginId) {
          handleUserSentMessage();
        }
      }
    }, true);

    // Intercept Send button click in capturing phase
    document.addEventListener('click', (e) => {
      const sendBtn = e.target.closest('button[aria-label*="Wyślij" i], button[aria-label*="Send" i], .send-button');
      if (sendBtn) {
        if (branchingFromNode || currentTree.pendingBranchOriginId) {
          handleUserSentMessage();
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

  // --- Render True Hierarchical SVG Dot Tree Graph in Drawer ---
  function renderGraph() {
    const container = document.getElementById('gt-graph-content');
    if (!container) return;

    const activePathIds = new Set();
    let currId = currentTree.currentNodeId;
    const pathVisited = new Set();
    while (currId && currentTree.nodes[currId] && !pathVisited.has(currId)) {
      pathVisited.add(currId);
      activePathIds.add(currId);
      currId = currentTree.nodes[currId].parentId;
    }

    // 1. Build hierarchy of turns
    const visitedHierarchy = new Set();
    function buildHierarchy(nodeId, depth = 1) {
      if (!nodeId || visitedHierarchy.has(nodeId)) return null;
      visitedHierarchy.add(nodeId);

      const node = currentTree.nodes[nodeId];
      if (!node || node.role === 'system') return null;

      const validChildrenIds = (node.childrenIds || []).filter(cId => {
        const c = currentTree.nodes[cId];
        return c && c.role !== 'system' && !visitedHierarchy.has(cId);
      });

      const children = validChildrenIds
        .map(cId => buildHierarchy(cId, depth + 1))
        .filter(Boolean);

      const isActive = activePathIds.has(node.id);
      const isCurrent = node.id === currentTree.currentNodeId;
      const isFork = children.length > 1;

      return {
        id: node.id,
        node,
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

    const rootNode = currentTree.nodes[currentTree.rootId || 'root'];
    const rootChildrenIds = (rootNode?.childrenIds || []).filter(id => !!currentTree.nodes[id]);

    let topNodeIds = rootChildrenIds;
    if (topNodeIds.length === 0) {
      topNodeIds = Object.values(currentTree.nodes)
        .filter(n => n.role === 'user' && (!n.parentId || n.parentId === 'root' || !currentTree.nodes[n.parentId]))
        .map(n => n.id);
    }

    const treeRoots = topNodeIds.map(id => buildHierarchy(id, 1)).filter(Boolean);

    if (treeRoots.length === 0) {
      document.getElementById('gt-stat-nodes').textContent = '0';
      document.getElementById('gt-stat-depth').textContent = '0';
      document.getElementById('gt-stat-branches').textContent = '1';
      container.innerHTML = `
        <div style="text-align: center; color: var(--gt-text-muted, #94a3b8); font-size: 13px; padding: 40px 10px;">
          Brak wiadomości w tym czacie.<br>Napisz prompt w Gemini, aby rozpocząć drzewo.
        </div>
      `;
      return;
    }

    // 2. Compute subtree leaf widths
    function calculateSubtreeWidth(item) {
      if (!item.children || item.children.length === 0) {
        item.width = 1;
        return 1;
      }
      let total = 0;
      for (const child of item.children) {
        total += calculateSubtreeWidth(child);
      }
      item.width = Math.max(1, total);
      return item.width;
    }

    let totalColumns = 0;
    for (const root of treeRoots) {
      totalColumns += calculateSubtreeWidth(root);
    }

    // 3. Assign 2D coordinates (x, y)
    const ROW_HEIGHT = 72;
    const COL_WIDTH = 56;
    const PADDING_TOP = 42;
    const PADDING_X = 36;

    let maxDepth = 1;
    const allRenderNodes = [];
    const allRenderEdges = [];

    function assignPositions(item, colOffset) {
      if (item.depth > maxDepth) maxDepth = item.depth;
      item.y = (item.depth - 1) * ROW_HEIGHT + PADDING_TOP;
      allRenderNodes.push(item);

      if (!item.children || item.children.length === 0) {
        item.x = (colOffset + 0.5) * COL_WIDTH;
      } else {
        let currentChildOffset = colOffset;
        for (const child of item.children) {
          assignPositions(child, currentChildOffset);
          currentChildOffset += child.width;

          allRenderEdges.push({
            id: `${item.id}->${child.id}`,
            from: item,
            to: child,
            isActive: item.isActive && child.isActive
          });
        }

        const firstChild = item.children[0];
        const lastChild = item.children[item.children.length - 1];
        item.x = (firstChild.x + lastChild.x) / 2;
      }
    }

    let currentOffset = 0;
    for (const root of treeRoots) {
      assignPositions(root, currentOffset);
      currentOffset += root.width;
    }

    // 4. Dimensions and centering
    const contentWidth = totalColumns * COL_WIDTH;
    const stageWidth = Math.max(330, contentWidth + PADDING_X * 2);
    const stageHeight = maxDepth * ROW_HEIGHT + 50;
    const shiftX = Math.max(PADDING_X, (stageWidth - contentWidth) / 2);

    // 5. Update stats
    const totalUserNodes = Object.values(currentTree.nodes).filter(n => n.role === 'user').length;
    const branchesCount = Object.values(currentTree.nodes).filter(n => (n.childrenIds || []).length > 1).length;
    document.getElementById('gt-stat-nodes').textContent = totalUserNodes.toString();
    document.getElementById('gt-stat-depth').textContent = maxDepth.toString();
    document.getElementById('gt-stat-branches').textContent = (branchesCount + 1).toString();

    // 6. Build DOM
    container.innerHTML = '';

    const stage = document.createElement('div');
    stage.className = 'gt-tree-stage';
    stage.style.width = `${stageWidth}px`;
    stage.style.height = `${stageHeight}px`;

    // A. Depth Grid Lines in background
    const gridContainer = document.createElement('div');
    gridContainer.className = 'gt-depth-grid';
    for (let d = 1; d <= maxDepth; d++) {
      const lineY = (d - 1) * ROW_HEIGHT + PADDING_TOP;
      const lineEl = document.createElement('div');
      lineEl.className = 'gt-depth-line';
      lineEl.style.top = `${lineY}px`;
      lineEl.innerHTML = `<span class="gt-depth-tag">Poziom ${d}</span>`;
      gridContainer.appendChild(lineEl);
    }
    stage.appendChild(gridContainer);

    // B. SVG Layer for Paths/Edges
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'gt-tree-svg');
    svg.setAttribute('width', stageWidth.toString());
    svg.setAttribute('height', stageHeight.toString());
    svg.innerHTML = `
      <defs>
        <filter id="gt-active-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
    `;

    allRenderEdges.forEach(edge => {
      const fromX = edge.from.x + shiftX;
      const fromY = edge.from.y;
      const toX = edge.to.x + shiftX;
      const toY = edge.to.y;
      const midY = (fromY + toY) / 2;

      const d = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `gt-tree-path ${edge.isActive ? 'active-path' : 'inactive-path'}`);
      if (edge.isActive) {
        path.setAttribute('filter', 'url(#gt-active-glow)');
      }
      svg.appendChild(path);
    });
    stage.appendChild(svg);

    // C. Interactive Node Dots
    allRenderNodes.forEach(item => {
      const nodeX = item.x + shiftX;
      const nodeY = item.y;

      const nodeWrap = document.createElement('div');
      let wrapClass = 'gt-tree-node-wrap';
      if (item.isCurrent) wrapClass += ' current';
      if (item.isActive) wrapClass += ' active';
      else if (item.isFork) wrapClass += ' fork';
      else wrapClass += ' other';

      nodeWrap.className = wrapClass;
      nodeWrap.style.left = `${nodeX}px`;
      nodeWrap.style.top = `${nodeY}px`;

      // Smart tooltip placement to avoid clipping
      let tooltipStyle = '';
      if (item.depth === 1) {
        tooltipStyle += 'top: calc(100% + 12px); bottom: auto;';
      }
      if (nodeX < 120) {
        tooltipStyle += ' left: 0; transform: none;';
      } else if (nodeX > stageWidth - 120) {
        tooltipStyle += ' right: 0; left: auto; transform: none;';
      }

      const snippet = item.node.content || 'Wiadomość użytkownika';

      nodeWrap.innerHTML = `
        <button class="gt-node-dot-btn" title="Poziom ${item.depth} - Kliknij, aby przejść do tej gałęzi">
          <span class="gt-dot-number">${item.depth}</span>
          ${item.isCurrent ? '<span class="gt-pulse-ring"></span>' : ''}
        </button>
        <div class="gt-node-tooltip" style="${tooltipStyle}">
          <div class="gt-tooltip-header">
            <span class="gt-tooltip-badge ${item.isActive ? 'active' : 'other'}">
              ${item.isActive ? 'Bieżąca ścieżka' : 'Wersja alternatywna'}
            </span>
            <span class="gt-tooltip-level">Poziom ${item.depth}</span>
          </div>
          <div class="gt-tooltip-snippet">${escapeHtml(snippet.slice(0, 100))}</div>
          <div class="gt-tooltip-actions">
            <button class="gt-tooltip-jump-btn">Przejdź tutaj</button>
            <button class="gt-tooltip-branch-btn">🌿 Rozgałęź</button>
          </div>
        </div>
      `;

      nodeWrap.querySelector('.gt-node-dot-btn').onclick = (e) => {
        e.stopPropagation();
        jumpToNode(item.id);
      };
      nodeWrap.querySelector('.gt-tooltip-jump-btn').onclick = (e) => {
        e.stopPropagation();
        jumpToNode(item.id);
      };
      nodeWrap.querySelector('.gt-tooltip-branch-btn').onclick = (e) => {
        e.stopPropagation();
        onBranchOffClick(snippet);
      };

      stage.appendChild(nodeWrap);
    });

    container.appendChild(stage);
  }

  function jumpToNode(nodeId) {
    let curr = currentTree.nodes[nodeId];
    while (curr && curr.parentId && currentTree.nodes[curr.parentId]) {
      currentTree.nodes[curr.parentId].activeChildId = curr.id;
      curr = currentTree.nodes[curr.parentId];
    }

    let deepest = nodeId;
    while (currentTree.nodes[deepest] && currentTree.nodes[deepest].activeChildId) {
      deepest = currentTree.nodes[deepest].activeChildId;
    }
    currentTree.currentNodeId = deepest;

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
    console.log('%c[Gemini Tree] Extension v1.1.0 loaded successfully!', 'color: #10b981; font-weight: bold;');
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
