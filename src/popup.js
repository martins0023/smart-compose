// popup.js - communicates with background.js to show builtin AI status and init
document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const initBtn = document.getElementById('initBtn');
  const openLogs = document.getElementById('openLogs');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');

  function refreshStatus() {
    chrome.runtime.sendMessage({ action: 'getBuiltinStatus' }, (res) => {
      if (!res || res.error) {
        statusDiv.textContent = 'No response from background';
        return;
      }
      const { status, progress, message } = res;
      statusDiv.textContent = `${status}${message ? ' — ' + message : ''}`;
      if (status === 'downloading' || status === 'initializing') {
        initBtn.disabled = true;
        progressBar.style.display = 'block';
        progressFill.style.width = (progress ?? 0) + '%';
      } else if (status === 'ready') {
        initBtn.disabled = true;
        progressBar.style.display = 'block';
        progressFill.style.width = '100%';
      } else {
        initBtn.disabled = false;
        progressBar.style.display = 'none';
      }
    });
  }

  initBtn.addEventListener('click', () => {
    initBtn.disabled = true;
    statusDiv.textContent = 'Initializing... this may take several minutes while the model downloads.';
    chrome.runtime.sendMessage({ action: 'initBuiltinAI' }, (res) => {
      if (res && res.success) {
        statusDiv.textContent = 'Initialization started — downloading model.';
      } else {
        statusDiv.textContent = `Initialization failed: ${res?.message || res?.error || 'unknown'}`;
        initBtn.disabled = false;
      }
    });
  });

  openLogs.addEventListener('click', () => {
    // Convenience: open the service worker console for the extension
    // (Users can open chrome://extensions and click 'Service worker' -> Inspect)
    alert('Open chrome://extensions, find this extension, click "Service worker" -> Inspect to view logs.');
  });

  // Watch storage changes for progress updates
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.builtinAIStatus || changes.builtinAIProgress || changes.builtinAIMessage) {
      refreshStatus();
    }
  });

  // Initial
  refreshStatus();
});
