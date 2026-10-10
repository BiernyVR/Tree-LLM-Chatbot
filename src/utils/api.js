export const FREE_MODELS = [
  { id: 'liquid/lfm-2.5-2.6b:free', name: 'Liquid LFM 2.5 (Szybki, darmowy)' },
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nvidia Nemotron 3.5 (Darmowy)' },
  { id: 'cohere/north-mini-code:free', name: 'Cohere North Mini (Kod, darmowy)' },
  { id: 'google/gemma-4-31b-it:free', name: 'Google Gemma 4 31B (Darmowy, wysokie obciążenie)' },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google Gemma 4 26B (Darmowy)' }
];

export const DEFAULT_MODEL = 'liquid/lfm-2.5-2.6b:free';

/**
 * Wywołanie OpenRouter API z automatycznym fallbackiem na inne darmowe modele
 * w razie błędu 429 (rate limit) lub niedostępności pojedynczego endpointu.
 */
export async function callOpenRouter(messages, apiKey, preferredModel = DEFAULT_MODEL) {
  // Lista modeli do próby: najpierw preferowany, potem reszta działających darmowych
  const modelsToTry = [
    preferredModel,
    ...FREE_MODELS.map(m => m.id).filter(id => id !== preferredModel)
  ];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:5173",
          "X-Title": "TreeChat GPT"
        },
        body: JSON.stringify({
          model: model,
          messages: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error?.message || `HTTP ${response.status}`;
        console.warn(`Model ${model} zwrócił błąd:`, errorMsg, "- próba kolejnego modelu...");
        lastError = new Error(errorMsg);
        continue; // Wypróbuj kolejny model
      }

      if (data.choices && data.choices[0]?.message?.content) {
        return {
          content: data.choices[0].message.content,
          modelUsed: model
        };
      } else {
        throw new Error("Pusta odpowiedź z modelu");
      }
    } catch (err) {
      console.warn(`Błąd wywołania ${model}:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("Nie udało się uzyskać odpowiedzi z żadnego darmowego modelu OpenRouter.");
}
