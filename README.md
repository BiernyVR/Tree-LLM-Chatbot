# 🌳 Tree LLM Chatbot

Nowoczesny interfejs czatu AI w stylu ChatGPT z unikalną możliwością **nieliniowego rozgałęziania rozmów w strukturę drzewiastą (Tree-structured conversations)**. Pozwala na tworzenie wielu alternatywnych ścieżek pytań i odpowiedzi na dowolnym poziomie konwersacji, schodzenie coraz głębiej w wybrane odnogi oraz błyskawiczne przełączanie się między nimi.

---

## ✨ Kluczowe funkcjonalności

- **🌳 Nieliniowe drzewo konwersacji:**
  - Rozgałęzianie na dowolnym promptcie użytkownika – kliknij przycisk **Rozgałęź**, aby utworzyć alternatywną wersję pytania.
  - Rozgałęzienia w rozgałęzieniach – możliwość schodzenia coraz niżej w głąb struktury drzewiastej bez limitu poziomów.
  - Izolacja gałęzi – zmiana gałęzi natychmiast filtruje widok, pokazując wyłącznie właściwą ścieżkę dla wybranej odnogi.
- **🧭 Selektor wersji pytania:**
  - Wygodne przełączanie wersji danego prompta (np. *„Wersja 1 z 3”*) ze strzałkami oraz menu rozwijanym.
- **📊 Wizualizacja Drzewa Gałęzi (Dot Tree Visualizer):**
  - Minimalistyczny boczny panel grafu punktów reprezentujący całą topologię rozmowy.
  - Kodowanie kolorystyczne: zielony (aktywna ścieżka), fioletowy (inne odnogi), pomarańczowy (punkty rozwidlenia).
  - Kliknięcie w dowolny punkt natychmiast przenosi widok czatu do tej konkretnej gałęzi.
- **💬 Interfejs inspirowany ChatGPT:**
  - Ciemny motyw Dark Mode.
  - Boczny panel z listą historii konwersacji i tworzeniem nowego czatu.
  - Renderowanie formatowania Markdown, bloków kodu i list.
  - Kopiowanie odpowiedzi do schowka jednym kliknięciem.
  - Zapamiętywanie historii i stanu w `localStorage`.
- **⚡ Integracja z OpenRouter API:**
  - Obsługa darmowych i płatnych modeli AI (m.in. *Liquid LFM 2.5*, *Nvidia Nemotron 3.5*, *Cohere North Mini*, *Google Gemma*).
  - Automatyczny fallback – w przypadku limitu zapytań (429) lub niedostępności modelu zapytanie automatycznie próbuje kolejny dostępny model.
- **🔒 Bezpieczeństwo i brak hardkodowanych kluczy:**
  - Klucz API można skonfigurować w pliku `.env` lub bezpośrednio w interfejsie aplikacji (przycisk w prawym górnym rogu).
  - Klucz wprowadzony w UI jest zapisywany lokalnie w Twojej przeglądarce (`localStorage`) i nigdy nie trafia do repozytorium git.

---

## 🚀 Uruchomienie projektu

### 1. Klonowanie repozytorium
```bash
git clone https://github.com/BiernyVR/Tree-LLM-Chatbot.git
cd Tree-LLM-Chatbot
```

### 2. Instalacja zależności
```bash
npm install
```

### 3. Konfiguracja klucza API (OpenRouter)

Pobierz darmowy klucz z [openrouter.ai/keys](https://openrouter.ai/keys).

Możesz skonfigurować klucz na **dwa sposoby**:

**Sposób A (plik `.env`):**
Skopiuj plik `.env.example` do `.env`:
```bash
cp .env.example .env
```
I wklej swój klucz:
```env
VITE_OPENROUTER_API_KEY=sk-or-v1-twoj-klucz-openrouter
```

**Sposób B (w interfejsie aplikacji):**
Po uruchomieniu aplikacji kliknij przycisk **Wprowadź Klucz API** w prawym górnym rogu ekranu i wklej swój klucz.

### 4. Uruchomienie serwera deweloperskiego
```bash
npm run dev
```
Aplikacja uruchomi się pod adresem [http://localhost:5173](http://localhost:5173).

---

## 🧪 Testy automatyczne

Projekt zawiera zestaw testów weryfikujących logikę drzewa, rozgałęzienia w rozgałęzieniach, izolację gałęzi oraz integrację z API:

```bash
node tests/test_tree_chat.js
```

---

## 🛠️ Technologie

- **React 19**
- **Vite**
- **Lucide Icons**
- **Marked** (renderowanie Markdown)
- **OpenRouter API**
