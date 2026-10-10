import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { marked } from 'marked';
import { callOpenRouter, FREE_MODELS, DEFAULT_MODEL } from './utils/api';
import { 
  Send as SendIcon, 
  Edit2 as EditIcon, 
  Loader2 as LoaderIcon, 
  ChevronLeft as ChevronLeftIcon, 
  ChevronRight as ChevronRightIcon, 
  Check as CheckIcon, 
  X as XIcon, 
  GitBranch as GitBranchIcon, 
  Plus as PlusIcon, 
  Trash2 as TrashIcon, 
  MessageSquare as MessageSquareIcon, 
  PanelLeftClose as PanelLeftCloseIcon, 
  PanelLeft as PanelLeftIcon, 
  Copy as CopyIcon, 
  Sparkles as SparklesIcon, 
  ChevronDown as ChevronDownIcon, 
  Network as NetworkIcon,
  HelpCircle as HelpCircleIcon,
  Key as KeyIcon
} from 'lucide-react';
import './App.css';

const API_KEY_STORAGE_KEY = 'treechat_openrouter_api_key';
const STORAGE_KEY = 'treechat_conversations_v4';
const ACTIVE_CHAT_KEY = 'treechat_active_chat_id_v4';

const getInitialApiKey = () => {
  return import.meta.env.VITE_OPENROUTER_API_KEY || localStorage.getItem(API_KEY_STORAGE_KEY) || '';
};

// --- Sanityzacja i deduplikacja węzłów drzewa ---
function sanitizeChat(chat) {
  if (!chat || !chat.nodes) return chat;
  const cleanedNodes = {};
  for (const [id, node] of Object.entries(chat.nodes)) {
    cleanedNodes[id] = {
      ...node,
      childrenIds: Array.from(new Set(node.childrenIds || []))
    };
  }
  return { ...chat, nodes: cleanedNodes };
}

function createNewChat() {
  const rootId = 'root-' + uuidv4();
  return {
    id: uuidv4(),
    title: 'Nowa konwersacja',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    currentNodeId: rootId,
    nodes: {
      [rootId]: {
        id: rootId,
        parentId: null,
        role: 'system',
        content: 'Jesteś pomocnym asystentem AI. Odpowiadasz zwięźle i precyzyjnie.',
        childrenIds: [],
        activeChildId: null,
        timestamp: Date.now()
      }
    }
  };
}

export default function App() {
  // --- Persistent Storage State ---
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(sanitizeChat);
        }
      }
    } catch (e) {
      console.error('Błąd wczytywania czatów z localStorage:', e);
    }
    return [createNewChat()];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    try {
      const savedId = localStorage.getItem(ACTIVE_CHAT_KEY);
      if (savedId) return savedId;
    } catch (e) {}
    return conversations[0]?.id || '';
  });

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true); // Prawy panel z grafem punktów otwarty domyślnie
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [branchingFromNode, setBranchingFromNode] = useState(null); // Węzeł użytkownika, z którego tworzymy nową odnogę
  const [copiedId, setCopiedId] = useState(null);
  const [switchedNodeId, setSwitchedNodeId] = useState(null);
  const [apiKey, setApiKey] = useState(getInitialApiKey);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const currentChat = sanitizeChat(
    conversations.find(c => c.id === activeChatId) || conversations[0] || createNewChat()
  );

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
    } catch (e) {
      console.error('Błąd zapisu do localStorage:', e);
    }
  }, [conversations, activeChatId]);

  // Scroll to bottom on updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChat?.currentNodeId, isLoading]);

  // Adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [inputValue]);

  // --- Helper to update current chat in state immutably ---
  const updateCurrentChat = (updater) => {
    setConversations(prev => prev.map(chat => {
      if (chat.id === currentChat.id) {
        const updated = updater(chat);
        return { ...sanitizeChat(updated), updatedAt: Date.now() };
      }
      return chat;
    }));
  };

  // --- Get current thread from root to currentNodeId ---
  // Zwraca WYŁĄCZNIE wiadomości w bieżącej ścieżce (żadnych promptów z innych gałęzi!)
  const getActiveThread = () => {
    if (!currentChat) return [];
    const thread = [];
    let tempId = currentChat.currentNodeId;
    while (tempId && currentChat.nodes[tempId]) {
      thread.unshift(currentChat.nodes[tempId]);
      tempId = currentChat.nodes[tempId].parentId;
    }
    return thread.filter(n => n.role !== 'system');
  };

  // --- Send Message & Tree Insertion ---
  const handleSendMessage = async (text, customParentId = null) => {
    const content = (text || inputValue).trim();
    if (!content || isLoading) return;

    if (!apiKey || !apiKey.trim()) {
      setShowApiKeyModal(true);
      return;
    }

    // WAŻNE: Rozgałęzienie z prompta użytkownika (branchingFromNode):
    // Rodzicem nowego pytania jest rodzic branchingFromNode (jego parentId)!
    // Nowe pytanie staje się równorzędną odnogą na tym samym poziomie (siblingiem).
    // Stary prompt z poprzedniej gałęzi NIE jest w ogóle w ścieżce nowej gałęzi!
    let parentId;
    if (customParentId) {
      parentId = customParentId;
    } else if (branchingFromNode) {
      parentId = branchingFromNode.parentId;
    } else {
      parentId = currentChat.currentNodeId;
    }

    const userNodeId = uuidv4();
    const assistantNodeId = uuidv4();

    // 1. Dodanie wiadomości użytkownika do drzewa
    updateCurrentChat(chat => {
      const parentNode = chat.nodes[parentId];
      const existingChildren = Array.from(new Set(parentNode?.childrenIds || []));
      const updatedChildren = existingChildren.includes(userNodeId)
        ? existingChildren
        : [...existingChildren, userNodeId];

      const newNodes = {
        ...chat.nodes,
        [userNodeId]: {
          id: userNodeId,
          parentId: parentId,
          role: 'user',
          content: content,
          childrenIds: [],
          activeChildId: null,
          timestamp: Date.now()
        }
      };

      if (parentNode) {
        newNodes[parentId] = {
          ...parentNode,
          childrenIds: updatedChildren,
          activeChildId: userNodeId
        };
      }

      let newTitle = chat.title;
      if (chat.title === 'Nowa konwersacja') {
        newTitle = content.length > 28 ? content.slice(0, 28) + '...' : content;
      }

      return {
        ...chat,
        title: newTitle,
        nodes: newNodes,
        currentNodeId: userNodeId
      };
    });

    setInputValue('');
    setBranchingFromNode(null);
    setIsLoading(true);

    try {
      // Przygotowanie historii wiadomości do API (tylko ścieżka tej gałęzi)
      const history = [];
      let temp = { id: userNodeId, parentId, role: 'user', content };
      history.unshift(temp);
      let pId = parentId;
      while (pId && currentChat.nodes[pId]) {
        history.unshift(currentChat.nodes[pId]);
        pId = currentChat.nodes[pId].parentId;
      }

      const { content: assistantResponse, modelUsed } = await callOpenRouter(history, apiKey.trim(), selectedModel);

      // 2. Dodanie odpowiedzi asystenta do drzewa
      updateCurrentChat(chat => {
        const uNode = chat.nodes[userNodeId];
        const prevAssistants = Array.from(new Set(uNode?.childrenIds || []));
        const updatedAssistants = prevAssistants.includes(assistantNodeId)
          ? prevAssistants
          : [...prevAssistants, assistantNodeId];

        const newNodes = {
          ...chat.nodes,
          [assistantNodeId]: {
            id: assistantNodeId,
            parentId: userNodeId,
            role: 'assistant',
            content: assistantResponse,
            childrenIds: [],
            activeChildId: null,
            modelUsed,
            timestamp: Date.now()
          }
        };

        if (uNode) {
          newNodes[userNodeId] = {
            ...uNode,
            childrenIds: updatedAssistants,
            activeChildId: assistantNodeId
          };
        }

        return {
          ...chat,
          nodes: newNodes,
          currentNodeId: assistantNodeId
        };
      });

    } catch (err) {
      console.error(err);
      alert(`Błąd odpowiedzi AI: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Przełączanie gałęzi na poziomie prompta (np. < 1 / 2 >) ---
  const handleSwitchBranch = (nodeId, delta) => {
    updateCurrentChat(chat => {
      const node = chat.nodes[nodeId];
      if (!node || !node.parentId) return chat;

      const parent = chat.nodes[node.parentId];
      const siblings = Array.from(new Set(parent?.childrenIds || []));
      const currentIndex = siblings.indexOf(nodeId);
      if (currentIndex === -1 || siblings.length <= 1) return chat;

      let newIndex = currentIndex + delta;
      if (newIndex < 0) newIndex = 0;
      if (newIndex >= siblings.length) newIndex = siblings.length - 1;

      const newActiveChildId = siblings[newIndex];
      if (newActiveChildId === nodeId) return chat;

      // Przejdź w dół do najgłębszego liścia tej gałęzi
      let deepestId = newActiveChildId;
      while (chat.nodes[deepestId] && chat.nodes[deepestId].activeChildId) {
        deepestId = chat.nodes[deepestId].activeChildId;
      }

      const newNodes = {
        ...chat.nodes,
        [node.parentId]: {
          ...parent,
          activeChildId: newActiveChildId
        }
      };

      setSwitchedNodeId(newActiveChildId);
      setTimeout(() => setSwitchedNodeId(null), 1200);

      return {
        ...chat,
        nodes: newNodes,
        currentNodeId: deepestId
      };
    });
  };

  // --- Przeskok bezpośrednio do konkretnego węzła/punktu w drzewie ---
  const handleJumpToNode = (nodeId) => {
    updateCurrentChat(chat => {
      const newNodes = { ...chat.nodes };

      // Ustaw ścieżkę w górę
      let curr = newNodes[nodeId];
      while (curr && curr.parentId && newNodes[curr.parentId]) {
        newNodes[curr.parentId] = {
          ...newNodes[curr.parentId],
          activeChildId: curr.id
        };
        curr = newNodes[curr.parentId];
      }

      // Idź w dół do liścia lub zatrzymaj się na wybranym
      let deepestId = nodeId;
      while (newNodes[deepestId] && newNodes[deepestId].activeChildId) {
        deepestId = newNodes[deepestId].activeChildId;
      }

      setSwitchedNodeId(nodeId);
      setTimeout(() => setSwitchedNodeId(null), 1200);

      return {
        ...chat,
        nodes: newNodes,
        currentNodeId: deepestId
      };
    });
  };

  const handleCreateNewChat = () => {
    const newChat = createNewChat();
    setConversations(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setBranchingFromNode(null);
  };

  const handleDeleteChat = (e, chatId) => {
    e.stopPropagation();
    if (conversations.length === 1) {
      const newChat = createNewChat();
      setConversations([newChat]);
      setActiveChatId(newChat.id);
      return;
    }
    const filtered = conversations.filter(c => c.id !== chatId);
    setConversations(filtered);
    if (activeChatId === chatId) {
      setActiveChatId(filtered[0].id);
    }
  };

  const activeThread = getActiveThread();

  return (
    <div className="chatgpt-layout">
      {/* --- LEWY PASEK BOCZNY (SIDEBAR) --- */}
      <aside className={`chatgpt-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={handleCreateNewChat}>
            <PlusIcon size={18} />
            <span>Nowy czat</span>
          </button>
          <button 
            className="sidebar-close-btn" 
            onClick={() => setSidebarOpen(false)}
            title="Zamknij pasek boczny"
          >
            <PanelLeftCloseIcon size={20} />
          </button>
        </div>

        <div className="sidebar-history-section">
          <div className="history-label">Twoje konwersacje</div>
          <div className="history-list">
            {conversations.map(chat => (
              <div 
                key={chat.id} 
                className={`history-item ${chat.id === currentChat?.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveChatId(chat.id);
                  setBranchingFromNode(null);
                }}
              >
                <MessageSquareIcon size={16} className="history-icon" />
                <span className="history-title" title={chat.title}>{chat.title}</span>
                <button 
                  className="history-delete-btn" 
                  onClick={(e) => handleDeleteChat(e, chat.id)}
                  title="Usuń czat"
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">J</div>
            <div className="user-info">
              <span className="user-name">Użytkownik</span>
              <span className="user-plan">TreeChat GPT</span>
            </div>
          </div>
        </div>
      </aside>

      {/* --- GŁÓWNY OBSZAR ROZMOWY --- */}
      <main className="chatgpt-main">
        {/* Górny pasek nawigacyjny (Header) */}
        <header className="chatgpt-topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button 
                className="topbar-icon-btn" 
                onClick={() => setSidebarOpen(true)}
                title="Otwórz pasek boczny"
              >
                <PanelLeftIcon size={20} />
              </button>
            )}
            
            {/* Wybór modelu */}
            <div className="model-selector-wrapper">
              <select 
                value={selectedModel} 
                onChange={(e) => setSelectedModel(e.target.value)}
                className="model-select"
              >
                {FREE_MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <ChevronDownIcon size={14} className="model-select-chevron" />
            </div>
          </div>

          <div className="topbar-right">
            <button 
              className={`api-key-btn ${apiKey ? 'has-key' : 'missing-key'}`}
              onClick={() => {
                setApiKeyInput(apiKey);
                setShowApiKeyModal(true);
              }}
              title={apiKey ? "Klucz API OpenRouter jest skonfigurowany" : "Wprowadź klucz API OpenRouter"}
            >
              <KeyIcon size={15} />
              <span>{apiKey ? 'Klucz API' : 'Wprowadź Klucz API'}</span>
            </button>

            {/* Przycisk prawego panelu z grafem punktów */}
            <button 
              className={`tree-map-btn ${rightPanelOpen ? 'active' : ''}`}
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              title="Włącz/wyłącz podgląd grafu rozgałęzień"
            >
              <NetworkIcon size={16} />
              <span>Drzewo Gałęzi</span>
            </button>
          </div>
        </header>

        {/* Zawartość czatu */}
        <div className="chat-messages-scroll">
          {activeThread.length === 0 ? (
            <div className="chatgpt-empty-state">
              <div className="empty-sparkle-logo">
                <SparklesIcon size={40} />
              </div>
              <h2>W czym mogę Ci dzisiaj pomóc?</h2>
              <p className="empty-subtitle">
                Zadaj pytanie. Na każdym promptcie możesz kliknąć <strong>Rozgałęź</strong>, aby stworzyć nową odnogę i schodzić coraz niżej w drzewie.
              </p>

              <div className="empty-suggestions-grid">
                <button 
                  className="suggestion-card" 
                  onClick={() => handleSendMessage("Napisz krótkie opowiadanie science-fiction o sztucznej inteligencji.")}
                >
                  <span className="card-title">Opowiadanie sci-fi</span>
                  <span className="card-desc">Wygeneruj historię z możliwością rozgałęzienia fabuły</span>
                </button>
                <button 
                  className="suggestion-card" 
                  onClick={() => handleSendMessage("Jak działa kwantowe splątanie w fizyce?")}
                >
                  <span className="card-title">Fizyka kwantowa</span>
                  <span className="card-desc">Proste wyjaśnienie zjawiska splątania</span>
                </button>
                <button 
                  className="suggestion-card" 
                  onClick={() => handleSendMessage("Napisz w JavaScript prosty algorytm sortowania bąbelkowego.")}
                >
                  <span className="card-title">Kod w JavaScript</span>
                  <span className="card-desc">Przykładowy algorytm sortowania z kodem</span>
                </button>
                <button 
                  className="suggestion-card" 
                  onClick={() => handleSendMessage("Wymyśl 3 nazwy dla startupu technologicznego.")}
                >
                  <span className="card-title">Burza mózgów</span>
                  <span className="card-desc">Kreatywne pomysły na nazwę firmy</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="chat-messages-container">
              {activeThread.map(node => (
                <ChatMessageItem 
                  key={node.id}
                  node={node}
                  nodes={currentChat.nodes}
                  isHighlighted={node.id === switchedNodeId}
                  onSwitchBranch={handleSwitchBranch}
                  onBranchOff={(targetUserNode) => {
                    setBranchingFromNode(targetUserNode);
                    if (textareaRef.current) textareaRef.current.focus();
                  }}
                  onEditSubmit={(newContent) => handleSendMessage(newContent, node.parentId)}
                  onCopy={(text, id) => {
                    navigator.clipboard.writeText(text);
                    setCopiedId(id);
                    setTimeout(() => setCopiedId(null), 2000);
                  }}
                  copiedId={copiedId}
                />
              ))}

              {isLoading && (
                <div className="chat-row assistant">
                  <div className="avatar-col">
                    <div className="avatar assistant-avatar">
                      <SparklesIcon size={18} />
                    </div>
                  </div>
                  <div className="content-col">
                    <div className="sender-name">TreeChat AI</div>
                    <div className="bubble-loading">
                      <LoaderIcon className="spinner" size={18} />
                      <span>Generowanie odpowiedzi...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Dolny pasek wprowadzania wiadomości */}
        <footer className="chatgpt-footer">
          {/* Wyraźna karta informacyjna aktywnego rozgałęziania (Branch Card) */}
          {branchingFromNode && (
            <div className="branching-indicator-card">
              <div className="branch-card-header">
                <div className="branch-card-title">
                  <GitBranchIcon size={16} className="branch-icon-accent" />
                  <span>
                    Tworzenie nowej gałęzi (alternatywne pytanie na tym poziomie)
                  </span>
                </div>
                <button 
                  className="cancel-branch-btn" 
                  onClick={() => setBranchingFromNode(null)}
                  title="Anuluj i wróć do bieżącej gałęzi"
                >
                  <XIcon size={14} /> Anuluj
                </button>
              </div>
              <div className="branch-origin-snippet">
                Rozgałęziasz z pytania: "{branchingFromNode.content.slice(0, 50)}{branchingFromNode.content.length > 50 ? '...' : ''}". Wpisz nowe pytanie poniżej.
              </div>
            </div>
          )}

          <div className="chatgpt-input-box">
            <textarea 
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={branchingFromNode ? "Wpisz alternatywne pytanie tworzące nową odnogę..." : "Napisz wiadomość do TreeChat..."}
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />
            <button 
              className={`send-action-btn ${inputValue.trim() && !isLoading ? 'active' : ''}`}
              onClick={() => handleSendMessage()}
              disabled={!inputValue.trim() || isLoading}
              title="Wyślij wiadomość"
            >
              <SendIcon size={16} />
            </button>
          </div>
          <div className="footer-disclaimer">
            TreeChat: Drzewiasta struktura konwersacji z rozgałęzianiem w głąb.
          </div>
        </footer>
      </main>

      {/* --- PRAWY PANEL: WIZUALIZACJA Z PUNKTAMI SCHODZĄCYMI W DÓŁ (BEZ TEKSTU PROMPTÓW) --- */}
      {rightPanelOpen && (
        <aside className="chatgpt-right-panel">
          <div className="right-panel-header">
            <div className="panel-title-wrap">
              <NetworkIcon size={18} className="panel-icon-accent" />
              <h3>Wizualizacja Drzewa</h3>
            </div>
            <button 
              className="panel-close-btn"
              onClick={() => setRightPanelOpen(false)}
              title="Schowaj panel"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div className="right-panel-body">
            <div className="dot-tree-intro">
              <span className="dot-tree-hint">
                Punkty oznaczają kolejne kroki w dół. Kliknij dowolny punkt, aby przeskoczyć do tej gałęzi.
              </span>
              <div className="dot-tree-legend">
                <span className="legend-item"><span className="dot-sample active" /> Aktywna ścieżka</span>
                <span className="legend-item"><span className="dot-sample other" /> Inne gałęzie</span>
                <span className="legend-item"><span className="dot-sample fork" /> Rozwidlenie</span>
              </div>
            </div>

            {/* Czysty graf punktów z rozgałęzieniami schodzącymi w dół */}
            <DotTreeGraph 
              chat={currentChat}
              onJumpToNode={handleJumpToNode}
              onBranchOff={(userNode) => {
                setBranchingFromNode(userNode);
                if (textareaRef.current) textareaRef.current.focus();
              }}
            />
          </div>
        </aside>
      )}

      {/* Modal konfiguracji klucza API */}
      {showApiKeyModal && (
        <div className="api-key-modal-backdrop" onClick={() => setShowApiKeyModal(false)}>
          <div className="api-key-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <KeyIcon size={18} className="modal-icon" />
                <h3>Klucz API OpenRouter</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setShowApiKeyModal(false)} title="Zamknij">
                <XIcon size={18} />
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Podaj swój klucz OpenRouter API (<code>sk-or-v1-...</code>). Klucz zapisywany jest lokalnie w Twojej przeglądarce (LocalStorage) i używany wyłącznie do komunikacji z API modeli.
              </p>
              <div className="api-key-input-wrapper">
                <input
                  type="password"
                  className="api-key-input"
                  placeholder="sk-or-v1-..."
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const trimmed = apiKeyInput.trim();
                      if (trimmed) {
                        localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
                        setApiKey(trimmed);
                      } else {
                        localStorage.removeItem(API_KEY_STORAGE_KEY);
                        setApiKey('');
                      }
                      setShowApiKeyModal(false);
                    }
                  }}
                  autoFocus
                />
              </div>
              <p className="modal-hint">
                Możesz również zdefiniować zmienną w pliku <code>.env</code>: <code>VITE_OPENROUTER_API_KEY=twoj_klucz</code>.
              </p>
            </div>
            <div className="modal-actions">
              {apiKey ? (
                <button 
                  className="btn-remove-key" 
                  onClick={() => {
                    localStorage.removeItem(API_KEY_STORAGE_KEY);
                    setApiKey('');
                    setApiKeyInput('');
                    setShowApiKeyModal(false);
                  }}
                >
                  Usuń klucz
                </button>
              ) : <div />}
              <div className="modal-actions-right">
                <button className="btn-modal-cancel" onClick={() => setShowApiKeyModal(false)}>
                  Anuluj
                </button>
                <button 
                  className="btn-modal-save" 
                  onClick={() => {
                    const trimmed = apiKeyInput.trim();
                    if (trimmed) {
                      localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
                      setApiKey(trimmed);
                    } else {
                      localStorage.removeItem(API_KEY_STORAGE_KEY);
                      setApiKey('');
                    }
                    setShowApiKeyModal(false);
                  }}
                >
                  Zapisz
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Komponent selektora gałęzi na prompcie użytkownika ---
function BranchSelector({ node, parent, nodes, onSwitchBranch }) {
  const [isOpen, setIsOpen] = useState(false);
  const siblings = Array.from(new Set(parent?.childrenIds || []));
  const currentIndex = siblings.indexOf(node.id);
  const hasSiblings = siblings.length > 1;

  if (!hasSiblings) return null;

  return (
    <div className="branch-selector-wrapper">
      <div className="branch-selector-pill">
        <button 
          className="branch-step-btn"
          disabled={currentIndex <= 0}
          onClick={() => onSwitchBranch(node.id, -1)}
          title={currentIndex > 0 ? `Poprzednia wersja (#${currentIndex})` : "To jest pierwsza wersja"}
        >
          <ChevronLeftIcon size={14} />
        </button>

        <button 
          className="branch-dropdown-toggle"
          onClick={() => setIsOpen(!isOpen)}
          title="Kliknij, aby rozwinąć listę wersji tego prompta"
        >
          <GitBranchIcon size={12} className="branch-pill-icon" />
          <span>Wersja {currentIndex + 1} z {siblings.length}</span>
          <ChevronDownIcon size={12} className={`branch-dropdown-arrow ${isOpen ? 'open' : ''}`} />
        </button>

        <button 
          className="branch-step-btn"
          disabled={currentIndex >= siblings.length - 1}
          onClick={() => onSwitchBranch(node.id, 1)}
          title={currentIndex < siblings.length - 1 ? `Następna wersja (#${currentIndex + 2})` : "To jest ostatnia wersja"}
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>

      {isOpen && (
        <>
          <div className="branch-menu-backdrop" onClick={() => setIsOpen(false)} />
          <div className="branch-menu-dropdown">
            <div className="branch-menu-header">
              <span>Wersje tego prompta:</span>
              <span className="branch-menu-count">{siblings.length} wersje</span>
            </div>
            <div className="branch-menu-items">
              {siblings.map((sibId, idx) => {
                const sib = nodes[sibId];
                if (!sib) return null;
                const isCurrent = sibId === node.id;

                let childCount = 0;
                const countDesc = (id) => {
                  const n = nodes[id];
                  if (!n) return;
                  if (n.role !== 'system') childCount++;
                  (n.childrenIds || []).forEach(countDesc);
                };
                (sib.childrenIds || []).forEach(countDesc);

                return (
                  <div 
                    key={sibId}
                    className={`branch-menu-item ${isCurrent ? 'active' : ''}`}
                    onClick={() => {
                      onSwitchBranch(node.id, idx - currentIndex);
                      setIsOpen(false);
                    }}
                  >
                    <div className="item-badge">#{idx + 1}</div>
                    <div className="item-details">
                      <div className="item-text">
                        {sib.content.slice(0, 75)}{sib.content.length > 75 ? '...' : ''}
                      </div>
                      <div className="item-sub">
                        {childCount > 0 ? `+${childCount} kolejnych kroków` : 'Jeden krok'}
                      </div>
                    </div>
                    {isCurrent ? (
                      <span className="item-current-tag">Aktywna</span>
                    ) : (
                      <span className="item-switch-tag">Przełącz</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- Komponent pojedynczej wiadomości (ChatMessageItem) ---
function ChatMessageItem({ 
  node, 
  nodes, 
  isHighlighted,
  onSwitchBranch, 
  onBranchOff, 
  onEditSubmit, 
  onCopy, 
  copiedId 
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(node.content);

  const parent = nodes[node.parentId];

  const formattedHtml = React.useMemo(() => {
    try {
      return marked.parse(node.content || '');
    } catch (e) {
      return node.content;
    }
  }, [node.content]);

  return (
    <div className={`chat-row ${node.role} ${isHighlighted ? 'row-highlighted' : ''}`}>
      <div className="avatar-col">
        {node.role === 'user' ? (
          <div className="avatar user-avatar">J</div>
        ) : (
          <div className="avatar assistant-avatar">
            <SparklesIcon size={18} />
          </div>
        )}
      </div>

      <div className="content-col">
        <div className="message-header">
          <span className="sender-name">
            {node.role === 'user' ? 'Ty' : 'TreeChat AI'}
          </span>
          {node.modelUsed && (
            <span className="model-badge">{node.modelUsed.split(':')[0]}</span>
          )}
        </div>

        {isEditing ? (
          <div className="inline-edit-box">
            <textarea 
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={Math.max(3, editContent.split('\n').length)}
              autoFocus
            />
            <div className="inline-edit-actions">
              <button className="btn-cancel" onClick={() => setIsEditing(false)}>
                <XIcon size={14} /> Anuluj
              </button>
              <button 
                className="btn-submit" 
                onClick={() => {
                  setIsEditing(false);
                  if (editContent.trim() && editContent !== node.content) {
                    onEditSubmit(editContent);
                  }
                }}
              >
                <CheckIcon size={14} /> Zapisz i rozgałęź
              </button>
            </div>
          </div>
        ) : (
          <div 
            className="message-body" 
            dangerouslySetInnerHTML={{ __html: formattedHtml }} 
          />
        )}

        {/* Pasek narzędzi */}
        <div className="message-toolbar">
          {/* Selektor gałęzi (Tylko dla promptów użytkownika) */}
          {node.role === 'user' && (
            <BranchSelector 
              node={node}
              parent={parent}
              nodes={nodes}
              onSwitchBranch={onSwitchBranch}
            />
          )}

          {/* WAŻNE (Feedback 1): Rozgałęzienie TYLKO na promptach użytkownika */}
          {node.role === 'user' && (
            <button 
              className="action-btn branch-highlight-btn" 
              onClick={() => onBranchOff(node)}
              title="Utwórz nową gałąź z alternatywnym pytaniem"
            >
              <GitBranchIcon size={14} />
              <span>Rozgałęź</span>
            </button>
          )}

          {/* Edycja (tylko użytkownik) */}
          {node.role === 'user' && !isEditing && (
            <button 
              className="action-btn" 
              onClick={() => {
                setEditContent(node.content);
                setIsEditing(true);
              }}
              title="Edytuj prompt i utwórz alternatywną gałąź"
            >
              <EditIcon size={14} />
              <span>Edytuj</span>
            </button>
          )}

          {/* Kopiowanie treści */}
          <button 
            className="action-btn" 
            onClick={() => onCopy(node.content, node.id)}
            title="Kopiuj treść"
          >
            {copiedId === node.id ? <CheckIcon size={14} className="text-green" /> : <CopyIcon size={14} />}
            <span>{copiedId === node.id ? 'Skopiowano!' : 'Kopiuj'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// --- WIZUALIZACJA Z PUNKTAMI SCHODZĄCYMI W DÓŁ (DOT TREE GRAPH) ---
// Bez widocznych promptów, tylko estetyczne punkty i rozgałęziające się linie
function DotTreeGraph({ chat, onJumpToNode, onBranchOff }) {
  const [hoveredNode, setHoveredNode] = useState(null);
  const containerRef = useRef(null);

  const nodes = chat.nodes;
  const rootNode = Object.values(nodes).find(n => n.role === 'system');

  // Aktywna ścieżka (od bieżącego węzła do roota)
  const activePathIds = new Set();
  let curr = nodes[chat.currentNodeId];
  while (curr) {
    activePathIds.add(curr.id);
    curr = nodes[curr.parentId];
  }

  // 1. Budujemy drzewo tur (kroków)
  function buildTurn(userNode, depth = 1) {
    if (!userNode) return null;
    const assistantIds = userNode.childrenIds || [];
    const assistantNode = assistantIds.length > 0 ? nodes[assistantIds[0]] : null;

    let nextUserIds = [];
    if (assistantNode && assistantNode.childrenIds) {
      nextUserIds = Array.from(new Set(assistantNode.childrenIds));
    }

    const childrenTurns = nextUserIds
      .map(uId => buildTurn(nodes[uId], depth + 1))
      .filter(Boolean);

    const isActive = activePathIds.has(userNode.id);
    const isCurrent = userNode.id === chat.currentNodeId || (assistantNode && assistantNode.id === chat.currentNodeId);
    const isFork = childrenTurns.length > 1;

    return {
      id: userNode.id,
      userNode,
      assistantNode,
      depth,
      isActive,
      isCurrent,
      isFork,
      children: childrenTurns
    };
  }

  const rootChildren = Array.from(new Set(rootNode?.childrenIds || []));
  const turnRoots = rootChildren.map(uId => buildTurn(nodes[uId], 1)).filter(Boolean);

  if (turnRoots.length === 0) {
    return (
      <div className="dot-tree-empty">
        <SparklesIcon size={24} className="empty-sparkle" />
        <span>Rozpocznij rozmowę, aby zobaczyć punkty rozgałęzień.</span>
      </div>
    );
  }

  // 2. Obliczamy szerokości poddrzew (liczba liści w poddrzewie)
  function calculateWidths(turn) {
    if (!turn.children || turn.children.length === 0) {
      turn.width = 1;
      return 1;
    }
    let sum = 0;
    for (const child of turn.children) {
      sum += calculateWidths(child);
    }
    turn.width = Math.max(1, sum);
    return turn.width;
  }

  let totalCols = 0;
  for (const root of turnRoots) {
    totalCols += calculateWidths(root);
  }

  // 3. Przypisujemy współrzędne (x, y) schodzące w dół
  const ROW_HEIGHT = 65;
  const COL_WIDTH = 55;
  const PADDING_X = 40;
  const PADDING_Y = 30;

  const allRenderNodes = [];
  const allRenderEdges = [];
  let maxDepth = 1;

  function assignPositions(turn, colOffset) {
    const centerCol = colOffset + turn.width / 2;
    turn.x = centerCol * COL_WIDTH + PADDING_X;
    turn.y = (turn.depth - 1) * ROW_HEIGHT + PADDING_Y;

    if (turn.depth > maxDepth) maxDepth = turn.depth;

    allRenderNodes.push(turn);

    let currentOffset = colOffset;
    for (const child of turn.children) {
      assignPositions(child, currentOffset);
      
      // Krawędź od rodzica do dziecka
      allRenderEdges.push({
        id: `${turn.id}->${child.id}`,
        from: { x: turn.x, y: turn.y },
        to: { x: child.x, y: child.y },
        isActive: turn.isActive && child.isActive
      });

      currentOffset += child.width;
    }
  }

  let offset = 0;
  for (const root of turnRoots) {
    assignPositions(root, offset);
    offset += root.width;
  }

  const svgWidth = Math.max(300, (totalCols + 1) * COL_WIDTH + PADDING_X * 2);
  const svgHeight = maxDepth * ROW_HEIGHT + PADDING_Y * 2;

  return (
    <div className="dot-tree-scroll-container" ref={containerRef}>
      <div className="dot-tree-stage" style={{ width: svgWidth, height: svgHeight }}>
        {/* Poziome linie poziomów w tle */}
        <div className="depth-grid-lines">
          {Array.from({ length: maxDepth }).map((_, i) => (
            <div 
              key={i} 
              className="depth-grid-line" 
              style={{ top: i * ROW_HEIGHT + PADDING_Y }}
            >
              <span className="depth-indicator">Poziom {i + 1}</span>
            </div>
          ))}
        </div>

        {/* Linie SVG łączące punkty rozgałęzień */}
        <svg className="dot-tree-svg" width={svgWidth} height={svgHeight}>
          <defs>
            <filter id="active-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="glow" />
              <feComposite in="SourceGraphic" in2="glow" operator="over" />
            </filter>
          </defs>

          {allRenderEdges.map(edge => {
            // Płynna krzywa Beziera w dół
            const d = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x} ${(edge.from.y + edge.to.y) / 2}, ${edge.to.x} ${(edge.from.y + edge.to.y) / 2}, ${edge.to.x} ${edge.to.y}`;
            return (
              <path 
                key={edge.id}
                d={d}
                className={`dot-tree-path ${edge.isActive ? 'active-path' : 'inactive-path'}`}
                filter={edge.isActive ? "url(#active-glow)" : undefined}
              />
            );
          })}
        </svg>

        {/* Punkty (Kropki/Węzły) w grafie */}
        {allRenderNodes.map(node => (
          <div
            key={node.id}
            className={`tree-point-dot ${node.isActive ? 'is-active' : 'is-inactive'} ${node.isCurrent ? 'is-current' : ''} ${node.isFork ? 'is-fork' : ''}`}
            style={{ left: node.x, top: node.y }}
            onClick={() => onJumpToNode(node.userNode.id)}
            onMouseEnter={() => setHoveredNode(node)}
            onMouseLeave={() => setHoveredNode(null)}
          >
            <span className="dot-inner-number">{node.depth}</span>
            {node.isCurrent && <span className="dot-pulse-ring" />}
          </div>
        ))}

        {/* Tooltip ze zwięzłą informacją po najechaniu na punkt */}
        {hoveredNode && (
          <div 
            className="dot-hover-tooltip"
            style={{ 
              left: Math.min(hoveredNode.x + 15, svgWidth - 220), 
              top: Math.max(10, hoveredNode.y - 45) 
            }}
          >
            <div className="tooltip-header">
              <span className="tooltip-depth">Poziom {hoveredNode.depth}</span>
              {hoveredNode.isActive ? (
                <span className="tooltip-status active">Bieżąca ścieżka</span>
              ) : (
                <span className="tooltip-status">Alternatywna</span>
              )}
            </div>
            <div className="tooltip-snippet">
              "{hoveredNode.userNode.content.slice(0, 60)}{hoveredNode.userNode.content.length > 60 ? '...' : ''}"
            </div>
            <div className="tooltip-actions">
              <button 
                className="tooltip-jump-btn"
                onClick={() => onJumpToNode(hoveredNode.userNode.id)}
              >
                Przejdź tutaj
              </button>
              <button 
                className="tooltip-branch-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onBranchOff(hoveredNode.userNode);
                }}
              >
                <GitBranchIcon size={12} /> Rozgałęź
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
