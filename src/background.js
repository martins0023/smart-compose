// background.js
// Background Service Worker — manages Built-in Chrome AI origin-trial model session,
// exposes initialization & status, and handles analyze/generate/refine messages.

let _lmSession = null;
let _lmType = null; // 'originTrial' | 'windowAI' | 'chromeAI'
let _isInitializing = false;

// Write status to storage helper
function setBuiltinStatus(status, progress = null, message = null) {
  const data = { builtinAIStatus: status, builtinAIProgress: progress, builtinAIMessage: message };
  chrome.storage.local.set(data);
}

// Detect available built-in API entrypoint
function detectBuiltInAPI() {
  if (typeof chrome !== 'undefined' && chrome.aiOriginTrial && chrome.aiOriginTrial.languageModel) {
    return 'originTrial';
  }
  if (typeof chrome !== 'undefined' && chrome.ai && (typeof chrome.ai.prompt === 'function' || typeof chrome.ai.write === 'function')) {
    return 'chromeAI';
  }
  if (typeof self !== 'undefined' && self.ai && (self.ai.languageModel || typeof self.ai.prompt === 'function')) {
    return 'windowAI';
  }
  return null;
}

// Check quickly if builtin is present (no model readiness check)
function isBuiltInAPIAvailable() {
  try {
    return !!detectBuiltInAPI();
  } catch (e) {
    return false;
  }
}

// Ensure language model is ready - creates session and waits for availability
async function ensureLanguageModelReady({interactive = false} = {}) {
  if (_lmSession) {
    // Try to check availability
    try {
      if (_lmType === 'originTrial') {
        const avail = await chrome.aiOriginTrial.languageModel.availability();
        if (avail && (avail.available || avail.deviceAvailable)) return _lmSession;
      } else if (_lmType === 'windowAI') {
        const avail = await self.ai.languageModel.availability();
        if (avail && (avail.available || avail.deviceAvailable)) return _lmSession;
      } else {
        return _lmSession; // chrome.ai fallback
      }
    } catch (err) {
      console.warn('availability check error, will try recreate:', err);
    }
  }

  const detected = detectBuiltInAPI();
  if (!detected) {
    setBuiltinStatus('not_available', 0, 'No built-in API detected');
    throw new Error('Chrome Built-in AI APIs not available in this browser/profile.');
  }
  _lmType = detected;

  // Set initializing flag
  if (_isInitializing) {
    // If another init is running, wait until storage state changes to ready or error
    // simple busy-wait: poll storage
    return new Promise((resolve, reject) => {
      const poll = setInterval(() => {
        chrome.storage.local.get(['builtinAIStatus'], (res) => {
          const s = res.builtinAIStatus;
          if (s === 'ready') {
            clearInterval(poll);
            resolve(_lmSession);
          } else if (s === 'error' || s === 'not_available') {
            clearInterval(poll);
            reject(new Error('Initialization failed or unavailable'));
          }
        });
      }, 500);
    });
  }

  _isInitializing = true;
  setBuiltinStatus('initializing', 0, 'Starting model session');

  try {
    if (_lmType === 'originTrial') {
      // Create session and monitor download progress
      _lmSession = await chrome.aiOriginTrial.languageModel.create({
        monitor: (monitor) => {
          monitor.addEventListener('downloadprogress', (ev) => {
            try {
              // ev may contain loaded/total or percent; best-effort parse
              const loaded = ev.loaded || 0;
              const total = ev.total || 1;
              const pct = Math.min(100, Math.round((loaded / Math.max(1, total)) * 100));
              setBuiltinStatus('downloading', pct, `Downloading model: ${pct}%`);
            } catch (e) {
              setBuiltinStatus('downloading', null, 'Downloading model...');
            }
          });
          monitor.addEventListener('statechange', (ev) => {
            // statechange events vary by runtime; inspect for better messages
            if (ev?.state) {
              setBuiltinStatus('downloading', null, `State: ${ev.state}`);
            }
          });
        }
      });

      // After create, check availability
      const avail = await chrome.aiOriginTrial.languageModel.availability();
      if (!avail || !(avail.available || avail.deviceAvailable)) {
        setBuiltinStatus('downloading', 0, 'Waiting for model download/installation');
        // Wait until availability becomes true — poll small intervals
        const ready = await waitForAvailabilityOriginTrial(60 * 10); // up to 10 minutes
        if (!ready) {
          _isInitializing = false;
          setBuiltinStatus('error', null, 'Model not available after waiting');
          throw new Error('Language model not available after download timeout');
        }
      }
      // Ready
      setBuiltinStatus('ready', 100, 'Built-in model ready');
      _isInitializing = false;
      return _lmSession;
    }

    // windowAI path (site-level API)
    if (_lmType === 'windowAI') {
      _lmSession = await self.ai.languageModel.create();
      const avail = await self.ai.languageModel.availability();
      if (!avail || !(avail.available || avail.deviceAvailable)) {
        setBuiltinStatus('downloading', 0, 'Waiting for model download/installation');
        const ready = await waitForAvailabilityWindowAI(60 * 10);
        if (!ready) {
          _isInitializing = false;
          setBuiltinStatus('error', null, 'Model not available after waiting');
          throw new Error('Language model not available after download timeout');
        }
      }
      setBuiltinStatus('ready', 100, 'Built-in model ready');
      _isInitializing = false;
      return _lmSession;
    }

    // chrome.ai path fallback
    if (_lmType === 'chromeAI') {
      _lmSession = chrome.ai;
      setBuiltinStatus('ready', 100, 'chrome.ai available');
      _isInitializing = false;
      return _lmSession;
    }

    throw new Error('Unsupported builtin AI path');
  } catch (err) {
    _isInitializing = false;
    setBuiltinStatus('error', null, String(err.message || err));
    throw err;
  }
}

// Helper: poll availability for originTrial
async function waitForAvailabilityOriginTrial(timeoutSeconds = 600) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSeconds) {
    try {
      const avail = await chrome.aiOriginTrial.languageModel.availability();
      if (avail && (avail.available || avail.deviceAvailable)) return true;
    } catch (e) {
      // ignore
    }
    await delay(1500);
  }
  return false;
}

// Helper: poll availability for windowAI
async function waitForAvailabilityWindowAI(timeoutSeconds = 600) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSeconds) {
    try {
      const avail = await self.ai.languageModel.availability();
      if (avail && (avail.available || avail.deviceAvailable)) return true;
    } catch (e) {}
    await delay(1500);
  }
  return false;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generic builtin prompt wrapper (supports different runtime shapes)
async function builtinPrompt({ instructions, responseFormat = 'text', multimodalInputs } = {}) {
  // ensure ready (will create session & download if needed)
  await ensureLanguageModelReady();

  // originTrial session
  if (_lmType === 'originTrial' && _lmSession) {
    // Prefer session.prompt if available
    if (typeof _lmSession.prompt === 'function') {
      const resp = await _lmSession.prompt({ instructions, responseFormat, multimodalInputs });
      return resp;
    }
    // fallback to chrome.aiOriginTrial.prompt
    if (chrome.aiOriginTrial && typeof chrome.aiOriginTrial.prompt === 'function') {
      const resp = await chrome.aiOriginTrial.prompt({ instructions, responseFormat, multimodalInputs });
      return resp;
    }
  }

  // windowAI
  if (_lmType === 'windowAI') {
    if (self.ai && typeof self.ai.languageModel?.prompt === 'function') {
      const resp = await self.ai.languageModel.prompt({ instructions, responseFormat, multimodalInputs });
      return resp;
    }
    if (self.ai && typeof self.ai.prompt === 'function') {
      const resp = await self.ai.prompt({ instructions, responseFormat, multimodalInputs });
      return resp;
    }
  }

  // chrome.ai fallback
  if (_lmType === 'chromeAI' && _lmSession) {
    if (typeof _lmSession.write === 'function') {
      const resp = await _lmSession.write({ instructions, maxLength: 512, multimodalInputs });
      return resp;
    }
    if (typeof _lmSession.prompt === 'function') {
      const resp = await _lmSession.prompt({ instructions, responseFormat, multimodalInputs });
      return resp;
    }
  }

  throw new Error('Failed to call builtin prompt/write API after session ready.');
}

/* ----------------- Message handlers ----------------- */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      // Built-in control messages
      if (request.action === 'initBuiltinAI') {
        // Trigger initialization (interactive false — but will create session & monitor)
        try {
          setBuiltinStatus('initializing', 0, 'Starting initialization');
          await ensureLanguageModelReady({ interactive: true });
          sendResponse({ success: true, status: 'ready' });
        } catch (err) {
          sendResponse({ error: 'init_failed', message: err.message || String(err) });
        }
        return;
      }

      if (request.action === 'getBuiltinStatus') {
        chrome.storage.local.get(['builtinAIStatus', 'builtinAIProgress', 'builtinAIMessage'], (res) => {
          sendResponse({ success: true, status: res.builtinAIStatus || 'unknown', progress: res.builtinAIProgress || 0, message: res.builtinAIMessage || '' });
        });
        return;
      }

      // Analysis/generate/refine messages use builtin APIs
      if (['analyze', 'generate', 'refine'].includes(request.action) && !isBuiltInAPIAvailable()) {
        sendResponse({ error: 'NOT_AVAILABLE', message: 'Chrome Built-in AI APIs not available in this browser/profile.' });
        return;
      }

      // ANALYZE
      if (request.action === 'analyze') {
        const instructions = `
Analyze the following message and return JSON with keys:
- emotion: one-word tone (e.g., Happy, Anxious, Upset, Neutral, Excited, Frustrated)
- intent: one-word intent (Request, Question, Statement, Complaint, Invitation)
- suggestedAction: short suggestion (e.g., "Generate Confirmation Reply", "Generate Supportive Reply", "Generate Question Response")

Respond ONLY with JSON.

Message: ${request.text || ''}
`;
        try {
          const resp = await builtinPrompt({ instructions, responseFormat: 'json', multimodalInputs: request.image ? [{ type: 'image', dataUrl: request.image }] : undefined });
          // resp may be object (structuredOutput) or text — normalize
          if (resp && typeof resp === 'object') {
            const structured = resp.structuredOutput || resp;
            sendResponse({ success: true, analysis: structured });
            return;
          }
          const raw = String(resp || '');
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              sendResponse({ success: true, analysis: parsed });
              return;
            } catch (e) {}
          }
          sendResponse({ success: true, analysis: { emotion: 'Neutral', intent: 'Statement', suggestedAction: 'Generate Reply' }});
        } catch (err) {
          sendResponse({ error: err.message || String(err) });
        }
        return;
      }

      // GENERATE
      if (request.action === 'generate') {
        try {
          let instructions = '';
          const type = request.type || 'reply';
          if (type === 'reply' || type === 'confirmation' || type === 'supportive') {
            const ctx = request.context || {};
            const toneHint = ctx.emotion ? `The message tone is ${ctx.emotion}.` : '';
            const intentHint = ctx.intent ? `Detected intent: ${ctx.intent}.` : '';
            instructions = `You are a helpful assistant. ${toneHint} ${intentHint}\nGenerate a single reply to the following message. Keep it natural and conversational. Keep it short to medium length.\n\nMessage: ${request.text}\n\nReply:`;
          } else if (type === 'summarize') {
            instructions = `Provide a concise 1-2 sentence summary of the following text:\n\n${request.text}\n\nSummary:`;
          } else {
            instructions = `Write a helpful reply for the following message:\n\n${request.text}\n\nReply:`;
          }

          const resp = await builtinPrompt({ instructions, responseFormat: 'text', multimodalInputs: request.image ? [{ type: 'image', dataUrl: request.image }] : undefined });
          const text = (resp?.text ?? resp?.result ?? String(resp || '')).toString();
          sendResponse({ success: true, text: text });
        } catch (err) {
          sendResponse({ error: err.message || String(err) });
        }
        return;
      }

      // REFINEMENT
      if (request.action === 'refine') {
        try {
          const tone = request.tone || 'formal';
          const toneMap = {
            formal: 'Rewrite to be formal and professional.',
            friendly: 'Rewrite to be more friendly and casual.',
            concise: 'Rewrite to be concise and to the point.',
            sarcastic: 'Rewrite to be slightly sarcastic while staying appropriate.'
          };
          const instruction = `${toneMap[tone] || `Rewrite to match tone: ${tone}.`}\n\nOriginal: ${request.text}\n\nRewritten:`;
          const resp = await builtinPrompt({ instructions: instruction, responseFormat: 'text' });
          const text = (resp?.text ?? resp?.result ?? String(resp || '')).toString();
          sendResponse({ success: true, text });
        } catch (err) {
          sendResponse({ error: err.message || String(err) });
        }
        return;
      }

      // unknown
      sendResponse({ error: 'Unknown action' });
    } catch (err) {
      console.error('background.onMessage top error', err);
      sendResponse({ error: err?.message || String(err) });
    }
  })();
  return true; // keep message channel open
});

/* ----------------- store initial builtin status ----------------- */
// initialize state if absent
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['builtinAIStatus'], (res) => {
    if (!res.builtinAIStatus) {
      setBuiltinStatus('not_initialized', 0, 'Not initialized');
    }
  });
});
