/**
 * Gemini Tree Chrome Extension — Content Script for gemini.google.com
 * Ultra-stable, flicker-free, with chat isolation, branch hiding, and theme adaptation.
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

  // --- Theme Detection (No Reflow Forcing) ---
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
    document.querySelectorAll('.gt-hidden-turn').forEach(el => el.classList.remove('gt-hidden-turn'));
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
          <h3>Drzewo Konwersacji Gemini</h3>
        </div>
        <button class="gt-drawer-close-btn" id="gt-drawer-close" title="Zamknij panel">
          ${SVG_CLOSE}
        </button>
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
            <strong>Nowa gałąź:</strong> Rozgałęziasz z pytania «${escapeHtml(snippet)}». Następny prompt utworzy alternatywną odnogę.
          </span>
        </div>
        <button class="gt-banner-cancel-btn" id="gt-cancel-branch">Anuluj</button>
      </div>
    `;

    document.getElementById('gt-cancel-branch')?.addEventListener('click', () => {
      branchingFromNode = null;
      renderBranchBanner();
    });
  }

  // --- Safe Message Detection on Gemini Page (No Layout Thrashing) ---
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

        // Check or create node in tree
        let existingNode = Object.values(currentTree.nodes).find(n => n.role === 'user' && n.content === text);
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

        // Inject UI only once per element to prevent DOM thrashing!
        if (!el.dataset.gtInjected) {
          injectBranchAction(el, text);
          el.dataset.gtInjected = 'true';
        }

        // Inject / Update Version Pill cleanly
        injectVersionPill(el, existingNode);
      });

      if (changed) {
        saveTree();
        updateBadge();
        if (drawerOpen) renderGraph();
      }

      // Apply branch visibility strictly to query containers only!
      applyBranchVisibility();
    } finally {
      isScanning = false;
    }
  }

  // SAFE: Gets only the immediate message card, NEVER the whole chat container!
  function getSafeMessageElement(userQueryEl) {
    return (
      userQueryEl.closest('user-query') ||
      userQueryEl.closest('.user-query-container') ||
      userQueryEl.closest('.message-container') ||
      userQueryEl.closest('.conversation-turn') ||
      userQueryEl
    );
  }

  // --- Strict Branch Visibility (SAFE, NO WHOLE-PAGE HIDING) ---
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

      if (nodeId && targetEl) {
        const isBranchNode = currentTree.nodes[nodeId];
        if (isBranchNode) {
          const parent = currentTree.nodes[isBranchNode.parentId];
          const hasMultipleBranches = parent && (parent.childrenIds || []).length > 1;

          if (hasMultipleBranches) {
            const isActive = activeNodeIds.has(nodeId);
            if (isActive) {
              targetEl.classList.remove('gt-hidden-turn');
              // Unhide matching model response if hidden
              const nextEl = targetEl.nextElementSibling;
              if (nextEl && (nextEl.tagName?.toLowerCase() === 'model-response' || nextEl.classList?.contains('model-response'))) {
                nextEl.classList.remove('gt-hidden-turn');
              }
            } else {
              targetEl.classList.add('gt-hidden-turn');
              // Also hide matching model response
              const nextEl = targetEl.nextElementSibling;
              if (nextEl && (nextEl.tagName?.toLowerCase() === 'model-response' || nextEl.classList?.contains('model-response'))) {
                nextEl.classList.add('gt-hidden-turn');
              }
            }
          } else {
            targetEl.classList.remove('gt-hidden-turn');
          }
        }
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

    // If already rendered with the exact same version numbers, do not re-render!
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
            <button class="gt-version-dropdown-item ${isAct ? 'active' : ''}" data-node-id="${sId}">
              <span class="gt-item-badge">#${sIdx + 1}</span>
              <span class="gt-item-text">${escapeHtml(sNode.content)}</span>
            </button>
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

    dropdown?.querySelectorAll('.gt-version-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = item.getAttribute('data-node-id');
        const targetIdx = siblings.indexOf(targetId);
        if (targetIdx !== -1) {
          switchBranch(node.parentId, targetIdx);
        }
      });
    });
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

  // --- Intercept Gemini Message Submissions ---
  function interceptSendEvents() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        handleUserSentMessage();
      }
    }, true);

    document.addEventListener('click', (e) => {
      const sendBtn = e.target.closest('button[aria-label*="Wyślij" i], button[aria-label*="Send" i], .send-button');
      if (sendBtn) {
        handleUserSentMessage();
      }

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

  function handleUserSentMessage() {
    if (!branchingFromNode) return;

    setTimeout(() => {
      branchingFromNode = null;
      renderBranchBanner();
      triggerDebouncedScan();
    }, 1200);
  }

  // --- Render Dot Tree Graph in Drawer ---
  function renderGraph() {
    const container = document.getElementById('gt-graph-content');
    if (!container) return;

    const activePathIds = new Set();
    let currId = currentTree.currentNodeId;
    while (currId && currentTree.nodes[currId]) {
      activePathIds.add(currId);
      currId = currentTree.nodes[currId].parentId;
    }

    const levels = [];
    const queue = [{ id: currentTree.rootId, depth: 0 }];
    const visited = new Set();

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const node = currentTree.nodes[id];
      if (!node) continue;

      if (node.role !== 'system') {
        if (!levels[depth]) levels[depth] = [];
        levels[depth].push(node);
      }

      const nextDepth = node.role === 'system' ? depth : depth + 1;
      (node.childrenIds || []).forEach(childId => {
        queue.push({ id: childId, depth: nextDepth });
      });
    }

    const totalUserNodes = Object.values(currentTree.nodes).filter(n => n.role === 'user').length;
    const branchesCount = Object.values(currentTree.nodes).filter(n => (n.childrenIds || []).length > 1).length;
    document.getElementById('gt-stat-nodes').textContent = totalUserNodes.toString();
    document.getElementById('gt-stat-depth').textContent = levels.filter(Boolean).length.toString();
    document.getElementById('gt-stat-branches').textContent = (branchesCount + 1).toString();

    container.innerHTML = '';
    const validLevels = levels.filter(l => l && l.length > 0);

    if (validLevels.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--gt-text-muted, #94a3b8); font-size: 13px; padding: 40px 10px;">
          Brak wiadomości w tym czacie.<br>Napisz prompt w Gemini, aby rozpocząć drzewo.
        </div>
      `;
      return;
    }

    validLevels.forEach((levelNodes, levelIdx) => {
      const levelEl = document.createElement('div');
      levelEl.className = 'gt-graph-level';

      if (levelIdx > 0) {
        const line = document.createElement('div');
        const isActiveLine = levelNodes.some(n => activePathIds.has(n.id));
        line.className = `gt-connector-line ${isActiveLine ? 'active' : ''}`;
        levelEl.appendChild(line);
      }

      const rowEl = document.createElement('div');
      rowEl.className = 'gt-branches-row';

      if (levelNodes.length > 1) {
        const forkBar = document.createElement('div');
        forkBar.className = 'gt-fork-bar';
        forkBar.style.width = `${Math.min(260, (levelNodes.length - 1) * 38)}px`;
        rowEl.appendChild(forkBar);
      }

      levelNodes.forEach((node, nodeIdx) => {
        const dotWrap = document.createElement('div');
        dotWrap.className = 'gt-node-dot-wrap';

        const isActive = activePathIds.has(node.id);
        const isFork = (node.childrenIds || []).length > 1;

        let dotClass = 'gt-node-dot';
        if (isActive) dotClass += ' active';
        else if (isFork) dotClass += ' fork';
        else dotClass += ' other';

        const snippet = node.content.slice(0, 120);

        dotWrap.innerHTML = `
          <button class="${dotClass}" title="Kliknij, aby przeskoczyć do tej gałęzi"></button>
          <div class="gt-node-tooltip">
            <div class="gt-tooltip-header">
              <span>${node.role === 'user' ? 'Użytkownik' : 'Gemini'} (#${nodeIdx + 1})</span>
              <span>Poziom ${levelIdx + 1}</span>
            </div>
            <div class="gt-tooltip-snippet">${escapeHtml(snippet)}</div>
          </div>
        `;

        dotWrap.querySelector('.gt-node-dot').onclick = () => {
          jumpToNode(node.id);
        };

        rowEl.appendChild(dotWrap);
      });

      levelEl.appendChild(rowEl);
      container.appendChild(levelEl);
    });
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

  // --- Debounced Scanner (Completely Eliminates Flickering!) ---
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
      // Ignore mutations generated by our own extension elements!
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
