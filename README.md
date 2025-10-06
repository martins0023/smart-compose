# Contextual Quick-Reply Co-Pilot - Smart Compose

## 🚀 Project Overview

The **Contextual Quick-Reply Co-Pilot - smart compose** is a lightweight, high-performance Chrome Extension designed to drastically reduce the time and effort required to craft professional, contextually appropriate replies on popular browser-based chat and social media platforms (WhatsApp, X, Facebook, etc.).

This project is built around the principle of **privacy-by-design**, leveraging Chrome's experimental **Built-in AI APIs (Prompt API and Rewriter API)** to run the entire Generative AI workflow **on-device** using the Gemini Nano model. This ensures instant responses without ever sending sensitive conversation data to an external server.

-----

## ✨ Features & Functionality

### 1\. On-Demand, Context-Aware Generation (Prompt API)

   * Smart compose is an experimental browser extension that helps users quickly generate replies, confirmations, and summaries for selected text on any webpage. It puts a small “AI Actions” floating button near selected text (using a Shadow DOM so styles don’t leak) and exposes:

   * Quick analysis — tone/intent detection (Prompt API).

   * Generate reply — produce suggested replies; preview them in a modal.

   * Insert reply — click a suggested reply to drop it into the page’s message box (robustly).

   * Refine / Regenerate — refine the suggested reply by tone (formal, friendly, concise, sarcastic).

   * Summarize — simple summary flow.

### 2\. What we built — features

  * Lightweight UI injected via a Shadow DOM to avoid CSS collisions.
  * Floating action button placed near user text selections.
  * Quick analysis overlay that shows detected tone & intent and a suggested action.
  * Main menu for explicit Generate Reply / Summarize actions.
  * Reply preview modal with:
   - Click-to-insert into the page message box.
   - Insert button that triggers robust insertion for contenteditable, textarea, and input elements, including React-controlled inputs (uses the native setter trick).
   - Regenerate and refinement (tone) options.
  * Background service worker that:
   - Detects and uses Chrome Built-in AI APIs where available (origin trial, chrome.ai, window.ai).
   - Starts/monitors model download if a user gesture is given.
   - Returns helpful error codes to content scripts: NOT_AVAILABLE, USER_GESTURE_REQUIRED, etc.
   - Safe, defensive request handling.

### 3\. User Experience (UX)

  * **Interface:** A non-intrusive, modal box UI provides a dedicated workspace for AI interactions without disrupting the native chat environment.
  * **Targeted Activation:** The extension only activates and extracts context when the user highlights a specific chat or text.

-----

## 🏗️ Architecture and Best Practices

### 1\. Chrome Extension Architecture (Manifest V3)

  * **Service Worker (`background.js`):** Acts as the central hub, listening for messages from the content script. It is responsible for initializing and managing the life cycle of the on-device AI models (`LanguageModel` and `Rewriter`). This ensures that the computationally intensive AI logic is separated from the UI.
  * **Content Script (`content.js`):** Injects Shadow DOM UI, listens for user selection, shows floating button, calls chrome.runtime for analysis/generation/refinement.
  * **Popup (`popup.html + popup.js`):** Houses the user interface for displaying suggestions, accepting input, and controlling rewrite options. Reads/writes chrome.storage.local flags.
  * **Manifest:** Declares permissions, content scripts, background service worker, and optional origin trial tokens.

### 2\. AI Implementation and Privacy Standard

  * **On-Device Processing:** This project strictly uses the experimental `window.ai` API, ensuring all Large Language Model (LLM) tasks—generation and rewriting—are executed **locally** using the Gemini Nano model.
      * **Benefit:** Achieves maximum user privacy, as sensitive conversation data never leaves the user's device or browser.
  * **Resource Management:** The `LanguageModel` and `Rewriter` instances are created and destroyed efficiently within the Service Worker based on user session activity to manage device resources and battery life, following the best practice of **lazy model loading**.
  * **Prompt Engineering:** We utilized structured, few-shot prompting to guide the on-device LLM. Prompts were meticulously designed to maximize the quality and diversity of suggestions while remaining concise, a critical practice for small, resource-constrained models.

### 3\. Code Standards and Development

  * **Defensive messaging:** Background service workers may restart. Calls from the content script can fail with "Extension context invalidated." if the background unloads while the content script is waiting for a reply. We implemented safeSendMessage() that:
   - Wraps `chrome.runtime.sendMessage` in a Promise.
   - Checks `chrome.runtime.lastError`.
   - Returns structured error codes (`RUNTIME_UNAVAILABLE`, `TIMEOUT`, etc.).
   - Avoids throwing, and content script displays helpful user-facing messages instead. 

  * **Shadow DOM UI:** The UI is implemented in a Shadow DOM to avoid interfering with page styles. All elements belong to the extension’s shadow root and are safe from page CSS.
  * **Robust input insertion:** 
   - We attempt to find the message input with a chain of heuristics (findChatInputBox()).
   - For contenteditable nodes we insert a textNode, set selection caret to the end, and dispatch an InputEvent. We also fire a harmless KeyboardEvent where possible to enable “send” buttons that react to key press handlers.
  * **Built-in AI / availability & user gesture:**
   - Many device/Chrome builds require a user gesture to download on-device models. The background includes an availability check that may return a USER_GESTURE_REQUIRED error; the popup exposes an explicit “Initialize Built-in AI” button which calls ensureLanguageModelReady({ interactive: true }).
   - All built-in calls include an outputLanguage (e.g., 'en') to satisfy API requirements.
  * **Content selection race conditions:**
   - The extension avoids hiding the UI while the user interacts with it by tracking pointer events on the Shadow DOM host (window.__aiCopilotIgnoreHide).
   - Selection change and mouseup handlers use debouncing to avoid flicker.

  * **Security & privacy:**
   - The extension does not persist selected page content unless a generation request is made; requests to the background include only the selected text.
   - Clipboard fallback used only as a last resort; the extension requests no unusual permissions beyond `storage`, `activeTab`, and `scripting` (and `host_permissions` if proxy/hosted calls are needed).


---

## Files & responsibilities (what to look at)

> The codebase can be split into smaller modules for maintainability. At minimum, consider:
>
> * `src/content.js` (content script UI + DOM helpers)
> * `src/background.js` (service worker)
> * `src/popup.html`, `src/popup.js` (popup UI)
> * `src/proxy/*` (optional server / cloud function)
> * `manifest.json`
> * `README.md` (this file)

### Key code locations:

* `content.js`

  * `init()` — sets up shadow host and event listeners.
  * `handleTextSelection()` — selection detection.
  * `safeSendMessage()` — wrapper used everywhere to talk to the background.
  * `showActionButton()`, `showMainMenu()`, `showReplyPreview()` — UI flows.
  * `insertReplyToChat()` — robust insertion function.

* `background.js`

  * `detectBuiltInAPI()` / `isBuiltInAPIAvailable()` — capability detection.
  * `ensureLanguageModelReady()` — availability check and user gesture handling.
  * `builtinPrompt(...)` — normalizes built-in calls (adds `outputLanguage`).
  * Message handler — routes `analyze`, `generate`, `refine` calls and returns structured responses and helpful error codes.

* `popup.js`

  * Monitors `chrome.storage.local` for `builtinAIStatus`.
  * Calls `initBuiltinAI` when the user clicks Initialize (user gesture).
  * Implements `POST /generate` accepting `{ prompt, model, generationConfig }`.

---

## Developer setup / local testing (step-by-step)

> Assumes Chrome/Chromium with extension development enabled.

1. Clone repo.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**, and select the extension folder (the folder containing `manifest.json`).
5. Open the extension inspector for the service worker (click “background page / service worker → Inspect views”). Watch for background errors.
6. Reload the extension after changes.

**If using built-in AI (origin trial / device model):**

* You may need a compatible Chrome/Chromium build and an origin trial token configured in `manifest.json` (`trial_tokens`).
* If the model state is `downloadable` or `downloading`, the extension will require a user gesture. Open the popup and click **Initialize Built-in AI**.

---

## How the extension works (runtime flow)

1. **User selects text in the page** → `content.js` detects selection.
2. The **AI Actions** floating button appears near the selection (in Shadow DOM).
3. Content script calls `performPreAnalysis()` → `safeSendMessage({action: 'analyze', text})`.

   * Background decides whether to use built-in Prompt API or the proxy.
   * If built-in model is not available and requires a gesture, the background returns an error `USER_GESTURE_REQUIRED`. The content script shows a helpful error telling the user to initialize the model in the popup.
4. Background returns analysis; content script displays a quick overlay with tone/intent.
5. User chooses Generate Reply (from Quick Action or menu) → content script calls `safeSendMessage({ action: 'generate', text, type, context })`.
6. Background returns generated text; content script shows reply preview modal.
7. User clicks a preview or Insert → `insertReplyToChat()` attempts to set the input box and dispatch appropriate events.
8. If insertion can't be done, the extension copies the reply to the clipboard and tells the user.

---

## Error handling, robustness, & debugging

### Common errors & what they mean

* `Extension context invalidated.` — background service worker restarted while the content script was waiting. Fix: use `safeSendMessage()` and handle `chrome.runtime.lastError`. This project already implements that.
* `NOT_AVAILABLE` (returned by background) — Built-in AI not available (no `chrome.ai` or origin trial). Use proxy or enable appropriate flags and origin trial.
* `USER_GESTURE_REQUIRED` — Model requires user gesture to download (popup should call `initBuiltinAI`).
* `No output language specified` — When using Prompt/LanguageModel APIs you must set `expectedOutputs`/`outputLanguage` (we set an `OUTPUT_LANGUAGE` default).

### Debugging tips

* Reload extension in `chrome://extensions` after changes.
* Inspect the background service worker: open its console to see thrown errors.
* Inspect the page console for content script logs. The content script logs friendly messages and warnings.
* Add `console.log` in the background to trace which path is taken (built-in vs proxy).

---

### — Security, privacy, and data flow considerations

* **User data**: We only send selected text (and, optionally, a captured image DataURL if you add image support) to the background, and then to either the built-in API (device) or proxy. If using a remote proxy, you should show a privacy notice and preferably support user opt-in.
* **Least privilege**: manifest only asks for `storage`, `activeTab`, `scripting`, and `host_permissions` if needed. Avoid unneeded permission scopes.
* **Clipboard fallback**: used as a last resort; the extension writes to the clipboard only when needed.

---

### — Testing checklist

* [ ] Selection detection works on plain pages.
* [ ] UI floats to correct position and doesn't get clipped by sticky headers.
* [ ] Quick analysis shows tone/intent.
* [ ] Generate Reply returns text and preview is shown.
* [ ] Clicking reply inserts text into:

  * [ ] contenteditable boxes (WhatsApp web, Messenger)
  * [ ] textareas (Twitter/X compose)
  * [ ] inputs (simple inputs)
* [ ] Regenerate/refine works and updates preview.
* [ ] Summarize action works.
* [ ] Background handles:

  * [ ] Built-in path 
  * [ ] User gesture required state (popup is shown)
* [ ] Background doesn't crash; if it restarts, content script recovers gracefully and shows user-friendly messages.

---

### Roadmap / Suggested improvements

* Add option to configure proxy URL in popup (persist to `chrome.storage.local`).
* Better heuristics for determining the correct input in complex pages.
* Add analytics / usage counters (careful with privacy).
* Add unit tests for `setNativeValue()` behavior in a simulated DOM (Jest + jsdom).
* Add localization support.


## Appendix

### Useful dev commands (macOS / Linux)

* Reload extension: open `chrome://extensions` → click **Reload**.
* View background console: `chrome://extensions` → Inspect service worker for the extension.

---

### Local Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/martins0023/smart-compose.git
    cd smart-compose
    ```
2.  **Load Extension:**
      * Open Chrome and go to `chrome://extensions`.
      * Enable **Developer mode** using the toggle in the top-right corner.
      * Click the **Load unpacked** button.
      * Select the `dist` folder
3.  **Testing:**
      * A new icon will appear in your toolbar.
      * Navigate to a supported chat application (e.g., open WhatsApp Web).
      * Interact with a text input field to trigger the side panel and begin testing.

-----

## 👥 Contributors

  * Miracle Oladapo - **lead dev**
  * Omotosho Ayomikun - **co-developer**

-----

## 🗺️ What's Next

The future development for the Contextual Quick-Reply Co-Pilot focuses on refining model performance and expanding capabilities:

  * **Integration with Rewriter's Tone Customization:** Implementing a user setting that allows the Rewriter API to learn a user's bespoke writing style (e.g., "The Friendly but Firm Tone") and apply it to all suggestions.
  * **Proactive Auto-Drafting:** Developing a mechanism to score suggestion confidence ($S_c$) and, for high-confidence scores ($S_c > 0.95$), automatically populate the chat box with a suggested draft, maximizing time savings.
  * **Multilingual Support:** Expanding the Prompt API to seamlessly support and generate replies in multiple languages based on the conversation context.