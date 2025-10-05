// background.js
// Service worker that calls Gemini (Google Generative Language API) using API key or optional proxy.
// Also stores API key and proxyUrl in chrome.storage.local and tracks simple usage counts.

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash-exp'; // change if you want another model
const SOFT_DAILY_LIMIT = 200; // soft limit for UI warning (adjust as needed)
const USAGE_KEY = 'dailyUsage';
const API_KEY_STORAGE = 'geminiApiKey';
const PROXY_URL_STORAGE = 'proxyUrl';

// utility: wrap chrome.storage.local.get in a Promise
function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, res => resolve(res || {}));
  });
}
function storageSet(obj) {
  return new Promise(resolve => {
    chrome.storage.local.set(obj, () => resolve());
  });
}

// increments the simple usage counter for today
async function incrementUsage() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const stored = (await storageGet([USAGE_KEY]))[USAGE_KEY] || {};
  if (stored.date !== today) {
    stored.date = today;
    stored.count = 0;
  }
  stored.count = (stored.count || 0) + 1;
  await storageSet({ [USAGE_KEY]: stored });
  return stored;
}

// Read API config
async function getApiConfig() {
  const res = await storageGet([API_KEY_STORAGE, PROXY_URL_STORAGE]);
  return {
    apiKey: (res[API_KEY_STORAGE] || '').trim() || null,
    proxyUrl: (res[PROXY_URL_STORAGE] || '').trim() || null
  };
}

// call Gemini directly with API key
async function callGeminiWithApiKey(apiKey, model, prompt, generationConfig = {}) {
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Keep a conservative generationConfig if none provided
  const finalGen = Object.assign({
    temperature: 0.7,
    maxOutputTokens: 512
  }, generationConfig);

  const body = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: finalGen
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    // Try parse JSON message
    try {
      const j = JSON.parse(text);
      throw new Error(j.error?.message || JSON.stringify(j));
    } catch (e) {
      throw new Error(`API call failed (${response.status}): ${text}`);
    }
  }

  const data = JSON.parse(text);
  // Defensive: find text in candidates
  const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (candidate) return candidate;
  // fallback: try result fields
  if (typeof data?.result === 'string') return data.result;
  // fallback: stringify
  return JSON.stringify(data);
}

// call user's proxy (if set) — expects proxy to accept { prompt, model, generationConfig } and return { success: true, text }
async function callProxy(proxyUrl, model, prompt, generationConfig = {}) {
  const body = { prompt, model, generationConfig };
  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Proxy error (${response.status}): ${txt}`);
  }
  const data = await response.json();
  if (!data || !data.success) {
    throw new Error(`Proxy returned failure: ${JSON.stringify(data)}`);
  }
  return data.text;
}

// wrapper: choose proxy or direct API key
async function callBackend(model, prompt, generationConfig = {}) {
  const { apiKey, proxyUrl } = await getApiConfig();

  if (proxyUrl) {
    return await callProxy(proxyUrl, model, prompt, generationConfig);
  }

  if (!apiKey) throw new Error('No API key configured. Please set your Google AI Studio API key in the extension popup.');

  return await callGeminiWithApiKey(apiKey, model, prompt, generationConfig);
}

// message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      // save API key
      if (request.action === 'saveApiKey') {
        // store but **do not** echo back key value
        await storageSet({ [API_KEY_STORAGE]: request.apiKey });
        sendResponse({ success: true });
        return;
      }

      // set proxy url
      if (request.action === 'setProxyUrl') {
        await storageSet({ [PROXY_URL_STORAGE]: request.proxyUrl || '' });
        sendResponse({ success: true });
        return;
      }

      // get config (for popup)
      if (request.action === 'getConfig') {
        const res = await getApiConfig();
        const usage = (await storageGet([USAGE_KEY]))[USAGE_KEY] || { date: null, count: 0 };
        sendResponse({ success: true, apiKeySet: !!res.apiKey, proxyUrl: res.proxyUrl || '', usage, softLimit: SOFT_DAILY_LIMIT });
        return;
      }

      // analyze
      if (request.action === 'analyze') {
        const prompt = `Analyze the following message and provide:
1. The emotional tone (e.g., Happy, Anxious, Upset, Neutral, Excited, Frustrated)
2. The sender's intent (e.g., Request, Question, Statement, Complaint, Invitation)
3. A suggested action (e.g., "Generate Confirmation Reply", "Generate Supportive Reply", "Generate Question Response")

Respond in JSON format:
{
  "emotion": "detected emotion",
  "intent": "detected intent",
  "suggestedAction": "action suggestion"
}

Message: "${request.text}"`;
        try {
          const raw = await callBackend(DEFAULT_MODEL, prompt, { temperature: 0.0, maxOutputTokens: 256 });
          // attempt to parse JSON from response
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          let analysis;
          if (jsonMatch) {
            try { analysis = JSON.parse(jsonMatch[0]); }
            catch (e) { analysis = null; }
          }
          if (!analysis) {
            analysis = { emotion: 'Neutral', intent: 'Statement', suggestedAction: 'Generate Reply' };
          }
          // increment usage
          await incrementUsage();
          sendResponse({ success: true, analysis });
        } catch (err) {
          console.error('analyze error', err);
          sendResponse({ error: err.message || String(err) });
        }
        return;
      }

      // generate
      if (request.action === 'generate') {
        try {
          let instructions;
          const type = request.type || 'reply';
          if (type === 'reply') {
            const context = request.context || {};
            const ctx = context.emotion ? `Tone: ${context.emotion}.` : '';
            const it = context.intent ? `Intent: ${context.intent}.` : '';
            instructions = `Generate a thoughtful, contextually appropriate reply to the following message. Keep it natural and conversational. ${ctx} ${it}

Message:
${request.text}

Reply:`;
          } else if (type === 'summarize') {
            instructions = `Provide a concise summary (1-2 sentences) of the following text:

${request.text}

Summary:`;
          } else if (type === 'confirmation') {
            instructions = `Generate a brief, friendly confirmation reply to the following message:

${request.text}

Reply:`;
          } else if (type === 'supportive') {
            instructions = `Generate a warm, supportive reply to the following message:

${request.text}

Reply:`;
          } else {
            instructions = `Generate a reply:\n${request.text}\n\nReply:`;
          }

          const raw = await callBackend(DEFAULT_MODEL, instructions, { temperature: 0.7, maxOutputTokens: 512 });
          await incrementUsage();
          sendResponse({ success: true, text: raw.trim() });
        } catch (err) {
          console.error('generate error', err);
          sendResponse({ error: err.message || String(err) });
        }
        return;
      }

      // refine
      if (request.action === 'refine') {
        try {
          const tone = request.tone || 'formal';
          const toneInstructions = {
            formal: 'Rewrite the following message to be more formal and professional.',
            friendly: 'Rewrite the following message to be more friendly and casual.',
            concise: 'Rewrite the following message to be more concise and to the point.',
            sarcastic: 'Rewrite the following message to be slightly sarcastic while remaining appropriate.'
          };
          const instruction = `${toneInstructions[tone] || 'Rewrite with a different tone.'}

Original:
${request.text}

Rewritten:`;
          const raw = await callBackend(DEFAULT_MODEL, instruction, { temperature: 0.4, maxOutputTokens: 512 });
          await incrementUsage();
          sendResponse({ success: true, text: raw.trim() });
        } catch (err) {
          console.error('refine error', err);
          sendResponse({ error: err.message || String(err) });
        }
        return;
      }

      sendResponse({ error: 'Unknown action' });
    } catch (err) {
      console.error('background top-level error', err);
      sendResponse({ error: err.message || String(err) });
    }
  })();
  return true; // keep channel open for async response
});

// initialize storage defaults
chrome.runtime.onInstalled.addListener(async () => {
  const cur = await storageGet([USAGE_KEY]);
  if (!cur[USAGE_KEY]) {
    await storageSet({ [USAGE_KEY]: { date: new Date().toISOString().slice(0,10), count: 0 } });
  }
});
