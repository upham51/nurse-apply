(function () {
  'use strict';
  const NA = self.NA;
  const $ = (s) => document.querySelector(s);

  function activeTab() {
    return new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
  }

  /** Broadcast, since the pill may live in an iframe rather than frame 0. */
  function sendToTab(tabId, msg) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, msg, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res);
      });
    });
  }

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res);
      });
    });
  }

  function originOf(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.origin + '/*';
    } catch (e) { return null; }
  }

  function hasPermission(origin) {
    return new Promise((resolve) =>
      chrome.permissions.contains({ origins: [origin] }, (ok) => resolve(!!ok && !chrome.runtime.lastError)));
  }

  function requestPermission(origin) {
    return new Promise((resolve) =>
      chrome.permissions.request({ origins: [origin] }, (ok) => resolve(!!ok && !chrome.runtime.lastError)));
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
      $('#enable-wrap').classList.add('hidden');
    } else {
      // Nothing answered. That is either a site NurseApply does not cover, or
      // one it does cover that has not finished loading. Offering to "turn on"
      // a site that is already covered is worse than useless: the permission is
      // already held, so nothing is asked, and the injection lands on top of a
      // content script that is already there.
      const origin = tab ? originOf(tab.url) : null;
      const covered = tab ? await send({ type: 'sites:covered', origin, url: tab.url }) : null;

      if (covered && covered.covered) {
        $('#where').textContent = 'Supported here, but nothing has loaded yet';
        $('#enable-wrap').classList.remove('hidden');
        $('#enable').textContent = 'Start it on this page';
        $('#enable-note').textContent =
          'Workday and iCIMS build the form after the page loads, so this can take a moment. ' +
          'If it stays quiet, reload the page.';
        $('#enable').addEventListener('click', async () => {
          $('#enable').disabled = true;
          $('#enable').textContent = 'Starting…';
          const res = await send({ type: 'sites:inject', tabId: tab.id });
          if (res && res.ok && res.alreadyRunning) {
            $('#enable-note').textContent =
              'It is already running on this page. If there is no pill, the form may not have rendered yet.';
            $('#enable').textContent = 'Already running';
          } else if (res && res.ok) {
            window.close();
          } else {
            $('#enable').disabled = false;
            $('#enable').textContent = 'Start it on this page';
            $('#enable-note').textContent = (res && res.error) || 'Could not start it. Reload the page.';
          }
        });
      } else if (!origin) {
        $('#where').textContent = 'NurseApply cannot run on this kind of page';
        $('#enable-wrap').classList.add('hidden');
      } else {
        const already = await hasPermission(origin);
        const host = new URL(tab.url).hostname;
        $('#where').textContent = already
          ? 'Enabled here, but nothing has loaded yet'
          : 'Not switched on for this site yet';
        $('#enable-wrap').classList.remove('hidden');
        $('#enable-host').textContent = host;
        $('#enable').textContent = already ? 'Start it on this page' : 'Turn on for ' + host;
        $('#enable').addEventListener('click', async () => {
          $('#enable').disabled = true;
          $('#enable').textContent = 'Asking…';
          const granted = already || await requestPermission(origin);
          if (!granted) {
            $('#enable').disabled = false;
            $('#enable').textContent = 'Turn on for ' + host;
            $('#enable-note').textContent = 'Chrome declined that. You can also allow it from the extension\u2019s details page.';
            return;
          }
          await send({ type: 'sites:sync' });
          const injected = await send({ type: 'sites:inject', tabId: tab.id });
          if (injected && injected.ok) {
            window.close();
          } else {
            $('#enable-note').textContent = 'Turned on. Reload the page to start it.';
            $('#enable').textContent = 'Done';
          }
        });
      }
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
