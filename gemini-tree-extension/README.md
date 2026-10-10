# 🌿 Gemini Tree — Wtyczka do Google Chrome (Manifest V3)

Wtyczka rozszerza oficjalny interfejs **Google Gemini** ([gemini.google.com](https://gemini.google.com)) o **nieliniową strukturę wątków, rozgałęzianie pytań i wizualizację drzewa konwersacji (Dot Tree Visualizer)**, w 100% dopasowaną do natywnego stylu Google.

---

## ✨ Funkcjonalności w Gemini

1. **🌿 Przycisk „Rozgałęź”:**
   - Wstrzykiwany bezpośrednio do paska akcji każdego pytania użytkownika w Gemini (obok przycisku edycji ołówka i kopiowania).
   - Kliknięcie aktywuje tryb tworzenia nowej odnogi z tego poziomu.

2. **🧭 Selektor Wersji Prompta (`< Wersja 1 z 3 >`):**
   - Pojawia się automatycznie, gdy na danym poziomie zadasz więcej niż jedno alternatywne pytanie.
   - Strzałki lewo/prawo oraz rozwijane menu pozwalają natychmiast przełączać się między gałęziami.

3. **📊 Wysuwany Boczny Panel z Grafem Punktów (Dot Tree Drawer):**
   - W prawym górnym rogu Gemini pojawia się przycisk **„Drzewo Gałęzi”** z licznikiem odnóg.
   - Po kliknięciu wysuwa się elegancki boczny panel w ciemnym motywie Gemini.
   - Wizualizacja kropkowa z połączeniami:
     - 🟢 **Zielony punkt**: aktywna ścieżka konwersacji.
     - 🟣 **Fioletowy punkt**: alternatywne odnogi.
     - 🟠 **Pomarańczowy punkt**: miejsca rozwidlenia.
   - Kliknięcie w dowolny punkt natychmiast przewija czat do odpowiadającej wiadomości i przełącza gałąź.

4. **🔒 Prywatność i bezpieczeństwo:**
   - Cała struktura drzewa jest przechowywana lokalnie w Twojej przeglądarce (`chrome.storage.local`).
   - Żadne dane nie są wysyłane na zewnętrzne serwery.

---

## 🚀 Jak zainstalować w Google Chrome (30 sekund)

1. Otwórz przeglądarkę **Google Chrome**.
2. W pasku adresu wpisz:
   ```text
   chrome://extensions/
   ```
   i naciśnij Enter.
3. W prawym górnym rogu strony włącz przełącznik **„Tryb dewelopera”** (*Developer mode*).
4. W lewym górnym rogu kliknij przycisk **„Załaduj rozpakowane”** (*Load unpacked*).
5. Wybierz folder:
   ```text
   C:\Users\jakub\Documents\Tree LLM Chatbot\gemini-tree-extension
   ```
6. Wtyczka **„Gemini Tree”** pojawi się na Twojej liście rozszerzeń!
7. Otwórz [https://gemini.google.com](https://gemini.google.com) i przetestuj rozgałęzianie.
