(function () {
  'use strict';
  const NA = self.NA;
  const $ = (s) => document.querySelector(s);

  function activeTab() {
    return new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
  }

  function sendToTab(tabId, msg) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res);
      });
    });
  }

  (async function boot() {
    const tab = await activeTab();
    const stats = await NA.storage.getStats();
    const tracker = await NA.storage.getTracker();

    $('#stats').innerHTML =
      `<b>${stats.filled}</b> fields filled across <b>${tracker.length}</b> application` +
      `${tracker.length === 1 ? '' : 's'}.`;

    const status = tab ? await sendToTab(tab.id, { type: 'na:command', command: 'status' }) : null;
    if (status && status.ok) {
      const s = status.state;
      $('#where').textContent = [s.adapter, s.step].filter(Boolean).join(' · ') || 'Ready on this page';
    } else {
      $('#where').textContent = 'No supported application form on this tab';
      $('#fill').disabled = true;
      $('#clear').disabled = true;
    }

    $('#fill').addEventListener('click', async () => {
      await sendToTab(tab.id, { type: 'na:command', command: 'fill' });
      window.close();
    });
    $('#clear').addEventListener('click', async () => {
      await sendToTab(tab.id, { type: 'na:command', command: 'clear' });
      window.close();
    });
    $('#profile').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
    $('#tracker').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/tracker/tracker.html') });
      window.close();
    });
  })();
})();
