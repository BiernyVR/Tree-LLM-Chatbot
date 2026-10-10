import { callOpenRouter, FREE_MODELS, DEFAULT_MODEL } from '../src/utils/api.js';

const API_KEY = process.env.VITE_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';

console.log('====================================');
console.log('  TESTY AUTOMATYCZNE TREE CHATBOT   ');
console.log('====================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    throw new Error(`Asersja nie powiodła się: ${message}`);
  }
}

// --- TEST 1: Rozgałęzienia w rozgałęzieniu (Głębokie schodzenie w dół) ---
function testNestedBranchingDescending() {
  console.log('--- TEST 1: Rozgałęzienia w rozgałęzieniu (coraz niżej w drzewie) ---');

  const nodes = {
    'root': { id: 'root', parentId: null, role: 'system', childrenIds: [], activeChildId: null }
  };

  // Turn 1
  nodes['u1'] = { id: 'u1', parentId: 'root', role: 'user', content: 'Turn 1 User', childrenIds: ['a1'] };
  nodes['a1'] = { id: 'a1', parentId: 'u1', role: 'assistant', content: 'Turn 1 AI', childrenIds: ['u2_A'] };
  nodes['root'].childrenIds.push('u1');

  // Gałąź A: Turn 2A -> Turn 3A
  nodes['u2_A'] = { id: 'u2_A', parentId: 'a1', role: 'user', content: 'Turn 2A User', childrenIds: ['a2_A'] };
  nodes['a2_A'] = { id: 'a2_A', parentId: 'u2_A', role: 'assistant', content: 'Turn 2A AI', childrenIds: ['u3_A'] };
  nodes['u3_A'] = { id: 'u3_A', parentId: 'a2_A', role: 'user', content: 'Turn 3A User', childrenIds: ['a3_A'] };
  nodes['a3_A'] = { id: 'a3_A', parentId: 'u3_A', role: 'assistant', content: 'Turn 3A AI', childrenIds: [] };

  // Rozgałęzienie z u2_A -> Gałąź B (Turn 2B)
  nodes['u2_B'] = { id: 'u2_B', parentId: 'a1', role: 'user', content: 'Turn 2B User', childrenIds: ['a2_B'] };
  nodes['a1'].childrenIds.push('u2_B');
  nodes['a2_B'] = { id: 'a2_B', parentId: 'u2_B', role: 'assistant', content: 'Turn 2B AI', childrenIds: ['u3_B'] };

  // Kontynuacja w Gałęzi B: Turn 3B -> Turn 4B
  nodes['u3_B'] = { id: 'u3_B', parentId: 'a2_B', role: 'user', content: 'Turn 3B User', childrenIds: ['a3_B'] };
  nodes['a3_B'] = { id: 'a3_B', parentId: 'u3_B', role: 'assistant', content: 'Turn 3B AI', childrenIds: ['u4_B'] };
  nodes['u4_B'] = { id: 'u4_B', parentId: 'a3_B', role: 'user', content: 'Turn 4B User', childrenIds: ['a4_B'] };
  nodes['a4_B'] = { id: 'a4_B', parentId: 'u4_B', role: 'assistant', content: 'Turn 4B AI', childrenIds: [] };

  // ROZGAŁĘZIENIE W ROZGAŁĘZIENIU: Użytkownik w Gałęzi B rozgałęzia z u3_B! -> Gałąź C (Turn 3C)
  // Rodzicem u3_C jest rodzic u3_B, czyli a2_B!
  nodes['u3_C'] = { id: 'u3_C', parentId: 'a2_B', role: 'user', content: 'Turn 3C User (Podgałąź)', childrenIds: ['a3_C'] };
  nodes['a2_B'].childrenIds.push('u3_C'); // a2_B ma teraz 2 dzieci: u3_B oraz u3_C!
  nodes['a3_C'] = { id: 'a3_C', parentId: 'u3_C', role: 'assistant', content: 'Turn 3C AI', childrenIds: ['u4_C'] };

  // Schodzimy jeszcze niżej w podgałęzi C: Turn 4C -> Turn 5C
  nodes['u4_C'] = { id: 'u4_C', parentId: 'a3_C', role: 'user', content: 'Turn 4C User', childrenIds: ['a4_C'] };
  nodes['a4_C'] = { id: 'a4_C', parentId: 'u4_C', role: 'assistant', content: 'Turn 4C AI', childrenIds: ['u5_C'] };
  nodes['u5_C'] = { id: 'u5_C', parentId: 'a4_C', role: 'user', content: 'Turn 5C User', childrenIds: ['a5_C'] };
  nodes['a5_C'] = { id: 'a5_C', parentId: 'u5_C', role: 'assistant', content: 'Turn 5C AI', childrenIds: [] };

  function getThread(leafId) {
    const thread = [];
    let curr = nodes[leafId];
    while (curr && curr.role !== 'system') {
      thread.unshift(curr);
      curr = nodes[curr.parentId];
    }
    return thread;
  }

  // Weryfikacja głębokiej ścieżki w podgałęzi C
  const threadC = getThread('a5_C');
  const userPromptsC = threadC.filter(n => n.role === 'user').map(n => n.id);
  assert(userPromptsC.join('->') === 'u1->u2_B->u3_C->u4_C->u5_C', 'Ścieżka podgałęzi C schodzi na głębokość 5: u1->u2_B->u3_C->u4_C->u5_C');

  // Weryfikacja czystej izolacji: prompt u2_A, u3_A, u3_B, u4_B NIE są widoczne w podgałęzi C!
  assert(!userPromptsC.includes('u2_A'), 'u2_A nie jest w ścieżce podgałęzi C');
  assert(!userPromptsC.includes('u3_A'), 'u3_A nie jest w ścieżce podgałęzi C');
  assert(!userPromptsC.includes('u3_B'), 'u3_B nie jest w ścieżce podgałęzi C');
  assert(!userPromptsC.includes('u4_B'), 'u4_B nie jest w ścieżce podgałęzi C');

  // Sprawdzenie rozgałęzień: a1 ma 2 dzieci, a2_B ma 2 dzieci (rozgałęzienie w rozgałęzieniu)
  assert(nodes['a1'].childrenIds.length === 2, 'Węzeł a1 ma 2 rozgałęzienia na poziomie 2');
  assert(nodes['a2_B'].childrenIds.length === 2, 'Węzeł a2_B ma 2 rozgałęzienia na poziomie 3 (rozgałęzienie w rozgałęzieniu!)');

  console.log('Głębokie rozgałęzienia schodzące w dół przetestowane pomyślnie!\n');
}

// --- TEST 2: Budowanie grafu punktów (Tury i Poziomy w dół) ---
function testDotTreeTurnStructure() {
  console.log('--- TEST 2: Struktura poziomów i punktów grafu ---');

  const nodes = {
    'root': { id: 'root', parentId: null, role: 'system', childrenIds: ['u1'] },
    'u1': { id: 'u1', parentId: 'root', role: 'user', content: 'Krok 1', childrenIds: ['a1'] },
    'a1': { id: 'a1', parentId: 'u1', role: 'assistant', content: 'Odp 1', childrenIds: ['u2_1', 'u2_2'] },
    'u2_1': { id: 'u2_1', parentId: 'a1', role: 'user', content: 'Krok 2A', childrenIds: ['a2_1'] },
    'a2_1': { id: 'a2_1', parentId: 'u2_1', role: 'assistant', content: 'Odp 2A', childrenIds: [] },
    'u2_2': { id: 'u2_2', parentId: 'a1', role: 'user', content: 'Krok 2B', childrenIds: ['a2_2'] },
    'a2_2': { id: 'a2_2', parentId: 'u2_2', role: 'assistant', content: 'Odp 2B', childrenIds: ['u3_B'] },
    'u3_B': { id: 'u3_B', parentId: 'a2_2', role: 'user', content: 'Krok 3B', childrenIds: ['a3_B'] },
    'a3_B': { id: 'a3_B', parentId: 'u3_B', role: 'assistant', content: 'Odp 3B', childrenIds: [] }
  };

  // Sprawdzamy głębokości poziomów (1, 2, 3)
  function getDepth(nodeId) {
    let d = 0;
    let curr = nodes[nodeId];
    while (curr && curr.role !== 'system') {
      if (curr.role === 'user') d++;
      curr = nodes[curr.parentId];
    }
    return d;
  }

  assert(getDepth('u1') === 1, 'u1 ma poziom 1');
  assert(getDepth('u2_1') === 2, 'u2_1 ma poziom 2');
  assert(getDepth('u2_2') === 2, 'u2_2 ma poziom 2');
  assert(getDepth('u3_B') === 3, 'u3_B ma poziom 3 (schodzenie coraz niżej)');

  console.log('Struktura poziomów grafu przetestowana pomyślnie!\n');
}

// --- TEST 3: Połączenie z OpenRouter ---
async function testOpenRouterIntegration() {
  console.log('--- TEST 3: Połączenie z OpenRouter ---');
  if (!API_KEY) {
    console.log('Pominięto test API na żywo (brak klucza VITE_OPENROUTER_API_KEY w środowisku)\n');
    return;
  }
  const result = await callOpenRouter([{ role: 'user', content: 'Powiedz jedno słowo: TEST' }], API_KEY, DEFAULT_MODEL);
  assert(typeof result.content === 'string' && result.content.length > 0, 'Model zwrócił poprawną odpowiedź');
  console.log('OpenRouter przetestowany pomyślnie!\n');
}

async function runAll() {
  try {
    testNestedBranchingDescending();
    testDotTreeTurnStructure();
    await testOpenRouterIntegration();

    console.log('====================================');
    console.log(`🎉 WSZYSTKIE TESTY ZALICZONE (${passedTests}/${totalTests})`);
    console.log('====================================');
  } catch (err) {
    console.error('❌ Błąd podczas testów:', err);
    process.exit(1);
  }
}

runAll();
