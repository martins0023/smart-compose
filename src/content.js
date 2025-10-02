// src/content.js
// Content Script for AI Chat Co-Pilot (Built-in Chrome AI)
// Adds multimodal selection detection (images), updates analyze/generate/refine flows.

let selectedText = '';
let currentContext = null;
let currentInputBox = null;
let shadowHost = null;
let shadowRoot = null;
let generatedReplyText = '';
let selectedImageDataUrl = null; // data URL if selection includes an image

function init() {
  // Create shadow host
  shadowHost = document.createElement('div');
  shadowHost.id = 'ai-copilot-shadow-host';
  shadowHost.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  document.body.appendChild(shadowHost);

  // Attach shadow root
  shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // Inject styles
  injectStyles();

  // Listen for text selection
  document.addEventListener('mouseup', handleTextSelection);

  // Also handle keyboard selection (shift + arrows)
  document.addEventListener('selectionchange', () => {
    // small debounce
    clearTimeout(window.__aiSelectionTimer);
    window.__aiSelectionTimer = setTimeout(() => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        // leave it to mouseup to position the UI
      } else {
        hideAllUI();
      }
    }, 200);
  });

  console.log('AI Chat Co-Pilot (built-in AI) initialized with Shadow DOM');
}

function injectStyles() {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = `
    /* AI Chat Co-Pilot Styles - Shadow DOM Isolated */
    * {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      box-sizing: border-box;
    }

    .ai-copilot-action-btn {
      position: fixed;
      z-index: 2147483647;
    }

    .ai-action-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      transition: all 0.2s ease;
    }

    .ai-action-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(102, 126, 234, 0.5);
    }

    /* Analysis Overlay */
    .ai-copilot-analysis {
      margin-top: 8px;
      background: white;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: 250px;
    }

    .analysis-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .analysis-item {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
    }

    .analysis-item .label {
      color: #666;
      font-weight: 600;
    }

    .analysis-item .value {
      color: #333;
      font-weight: 500;
    }

    .quick-action {
      background: #f0f0f0;
      border: 1px solid #ddd;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: #333;
      transition: all 0.2s ease;
      margin-top: 4px;
    }

    .quick-action:hover {
      background: #e0e0e0;
      border-color: #ccc;
    }

    /* Main Menu */
    .ai-copilot-menu {
      position: fixed;
      background: white;
      border-radius: 12px;
      padding: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 200px;
      z-index: 2147483647;
    }

    .menu-item {
      background: transparent;
      border: none;
      padding: 10px 16px;
      text-align: left;
      cursor: pointer;
      font-size: 14px;
      border-radius: 8px;
      transition: background 0.2s ease;
      color: #333;
    }

    .menu-item:hover {
      background: #f5f5f5;
    }

    /* Reply Preview Box */
    .ai-copilot-reply-preview {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      background: white;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      max-width: 500px;
      width: 90%;
      z-index: 2147483647;
      opacity: 0;
      transition: all 0.3s ease;
    }

    .ai-copilot-reply-preview.show {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }

    .reply-preview-header {
      font-size: 16px;
      font-weight: 700;
      color: #333;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #f0f0f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .reply-preview-content {
      background: #f8f9fa;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      padding: 16px;
      font-size: 14px;
      color: #333;
      line-height: 1.6;
      margin-bottom: 16px;
      max-height: 300px;
      overflow-y: auto;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .reply-preview-content:hover {
      background: #e8eaed;
      border-color: #667eea;
    }

    .reply-preview-hint {
      font-size: 12px;
      color: #667eea;
      text-align: center;
      margin-top: 8px;
      font-weight: 500;
    }

    .reply-preview-actions {
      display: flex;
      gap: 8px;
    }

    .reply-action-btn {
      flex: 1;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s ease;
    }

    .reply-action-btn.primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .reply-action-btn.primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    .reply-action-btn.secondary {
      background: white;
      color: #667eea;
      border: 2px solid #667eea;
    }

    .reply-action-btn.secondary:hover {
      background: #f0f0f0;
    }

    .reply-action-btn.regenerate {
      background: #764ba2;
      color: white;
    }

    .reply-action-btn.regenerate:hover {
      background: #5f3a82;
    }

    /* Refinement Options */
    .refinement-options {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e0e0e0;
    }

    .refinement-label {
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
      font-weight: 600;
    }

    .refinement-buttons {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tone-btn {
      background: white;
      border: 1px solid #ddd;
      padding: 6px 12px;
      border-radius: 16px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      color: #555;
      transition: all 0.2s ease;
    }

    .tone-btn:hover {
      background: #667eea;
      color: white;
      border-color: #667eea;
      transform: translateY(-1px);
    }

    /* Summary Box */
    .ai-copilot-summary {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      background: white;
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      max-width: 500px;
      z-index: 2147483647;
      opacity: 0;
      transition: all 0.3s ease;
    }

    .ai-copilot-summary.show {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }

    .summary-header {
      font-size: 16px;
      font-weight: 700;
      color: #333;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 2px solid #f0f0f0;
    }

    .summary-content {
      font-size: 14px;
      color: #555;
      line-height: 1.6;
      margin-bottom: 16px;
    }

    .summary-close {
      background: #667eea;
      color: white;
      border: none;
      padding: 8px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      width: 100%;
      transition: background 0.2s ease;
    }

    .summary-close:hover {
      background: #5568d3;
    }

    /* Loading State */
    .ai-copilot-loader {
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      border-radius: 12px;
      padding: 16px 24px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 2147483647;
      font-size: 14px;
      color: #333;
    }

    .spinner {
      width: 20px;
      height: 20px;
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Error Box */
    .ai-copilot-error {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff4444;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(255, 68, 68, 0.3);
      z-index: 2147483647;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s ease;
    }

    /* Success notification */
    .ai-copilot-success {
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
      z-index: 2147483647;
      font-size: 14px;
      font-weight: 500;
      animation: slideIn 0.3s ease;
    }

    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  shadowRoot.appendChild(styleSheet);
}

// Handle text selection and detect images
async function handleTextSelection(e) {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  // Reset image selection
  selectedImageDataUrl = null;

  // If there's a selection and it contains an element with an image, capture it
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

    if (container) {
      const imgs = Array.from(container.querySelectorAll('img'));
      if (imgs.length > 0) {
        // Prefer an image that is within the selected range bounds
        const selectedImgs = imgs.filter(img => {
          try {
            const imgRect = img.getBoundingClientRect();
            const rangeRect = range.getBoundingClientRect();
            // basic overlap check
            return !(imgRect.right < rangeRect.left || imgRect.left > rangeRect.right || imgRect.bottom < rangeRect.top || imgRect.top > rangeRect.bottom);
          } catch (err) {
            return false;
          }
        });
        const imgToUse = selectedImgs[0] || imgs[0];
        if (imgToUse) {
          try {
            selectedImageDataUrl = await imageElementToDataUrl(imgToUse);
          } catch (err) {
            console.warn('Failed to capture selected image:', err);
            selectedImageDataUrl = null;
          }
        }
      }
    }
  }

  if (text.length > 0) {
    selectedText = text;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    showActionButton(rect);
    performPreAnalysis(text);
  } else {
    hideAllUI();
  }
}

// Convert an <img> element to a data URL via canvas
function imageElementToDataUrl(imgEl) {
  return new Promise((resolve, reject) => {
    try {
      // Create an image object to ensure we can draw it to canvas
      const img = new Image();
      // handle cross-origin images by setting crossOrigin - may fail if not allowed
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const maxDim = 1024; // limit size to avoid huge data URIs
          let { width, height } = img;
          let scale = 1;
          if (width > maxDim || height > maxDim) {
            scale = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (err) => {
        reject(err);
      };
      // If the image has a srcset or data-src, prefer currentSrc
      img.src = imgEl.currentSrc || imgEl.src;
      // If already complete, force onload
      if (img.complete && img.naturalWidth) {
        img.onload();
      }
    } catch (err) {
      reject(err);
    }
  });
}

// Show floating action button
function showActionButton(rect) {
  hideAllUI();

  const actionButton = document.createElement('div');
  actionButton.className = 'ai-copilot-action-btn';
  actionButton.innerHTML = `
    <button class="ai-action-primary">✨ Smart Actions</button>
  `;

  actionButton.style.position = 'fixed';
  actionButton.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  actionButton.style.top = `${rect.bottom + window.scrollY + 5}px`;

  shadowRoot.appendChild(actionButton);

  actionButton.querySelector('.ai-action-primary').addEventListener('click', (evt) => {
    evt.stopPropagation();
    showMainMenu(rect);
  });
}

// Perform pre-analysis by contacting background (which calls Prompt API)
function performPreAnalysis(text) {
  chrome.runtime.sendMessage(
    { action: 'analyze', text: text, image: selectedImageDataUrl },
    (response) => {
      if (!response) {
        showError('No response from extension background.');
        return;
      }

      if (response.error === 'NOT_AVAILABLE') {
        // show a friendly, persistent UI hint to the user (instead of console spam)
        showError('Built-in AI not available in this browser/profile. Open the extension popup for guidance.');
        // Optionally update the popup’s status via storage so popup can show detailed steps
        chrome.storage.local.set({ builtinAIAvailable: false });
        return;
      }
      
      if (response && response.success) {
        currentContext = response.analysis;
        showAnalysisOverlay(currentContext);
      } else {
        // ignore or show fallback
        console.warn('Pre-analysis failed:', response?.error);
      }
    }
  );
}

function showAnalysisOverlay(analysis) {
  const existingOverlay = shadowRoot.querySelector('.ai-copilot-analysis');
  if (existingOverlay) existingOverlay.remove();

  const analysisOverlay = document.createElement('div');
  analysisOverlay.className = 'ai-copilot-analysis';
  analysisOverlay.innerHTML = `
    <div class="analysis-content">
      <div class="analysis-item">
        <span class="label">Tone:</span>
        <span class="value">${escapeHtml(String(analysis.emotion || 'Neutral'))}</span>
      </div>
      <div class="analysis-item">
        <span class="label">Intent:</span>
        <span class="value">${escapeHtml(String(analysis.intent || 'Statement'))}</span>
      </div>
      <button class="quick-action" data-action="${getActionType(analysis.suggestedAction)}">
        ${escapeHtml(String(analysis.suggestedAction || 'Generate Reply'))}
      </button>
    </div>
  `;

  const actionBtn = shadowRoot.querySelector('.ai-copilot-action-btn');
  if (actionBtn) actionBtn.appendChild(analysisOverlay);

  const quickBtn = analysisOverlay.querySelector('.quick-action');
  if (quickBtn) {
    quickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const actionType = e.currentTarget.dataset.action;
      handleGeneration(actionType);
    });
  }
}

function getActionType(suggestion) {
  const lower = (suggestion || '').toLowerCase();
  if (lower.includes('confirmation')) return 'confirmation';
  if (lower.includes('supportive')) return 'supportive';
  return 'reply';
}

function showMainMenu(rect) {
  const menu = document.createElement('div');
  menu.className = 'ai-copilot-menu';
  menu.innerHTML = `
    <button class="menu-item" data-action="reply">💬 Generate Reply</button>
    <button class="menu-item" data-action="summarize">📝 Summarize Text</button>
  `;

  menu.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  menu.style.top = `${rect.bottom + window.scrollY + 35}px`;

  shadowRoot.appendChild(menu);

  menu.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = e.currentTarget.dataset.action;
      handleGeneration(action);
      menu.remove();
    });
  });

  setTimeout(() => {
    document.addEventListener('click', function closeMenu() {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    });
  }, 100);
}

// Handle generation and pass selected image if present
function handleGeneration(type) {
  showLoadingState();

  currentInputBox = findChatInputBox();

  chrome.runtime.sendMessage(
    {
      action: 'generate',
      text: selectedText,
      type: type,
      context: currentContext,
      image: selectedImageDataUrl
    },
    (response) => {
      hideLoadingState();

      if (response && response.success) {
        if (type === 'summarize') {
          showSummary(response.text);
        } else {
          generatedReplyText = response.text;
          showReplyPreview(response.text);
        }
      } else {
        showError(response?.error || 'Generation failed');
      }
    }
  );
}

// Show reply preview (similar to your previous code)
function showReplyPreview(text) {
  const existingPreview = shadowRoot.querySelector('.ai-copilot-reply-preview');
  if (existingPreview) existingPreview.remove();

  const previewBox = document.createElement('div');
  previewBox.className = 'ai-copilot-reply-preview';
  previewBox.innerHTML = `
    <div class="reply-preview-header">💬 Generated Reply</div>
    <div class="reply-preview-content" id="reply-text"></div>
    <div class="reply-preview-hint">👆 Click the reply above to insert it into the chat box</div>
    <div class="refinement-options">
      <div class="refinement-label">✨ Adjust tone:</div>
      <div class="refinement-buttons">
        <button class="tone-btn" data-tone="formal">Formal</button>
        <button class="tone-btn" data-tone="friendly">Friendly</button>
        <button class="tone-btn" data-tone="concise">Concise</button>
        <button class="tone-btn" data-tone="sarcastic">Sarcastic</button>
      </div>
    </div>
    <div class="reply-preview-actions">
      <button class="reply-action-btn primary" id="insert-reply">Insert to Chat</button>
      <button class="reply-action-btn regenerate" id="regenerate-reply">🔄 Regenerate</button>
      <button class="reply-action-btn secondary" id="close-preview">Cancel</button>
    </div>
  `;

  shadowRoot.appendChild(previewBox);

  const replyDiv = previewBox.querySelector('#reply-text');
  if (replyDiv) replyDiv.textContent = text;

  setTimeout(() => previewBox.classList.add('show'), 10);

  replyDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    currentInputBox = findChatInputBox() || document.activeElement;
    insertReplyToChat(generatedReplyText);
  });

  previewBox.querySelector('#insert-reply').addEventListener('click', (e) => {
    e.stopPropagation();
    currentInputBox = findChatInputBox() || document.activeElement;
    insertReplyToChat(generatedReplyText);
  });

  previewBox.querySelector('#regenerate-reply').addEventListener('click', (e) => {
    e.stopPropagation();
    previewBox.remove();
    handleGeneration('reply');
  });

  previewBox.querySelector('#close-preview').addEventListener('click', (e) => {
    e.stopPropagation();
    previewBox.remove();
  });

  previewBox.querySelectorAll('.tone-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tone = e.currentTarget.dataset.tone;
      handleRefinement(generatedReplyText, tone);
    });
  });
}

async function insertReplyToChat(text) {
  if (!currentInputBox || !isElementInDOM(currentInputBox)) {
    currentInputBox = findChatInputBox();
  }

  if (!currentInputBox && document.activeElement && isEditableElement(document.activeElement)) {
    currentInputBox = document.activeElement;
  }

  if (!currentInputBox) {
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Text copied to clipboard. Paste it into the chat box (Ctrl+V) to send.');
    } catch (err) {
      showError('Could not find chat input box and copying to clipboard failed. Please copy manually.');
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
      currentInputBox.innerHTML = '';
      const textNode = document.createTextNode(text);
      currentInputBox.appendChild(textNode);
      const range = document.createRange();
      range.selectNodeContents(currentInputBox);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const inputEvent = new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: text, inputType: 'insertText' });
      currentInputBox.dispatchEvent(inputEvent);
      try {
        const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a' });
        currentInputBox.dispatchEvent(ev);
      } catch (e) {}
    } else {
      currentInputBox.textContent = text;
      currentInputBox.focus();
      currentInputBox.dispatchEvent(new Event('input', { bubbles: true }));
      currentInputBox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    currentInputBox.focus();

    const preview = shadowRoot.querySelector('.ai-copilot-reply-preview');
    if (preview) preview.remove();

    showSuccess('Reply inserted! You can now edit or send it.');
    hideAllUI();
  } catch (error) {
    console.error('Error inserting text:', error);
    try {
      await navigator.clipboard.writeText(text);
      showSuccess('Could not insert automatically — text copied to clipboard. Paste (Ctrl+V) into the message box.');
    } catch (err) {
      showError('Failed to insert text. Please copy and paste manually.');
    }
  }
}

// Refinement requests to background (rewriter)
function handleRefinement(text, tone) {
  showLoadingState();

  chrome.runtime.sendMessage(
    { action: 'refine', text: text, tone: tone },
    (response) => {
      hideLoadingState();
      if (response && response.success) {
        generatedReplyText = response.text;
        const replyText = shadowRoot.querySelector('#reply-text');
        if (replyText) {
          replyText.textContent = response.text;
        } else {
          showReplyPreview(response.text);
        }
      } else {
        showError(response?.error || 'Refinement failed');
      }
    }
  );
}

function showSummary(text) {
  const summaryBox = document.createElement('div');
  summaryBox.className = 'ai-copilot-summary';
  summaryBox.innerHTML = `
    <div class="summary-header">📝 Summary</div>
    <div class="summary-content"></div>
    <button class="summary-close">Close</button>
  `;

  shadowRoot.appendChild(summaryBox);
  summaryBox.querySelector('.summary-content').textContent = text;

  summaryBox.querySelector('.summary-close').addEventListener('click', () => {
    summaryBox.remove();
  });

  setTimeout(() => summaryBox.classList.add('show'), 10);
}

function showLoadingState() {
  if (shadowRoot.querySelector('#ai-copilot-loader')) return;
  const loader = document.createElement('div');
  loader.className = 'ai-copilot-loader';
  loader.innerHTML = '<div class="spinner"></div><div>AI is thinking...</div>';
  loader.id = 'ai-copilot-loader';
  shadowRoot.appendChild(loader);
}

function hideLoadingState() {
  const loader = shadowRoot.querySelector('#ai-copilot-loader');
  if (loader) loader.remove();
}

function showError(message) {
  const errorBox = document.createElement('div');
  errorBox.className = 'ai-copilot-error';
  errorBox.textContent = `❌ ${message}`;
  shadowRoot.appendChild(errorBox);
  setTimeout(() => errorBox.remove(), 5000);
}

function showSuccess(message) {
  const successBox = document.createElement('div');
  successBox.className = 'ai-copilot-success';
  successBox.textContent = `✓ ${message}`;
  shadowRoot.appendChild(successBox);
  setTimeout(() => successBox.remove(), 3000);
}

function hideAllUI() {
  const actionButton = shadowRoot.querySelector('.ai-copilot-action-btn');
  if (actionButton) actionButton.remove();
}

// Helpers

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isElementInDOM(el) {
  try {
    return document.contains(el);
  } catch (e) {
    return false;
  }
}

function isEditableElement(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  return false;
}

function setNativeValue(element, value) {
  const tag = (element.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    const prototype = Object.getPrototypeOf(element);
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
  } else {
    try { element.value = value; } catch (e) {}
  }
}

function findChatInputBox() {
  // same detection heuristics as you had before (best-effort)
  let input = document.querySelector('[contenteditable="true"][data-tab="10"]');
  if (input) return input;
  input = document.querySelector('div[contenteditable="true"][role="textbox"]');
  if (input && input.getAttribute('data-tab') === '10') return input;
  input = document.querySelector('[contenteditable="true"][aria-label*="message" i]');
  if (input) return input;
  input = document.querySelector('[contenteditable="true"][role="textbox"]');
  if (input) return input;
  input = document.querySelector('[contenteditable="true"][data-testid="tweetTextarea_0"]');
  if (input) return input;
  input = document.querySelector('[contenteditable="true"][data-testid="dmComposerTextInput"]');
  if (input) return input;
  input = document.querySelector('textarea[placeholder*="message" i]');
  if (input) return input;
  const candidates = document.querySelectorAll('[contenteditable="true"]');
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.height > 20 && rect.width > 100 && el.offsetParent !== null) {
      return el;
    }
  }
  const textareas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
  if (textareas.length) return textareas[0];
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(i => i.offsetParent !== null);
  if (inputs.length) return inputs[0];
  return null;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

