// content.js
// Content Script for AI Chat Co-Pilot (Gemini via API key / proxy)
// Fixed selection / UI race issues so menu, preview, and insert reliably work.

let selectedText = '';
let currentContext = null;
let currentInputBox = null;
let shadowHost = null;
let shadowRoot = null;
let generatedReplyText = '';
let selectedImageDataUrl = null; // reserved for future image handling

// UI interaction guard: when true, content scripts won't hide UI even if selection empties.
// We toggle this when pointerdown/up occurs inside our shadow DOM.
window.__aiCopilotIgnoreHide = false;

// Initialize extension (create shadow DOM + handlers)
function init() {
  // create host & shadow root
  shadowHost = document.createElement('div');
  shadowHost.id = 'ai-copilot-shadow-host';
  shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  document.body.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'open' });
  injectStyles();

  // set pointer handlers on host so interactions inside our UI set the ignore flag
  shadowHost.addEventListener('pointerdown', () => {
    window.__aiCopilotIgnoreHide = true;
  }, { capture: true });
  shadowHost.addEventListener('pointerup', () => {
    // small delay so downstream click handlers run before we clear the guard
    setTimeout(() => { window.__aiCopilotIgnoreHide = false; }, 120);
  }, { capture: true });

  // listen for selection / mouseup on the page
  document.addEventListener('mouseup', handleTextSelection);
  // selectionchange for keyboard selection (debounced)
  document.addEventListener('selectionchange', () => {
    clearTimeout(window.__aiSelectionTimer);
    window.__aiSelectionTimer = setTimeout(() => {
      // if the user is interacting with our UI, don't hide
      if (window.__aiCopilotIgnoreHide) return;
      const selection = window.getSelection();
      if (!selection || !selection.toString().trim()) hideAllUI();
    }, 200);
  });

  console.log('AI Chat Co-Pilot initialized with Shadow DOM (fixed selection race)');
}

// Inject minimal styles
function injectStyles() {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    * { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; box-sizing: border-box; }
    .ai-copilot-action-btn { position: fixed; z-index: 2147483647; }
    .ai-action-primary { background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); color: #fff; border: none; padding: 8px 12px; border-radius: 18px; cursor: pointer; font-weight:700; }
    .ai-copilot-analysis { margin-top:8px; background:white; border-radius:12px; padding:10px; box-shadow:0 6px 18px rgba(0,0,0,0.12); min-width:200px; }
    .ai-copilot-menu { position: fixed; background: white; border-radius:12px; padding:8px; box-shadow:0 6px 20px rgba(0,0,0,0.15); min-width:180px; z-index:2147483647; }
    .menu-item { display:block; padding:8px 12px; border:none; background:transparent; cursor:pointer; text-align:left; border-radius:8px; }
    .ai-copilot-reply-preview { position: fixed; top:50%; left:50%; transform: translate(-50%,-50%) scale(0.95); background:white; border-radius:12px; padding:16px; box-shadow:0 10px 40px rgba(0,0,0,0.3); max-width:520px; width:90%; z-index:2147483647; opacity:0; transition:all 180ms ease; }
    .ai-copilot-reply-preview.show { transform: translate(-50%,-50%) scale(1); opacity:1; }
    .reply-preview-content { background:#f8f9fa; border-radius:10px; padding:12px; max-height:300px; overflow:auto; white-space:pre-wrap; cursor:pointer; }
    .ai-copilot-loader { position: fixed; top: 18px; right: 18px; padding:10px 14px; background:white; border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,0.12); z-index:2147483647; }
    .ai-copilot-error { position: fixed; top: 18px; right: 18px; background:#ff5252; color:white; padding:10px 14px; border-radius:10px; z-index:2147483647; }
    .ai-copilot-success { position: fixed; top: 18px; right: 18px; background:#10b981; color:white; padding:10px 14px; border-radius:10px; z-index:2147483647; }
  `;
  shadowRoot.appendChild(styleSheet);
}

// Handle text selection (fires for mouseup on the page)
function handleTextSelection(e) {
  // If the event originated inside our UI, do nothing (we handle clicks internally)
  // e.composedPath may be undefined in some browsers — guard defensively.
  if (e && typeof e.composedPath === 'function') {
    const path = e.composedPath();
    if (path && path.includes(shadowHost)) {
      // User clicked inside our UI; ignore selection hiding
      return;
    }
  }

  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';
  selectedImageDataUrl = null; // reserved for image handling later

  if (text.length > 0) {
    selectedText = text;
    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      showActionButton(rect);
    } catch (err) {
      // If range not available, position button near mouse event
      const x = (e && e.clientX) ? e.clientX : window.innerWidth / 2;
      const y = (e && e.clientY) ? e.clientY : window.innerHeight / 2;
      showActionButton({ left: x, top: y, bottom: y, right: x });
    }
    performPreAnalysis(text);
  } else {
    // If ignore flag is set (we're interacting with UI), don't hide
    if (window.__aiCopilotIgnoreHide) return;
    hideAllUI();
  }
}

// Show the floating action button (near selection rect)
function showActionButton(rect) {
  hideAllUI(); // clear previous UI

  const actionButton = document.createElement('div');
  actionButton.className = 'ai-copilot-action-btn';
  actionButton.innerHTML = `<button class="ai-action-primary" id="ai-main-btn">✨ AI Actions</button>`;

  // position with safety
  const left = (typeof rect.left === 'number') ? rect.left + window.scrollX : Math.max(8, (rect.x || 0) + window.scrollX);
  const top = (typeof rect.bottom === 'number') ? rect.bottom + window.scrollY + 6 : (rect.y || 0) + window.scrollY + 6;
  actionButton.style.left = `${Math.max(8, left)}px`;
  actionButton.style.top = `${top}px`;

  // append to shadowRoot
  shadowRoot.appendChild(actionButton);

  // stop propagation for clicks within our UI
  const btn = actionButton.querySelector('#ai-main-btn');
  if (btn) {
    btn.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); }, { capture: true });
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // When clicked, open main menu; pass the rect to position
      showMainMenu({ left, top: top - window.scrollY, bottom: top - window.scrollY, right: left });
    });
  }
}

// Query background to get analysis (pre-analysis)
function performPreAnalysis(text) {
  chrome.runtime.sendMessage({ action: 'analyze', text }, (response) => {
    if (!response) { showError('No response from background'); return; }
    if (response.error) { showError(response.error); return; }
    if (response.success) {
      currentContext = response.analysis;
      showAnalysisOverlay(currentContext);
    }
  });
}

// Show analysis overlay appended to action button
function showAnalysisOverlay(analysis) {
  // Remove old overlay
  const existing = shadowRoot.querySelector('.ai-copilot-analysis');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ai-copilot-analysis';
  overlay.innerHTML = `
    <div style="font-weight:700;margin-bottom:6px">Quick Analysis</div>
    <div style="display:flex;gap:8px;font-size:13px">
      <div><strong>Tone</strong><div>${escapeHtml(analysis.emotion || 'Neutral')}</div></div>
      <div><strong>Intent</strong><div>${escapeHtml(analysis.intent || 'Statement')}</div></div>
    </div>
    <div style="margin-top:8px"><button class="ai-quick-action">${escapeHtml(analysis.suggestedAction || 'Generate Reply')}</button></div>
  `;

  // Append overlay next to the action button if available, else append to root
  const actionBtnWrapper = shadowRoot.querySelector('.ai-copilot-action-btn');
  if (actionBtnWrapper) actionBtnWrapper.appendChild(overlay);
  else shadowRoot.appendChild(overlay);

  // stop propagation inside overlay
  overlay.addEventListener('pointerdown', (ev) => ev.stopPropagation(), { capture: true });

  const quick = overlay.querySelector('.ai-quick-action');
  if (quick) quick.addEventListener('click', (ev) => {
    ev.stopPropagation();
    handleGeneration(getActionType(analysis.suggestedAction));
  });
}

function getActionType(suggestion) {
  const lower = (suggestion || '').toLowerCase();
  if (lower.includes('confirmation')) return 'confirmation';
  if (lower.includes('supportive')) return 'supportive';
  return 'reply';
}

// Show the small main menu (Generate Reply / Summarize)
function showMainMenu(rect) {
  // Remove previous menu if any
  const prev = shadowRoot.querySelector('.ai-copilot-menu');
  if (prev) prev.remove();

  const menu = document.createElement('div');
  menu.className = 'ai-copilot-menu';
  menu.innerHTML = `
    <button class="menu-item" data-action="reply">💬 Generate Reply</button>
    <button class="menu-item" data-action="summarize">📝 Summarize Text</button>
  `;

  // position safely (use same left/top as the button)
  const left = (typeof rect.left === 'number') ? rect.left + window.scrollX : Math.max(8, (rect.x || 0) + window.scrollX);
  const top = (typeof rect.bottom === 'number') ? rect.bottom + window.scrollY + 35 : (rect.y || 0) + window.scrollY + 35;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;

  // append and attach handlers
  shadowRoot.appendChild(menu);

  // stop propagation for pointerdown inside menu
  menu.addEventListener('pointerdown', (ev) => ev.stopPropagation(), { capture: true });

  menu.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = e.currentTarget.dataset.action;
      handleGeneration(action);
      menu.remove();
    });
  });

  // close menu when clicking outside our UI (but ignore clicks inside shadowHost)
  setTimeout(() => {
    function closeMenuHandler(ev) {
      // if click composed path includes our shadowHost, ignore
      let pathIncludesHost = false;
      try {
        const p = ev.composedPath ? ev.composedPath() : [ev.target];
        pathIncludesHost = p.includes(shadowHost);
      } catch (e) {
        pathIncludesHost = false;
      }
      if (!pathIncludesHost) {
        menu.remove();
        document.removeEventListener('click', closeMenuHandler);
      }
    }
    document.addEventListener('click', closeMenuHandler);
  }, 80);
}

// Handle generation (send request to background)
function handleGeneration(type) {
  showLoadingState();
  // store best-effort input box
  currentInputBox = findChatInputBox();

  chrome.runtime.sendMessage({ action: 'generate', text: selectedText, type, context: currentContext }, (response) => {
    hideLoadingState();
    if (!response) { showError('No response from background'); return; }
    if (response.error) { showError(response.error); return; }
    if (response.success) {
      if (type === 'summarize') showSummary(response.text);
      else {
        generatedReplyText = response.text;
        showReplyPreview(response.text);
      }
    }
  });
}

// Show reply preview modal / box
function showReplyPreview(text) {
  // remove existing preview
  const prev = shadowRoot.querySelector('.ai-copilot-reply-preview');
  if (prev) prev.remove();

  const preview = document.createElement('div');
  preview.className = 'ai-copilot-reply-preview';
  preview.innerHTML = `
    <div style="font-weight:800;margin-bottom:8px">💬 Generated Reply</div>
    <div class="reply-preview-content" id="reply-text">${escapeHtml(text)}</div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button id="insert-reply" style="flex:1;padding:10px;border-radius:8px;border:none;background:linear-gradient(90deg,#667eea,#764ba2);color:white;font-weight:700">Insert to Chat</button>
      <button id="regenerate-reply" style="padding:10px;border-radius:8px;border:none;background:#764ba2;color:white">🔄 Regenerate</button>
      <button id="close-preview" style="padding:10px;border-radius:8px;border:1px solid #ddd;background:white">Cancel</button>
    </div>
    <div style="margin-top:8px;font-size:12px;color:#666">Click the reply text to insert into your message box</div>
  `;
  shadowRoot.appendChild(preview);

  // show animation
  setTimeout(() => preview.classList.add('show'), 10);

  // stop pointer events from leaving the preview
  preview.addEventListener('pointerdown', (ev) => ev.stopPropagation(), { capture: true });

  const replyDiv = preview.querySelector('#reply-text');
  replyDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    // re-find input at click time
    currentInputBox = findChatInputBox() || document.activeElement;
    insertReplyToChat(generatedReplyText);
  });

  // insert button
  preview.querySelector('#insert-reply').addEventListener('click', (e) => {
    e.stopPropagation();
    currentInputBox = findChatInputBox() || document.activeElement;
    insertReplyToChat(generatedReplyText);
  });

  // regenerate
  preview.querySelector('#regenerate-reply').addEventListener('click', (e) => {
    e.stopPropagation();
    preview.remove();
    handleGeneration('reply');
  });

  // close
  preview.querySelector('#close-preview').addEventListener('click', (e) => {
    e.stopPropagation();
    preview.remove();
  });
}

// Insert generated text into the page input (robust)
async function insertReplyToChat(text) {
  // re-find input
  if (!currentInputBox || !isElementInDOM(currentInputBox)) currentInputBox = findChatInputBox();

  if (!currentInputBox && document.activeElement && isEditableElement(document.activeElement)) currentInputBox = document.activeElement;

  if (!currentInputBox) {
    // clipboard fallback
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Text copied to clipboard. Paste (Ctrl+V) into the chat box to send.');
    } catch (err) {
      showError('Could not find chat input. Please copy/paste manually.');
    }
    return;
  }

  try {
    const tag = (currentInputBox.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      setNativeValue(currentInputBox, text);
      currentInputBox.dispatchEvent(new Event('input', { bubbles: true }));
      currentInputBox.dispatchEvent(new Event('change', { bubbles: true }));
      if (typeof currentInputBox.selectionStart === 'number') {
        currentInputBox.selectionStart = currentInputBox.selectionEnd = text.length;
      }
    } else if (currentInputBox.isContentEditable) {
      currentInputBox.focus();
      // clear & insert text node (avoid HTML)
      currentInputBox.innerHTML = '';
      currentInputBox.appendChild(document.createTextNode(text));
      // move caret to end
      const range = document.createRange();
      range.selectNodeContents(currentInputBox);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      // dispatch input events
      const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: text, inputType: 'insertText' });
      currentInputBox.dispatchEvent(inputEvent);
      // lightweight key to enable send in some apps
      try { currentInputBox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a' })); } catch (e) {}
    } else {
      currentInputBox.textContent = text;
      currentInputBox.focus();
      currentInputBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    currentInputBox.focus();
    const preview = shadowRoot.querySelector('.ai-copilot-reply-preview');
    if (preview) preview.remove();
    showSuccess('Reply inserted — you can edit or press send.');
    hideAllUI();
  } catch (err) {
    console.error('insertReplyToChat error', err);
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Could not auto-insert; text copied to clipboard. Paste it into the message box.');
    } catch (e) {
      showError('Failed to insert text. Please copy/paste manually.');
    }
  }
}

/* ---------- Utilities ---------- */

function isElementInDOM(el) {
  try { return document.contains(el); } catch (e) { return false; }
}
function isEditableElement(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  return el.isContentEditable;
}
function setNativeValue(element, value) {
  const tag = (element.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const proto = Object.getPrototypeOf(element);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
  } else {
    try { element.value = value; } catch (e) {}
  }
}

// Find a chat input - best-effort heuristics
function findChatInputBox() {
  // WhatsApp
  let el = document.querySelector('[contenteditable="true"][data-tab="10"]');
  if (el) return el;
  // common contenteditable
  el = document.querySelector('[contenteditable="true"][role="textbox"]');
  if (el) return el;
  // facebook messenger
  el = document.querySelector('[contenteditable="true"][aria-label*="message" i]');
  if (el) return el;
  // twitter/x
  el = document.querySelector('[contenteditable="true"][data-testid="tweetTextarea_0"]') || document.querySelector('[contenteditable="true"][data-testid="dmComposerTextInput"]');
  if (el) return el;
  // textareas
  el = document.querySelector('textarea[placeholder*="message" i]') || document.querySelector('textarea');
  if (el && el.offsetParent !== null) return el;
  // generic contenteditable
  const cands = document.querySelectorAll('[contenteditable="true"]');
  for (const c of cands) {
    const r = c.getBoundingClientRect();
    if (r.width > 80 && r.height > 18 && c.offsetParent !== null) return c;
  }
  // visible inputs
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(i => i.offsetParent !== null);
  if (inputs.length) return inputs[0];
  return null;
}

// show/hide helpers
function showLoadingState() {
  if (shadowRoot.querySelector('#ai-copilot-loader')) return;
  const loader = document.createElement('div');
  loader.id = 'ai-copilot-loader';
  loader.className = 'ai-copilot-loader';
  loader.textContent = 'AI is thinking...';
  shadowRoot.appendChild(loader);
}
function hideLoadingState() {
  const l = shadowRoot.querySelector('#ai-copilot-loader'); if (l) l.remove();
}
function showError(msg) {
  hideLoadingState();
  const ex = document.createElement('div');
  ex.className = 'ai-copilot-error';
  ex.textContent = `❌ ${msg}`;
  shadowRoot.appendChild(ex);
  setTimeout(() => ex.remove(), 5000);
}
function showSuccess(msg) {
  hideLoadingState();
  const s = document.createElement('div');
  s.className = 'ai-copilot-success';
  s.textContent = `✓ ${msg}`;
  shadowRoot.appendChild(s);
  setTimeout(() => s.remove(), 3000);
}

// Hide all UI elements (action button, overlays, menu, preview, loader)
function hideAllUI() {
  const selectors = [
    '.ai-copilot-action-btn',
    '.ai-copilot-analysis',
    '.ai-copilot-menu',
    '.ai-copilot-reply-preview',
    '#ai-copilot-loader'
  ];
  selectors.forEach(sel => {
    const el = shadowRoot.querySelector(sel);
    if (el) el.remove();
  });
}

// small helper
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// initialize
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
