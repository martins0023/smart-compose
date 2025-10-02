// ai-bridge.js
// Runs in the page context (NOT the extension isolated content-script context).
// Listens for messages from the content script (source: 'ai-content') and
// sends responses back (source: 'ai-bridge-response').

(() => {
  const BRIDGE_IN = 'ai-content';
  const BRIDGE_OUT = 'ai-bridge-response';

  let lmSession = null; // LanguageModel session for Prompt API
  async function ensureSession() {
    if (lmSession) return lmSession;

    if (typeof LanguageModel === 'undefined') {
      throw new Error('Prompt API (LanguageModel) not available in this context.');
    }

    const available = await LanguageModel.availability();
    if (available === 'unavailable') {
      throw new Error('No local model available on this device (LanguageModel.availability() === unavailable).');
    }

    // create() will start model download if necessary; a user gesture is required for download in many cases
    lmSession = await LanguageModel.create();
    return lmSession;
  }

  async function handleAnalyze({ text, requestId }) {
    const session = await ensureSession();
    // structured JSON schema output
    const schema = {
      type: 'object',
      properties: {
        emotion: { type: 'string' },
        intent: { type: 'string' },
        suggestedAction: { type: 'string' }
      }
    };

    // Ask model to emit only JSON — omitResponseConstraintInput to avoid returning schema as text
    const result = await session.prompt(
      `Analyze the following message and return a JSON object containing emotion, intent and suggestedAction.\n\nMessage:\n${text}`,
      { responseConstraint: schema, omitResponseConstraintInput: true }
    );

    // result is a JSON string like {"emotion":"..." ...}
    let parsed;
    try { parsed = JSON.parse(result); } catch (e) {
      // fallback to heuristic
      parsed = { emotion: 'Neutral', intent: 'Statement', suggestedAction: 'Generate Reply' };
    }

    post({ requestId, success: true, analysis: parsed });
  }

  async function handleGenerate({ text, type, context, requestId }) {
    const session = await ensureSession();
    let prompt = '';
    if (type === 'summarize') {
      // fallback: summarizer should be used, but keep generic prompt fallback
      prompt = `Summarize the following text in 1-2 sentences:\n\n${text}`;
    } else if (type === 'confirmation') {
      prompt = `Generate a brief, friendly confirmation reply to the following message:\n\n${text}\n\nReply:`;
    } else if (type === 'supportive') {
      prompt = `Generate a warm, supportive reply to the following message:\n\n${text}\n\nReply:`;
    } else { // 'reply' default
      const ctx = context ? `Context: The message has a ${context.emotion || 'Neutral'} tone and appears to be a ${context.intent || 'Statement'}.\n\n` : '';
      prompt = `${ctx}Generate a thoughtful, contextually appropriate reply to the following message. Keep it natural and conversational.\n\nMessage:\n${text}\n\nReply:`;
    }

    const response = await session.prompt(prompt);
    post({ requestId, success: true, text: response });
  }

  async function handleRefine({ text, tone, requestId }) {
    const session = await ensureSession();
    const toneInstructions = {
      formal: 'rewrite to be more formal and professional',
      friendly: 'rewrite to be more friendly and casual',
      concise: 'rewrite to be more concise and to the point',
      sarcastic: 'rewrite to be slightly sarcastic but appropriate'
    };
    const instruction = toneInstructions[tone] || `rewrite with a ${tone} tone`;
    const prompt = `Rewrite the following message to make it ${instruction}, while preserving meaning:\n\nOriginal:\n${text}\n\nRewritten:`;
    const response = await session.prompt(prompt);
    post({ requestId, success: true, text: response });
  }

  async function handleSummarize({ text, requestId }) {
    try {
      if (typeof Summarizer !== 'undefined') {
        const avail = await Summarizer.availability();
        if (avail === 'unavailable') {
          throw new Error('Summarizer API unavailable on this device.');
        }
        const summ = await Summarizer.create({ length: 'short', type: 'tl;dr', format: 'text' });
        const out = await summ.summarize(text);
        await summ.destroy();
        post({ requestId, success: true, text: out });
        return;
      }
    } catch (e) {
      // continue to fallback to Prompt API
      console.warn('Summarizer API failed, falling back to Prompt API:', e);
    }

    // Fallback summarization via Prompt API
    const session = await ensureSession();
    const prompt = `Provide a concise 1-2 sentence summary of the following text:\n\n${text}`;
    const response = await session.prompt(prompt);
    post({ requestId, success: true, text: response });
  }

  function post(obj) {
    window.postMessage(Object.assign({ source: BRIDGE_OUT }, obj), '*');
  }

  // listen for messages from content script (which will post message with source 'ai-content')
  window.addEventListener('message', (ev) => {
    try {
      const msg = ev.data;
      if (!msg || msg.source !== BRIDGE_IN) return;
      const { action, requestId } = msg;
      if (action === 'analyze') {
        handleAnalyze(msg).catch(err => post({ requestId, success: false, error: String(err) }));
      } else if (action === 'generate') {
        handleGenerate(msg).catch(err => post({ requestId, success: false, error: String(err) }));
      } else if (action === 'refine') {
        handleRefine(msg).catch(err => post({ requestId, success: false, error: String(err) }));
      } else if (action === 'summarize') {
        handleSummarize(msg).catch(err => post({ requestId, success: false, error: String(err) }));
      } else {
        post({ requestId, success: false, error: 'Unknown action' });
      }
    } catch (err) {
      // ensure no uncaught errors
      console.error('ai-bridge error', err);
    }
  });

  // small readiness ping so content script can verify injection
  post({ requestId: 'bridge-ready', success: true, message: 'ai-bridge injected' });
})();
