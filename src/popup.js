// popup.js
const API_KEY_INPUT = document.getElementById('apiKey');
const PROXY_INPUT = document.getElementById('proxyUrl');
const STATUS_DIV = document.getElementById('status');
const SAVE_BTN = document.getElementById('saveBtn');
const USAGE_BLOCK = document.getElementById('usageBlock');
const USAGE_FILL = document.getElementById('usageFill');
const USAGE_TEXT = document.getElementById('usageText');
const WARN_SOFT = document.getElementById('warnSoft');
const RESET_USAGE_BTN = document.getElementById('resetUsageBtn');

const SOFT_LIMIT = 200; // keep in sync with background SOFT_DAILY_LIMIT

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 12) return key;
  return key.substring(0, 8) + '...' + key.substring(key.length-4);
}

async function refresh() {
  STATUS_DIV.textContent = 'Checking saved config...';
  chrome.runtime.sendMessage({ action: 'getConfig' }, (res) => {
    if (!res || !res.success) {
      STATUS_DIV.textContent = 'Could not read config';
      return;
    }
    API_KEY_INPUT.value = res.apiKeySet ? maskKey('************') : '';
    PROXY_INPUT.value = res.proxyUrl || '';
    STATUS_DIV.textContent = res.apiKeySet ? 'API key is set' : 'API key not set';
    // usage display
    const usage = res.usage || { date: null, count: 0 };
    USAGE_BLOCK.style.display = 'block';
    const pct = Math.min(100, Math.round((usage.count / (res.softLimit || SOFT_LIMIT)) * 100));
    USAGE_FILL.style.width = pct + '%';
    USAGE_TEXT.textContent = `${usage.count || 0} / ${res.softLimit || SOFT_LIMIT} requests today (${usage.date || ''})`;
    if ((usage.count || 0) >= Math.round((res.softLimit || SOFT_LIMIT) * 0.85)) {
      WARN_SOFT.style.display = 'block';
      WARN_SOFT.textContent = `Warning: usage approaching soft daily limit (${res.softLimit || SOFT_LIMIT}). You may exhaust free/quota credits.`;
    } else {
      WARN_SOFT.style.display = 'none';
    }
  });
}

SAVE_BTN.addEventListener('click', async () => {
  const rawKey = API_KEY_INPUT.value.trim();
  const proxy = PROXY_INPUT.value.trim();

  // if key appears masked, don't overwrite (user didn't intend to change)
  const isMasked = rawKey.includes('...') || rawKey === '************';
  if (rawKey && !isMasked) {
    // Save the raw key
    chrome.runtime.sendMessage({ action: 'saveApiKey', apiKey: rawKey }, (res) => {
      if (res && res.success) {
        STATUS_DIV.textContent = 'API key saved';
        API_KEY_INPUT.value = maskKey(rawKey);
      } else {
        STATUS_DIV.textContent = 'Failed to save API key';
      }
    });
  } else if (!rawKey && !proxy) {
    // nothing to do, maybe clearing keys? allow clearing proxy
    // do not clear API key if user left it masked
    STATUS_DIV.textContent = 'No changes to API key';
  }

  // Save proxy (can be empty)
  chrome.runtime.sendMessage({ action: 'setProxyUrl', proxyUrl: proxy }, (res) => {
    if (res && res.success) {
      STATUS_DIV.textContent = 'Settings saved';
    } else {
      STATUS_DIV.textContent = 'Settings saved (proxy may not be valid)';
    }
    // refresh info
    setTimeout(refresh, 400);
  });
});

RESET_USAGE_BTN.addEventListener('click', async () => {
  chrome.storage.local.get(['dailyUsage'], (res) => {
    const today = new Date().toISOString().slice(0,10);
    chrome.storage.local.set({ dailyUsage: { date: today, count: 0 } }, () => {
      refresh();
    });
  });
});

// On load
document.addEventListener('DOMContentLoaded', refresh);
