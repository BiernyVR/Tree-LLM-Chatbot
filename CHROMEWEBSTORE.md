# Chrome Web Store Listing — Gemini Tree

> Last Updated: 2026-10-10

## Store Listing

**Extension Name** [REQUIRED]
Gemini Tree — Branching Threads & Visual Tree

**Short Description** [REQUIRED]
Adds nonlinear conversation branching, alternative prompt paths, and interactive tree visualization to Google Gemini.

**Detailed Description** [REQUIRED]
Gemini Tree brings true nonlinear branching and hierarchical conversation trees to Google Gemini (gemini.google.com).

Explore alternative prompts, test different scenarios, and branch off any turn without cluttering or breaking your conversation flow.

Key Features:
- On-Demand Branching: Click "Branch" beside any user prompt turn to immediately draft an alternative question path.
- True Branch Isolation: Non-active branches are cleanly hidden from view, preventing contradictory responses from mixing together.
- Turn Version Selector: Easily switch back and forth between alternative prompt versions (#1 of 3, #2 of 3) directly inside the chat interface.
- Interactive Conversation Tree: Open the slide-out visual drawer to inspect your complete conversation structure, nodes, depth, and branches.
- Auto-Fit & Zoom Controls: The tree canvas automatically scales down to fit complex trees without cutting off lower levels, complete with zoom controls (+, -, Fit to View) and drag-to-pan scrolling.
- Draggable Panel Resizer: Expand the drawer width with a simple drag for wider graphs.
- Bilingual (English & Polish): Seamlessly switch languages anytime via the drawer header or extension popup (EN / PL).

How to Use:
1. Open Google Gemini (gemini.google.com).
2. Hover over any prompt you submitted to see the "Branch" button.
3. Click "Branch" to enter Branching Mode, then type your alternative question.
4. Click the floating "Branch Tree" button at the top-right to inspect the full visual tree and switch between any previous conversation turns with a single click.

Privacy & Safety:
Gemini Tree runs 100% locally in your browser. It does not send your prompts, conversations, or personal data to any external server. All branch mappings are stored strictly inside your browser's private local storage.

Support & Feedback:
Open source project repository: https://github.com/BiernyVR/Tree-LLM-Chatbot

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Enables nonlinear conversation branching, alternative prompt exploration, and visual conversation tree navigation on Google Gemini.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `gemini-tree-extension/icons/icon-128.png` |
| Extension Icon | 48×48 PNG | ✅ Ready | `gemini-tree-extension/icons/icon-48.png` |
| Small Icon | 16×16 PNG | ✅ Ready | `gemini-tree-extension/icons/icon-16.png` |
| Screenshot 1 [REQUIRED] | 1280×800 PNG | ✅ Ready | `store-assets/screenshot-1-1280x800.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 PNG | ✅ Ready | `store-assets/screenshot-2-1280x800.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 PNG | ✅ Ready | `store-assets/screenshot-3-1280x800.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 PNG | ✅ Ready | `store-assets/promo-tile-small-440x280.png` |

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Stores the user's local conversation tree graphs, active branch selections, panel width settings, and language preference locally on their device. |
| `activeTab` | permissions | Used by the popup action to detect if the user currently has gemini.google.com open and deliver live tree reset commands. |
| `tabs` | permissions | Enables the popup to identify the active Gemini chat session ID and open gemini.google.com when clicking the primary action button. |
| `https://gemini.google.com/*` | host_permissions | Required to inject the branching action button, version switcher pill, and visual tree drawer directly into Google Gemini chat turns. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

The extension does not collect, track, log, transmit, or monetize any user data. All conversation structures and settings remain 100% on the user's local device in `chrome.storage.local`.

---

## Version History

- **v1.2.5** (2026-10-10): Added bilingual support (English as default with Polish toggle), English store listing metadata, interactive auto-fit scaling, zoom toolbar, and draggable drawer resizer.
- **v1.2.4** (2026-10-10): Added auto-scaling layout, canvas drag-to-pan, and resizable panel edge.
- **v1.2.3** (2026-10-10): Fixed multi-turn branching from ancestor nodes and enhanced Bezier curves.
- **v1.2.0** (2026-10-10): Added true branch isolation and version pill selector.
- **v1.0.0** (2026-10-09): Initial release with tree drawer and branching action.
