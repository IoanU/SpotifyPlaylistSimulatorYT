// background.js

let list     = [];
let idx      = 0;
let ytTabId  = null;
let shuffle  = false;

// helper sleep
const sleep = ms => new Promise(r => setTimeout(r, ms));

// persist / restore state + shuffle + ytTabId
async function saveState() {
  await chrome.storage.local.set({
    trackList: list,
    currentIdx: idx,
    ytTabId: ytTabId,
    shuffle: shuffle
  });
}
async function loadState() {
  const data = await new Promise(r =>
    chrome.storage.local.get(['trackList','currentIdx','ytTabId','shuffle'], r)
  );
  if (Array.isArray(data.trackList)) {
    list     = data.trackList;
    idx      = typeof data.currentIdx === 'number' ? data.currentIdx : 0;
    shuffle  = !!data.shuffle;
  }
  if (typeof data.ytTabId === 'number') {
    ytTabId = data.ytTabId;
  }
}

// detect tab close and stop playback
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === ytTabId) {
    chrome.alarms.clear('nextTrack');
    ytTabId = null;
    list    = [];
    idx     = 0;
    chrome.storage.local.remove(['trackList','currentIdx','ytTabId']);
  }
});

// handler Alarms API for autoplay
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'nextTrack') return;
  if (!list.length) await loadState();
  play();
});

// build playlist at START
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.action !== 'start') return false;
  (async () => {
    try {
      // load shuffle flag
      const s = await new Promise(r => chrome.storage.local.get('shuffle', r));
      shuffle = !!s.shuffle;

      // fetch Spotify playlist tracks
      const pid  = msg.playlist.split('/playlist/')[1].split('?')[0];
      const head = { Authorization: `Bearer ${msg.token}` };
      let url = `https://api.spotify.com/v1/playlists/${pid}/tracks` +
                `?fields=items(track(name,duration_ms,artists(name)))&limit=100`;

      list = [];
      idx  = 0;
      while (url) {
        const resp = await fetch(url, { headers: head });
        if (!resp.ok) throw new Error(`Spotify API ${resp.status}`);
        const j = await resp.json();
        for (const it of j.items) {
          const tr   = it.track;
          const q    = encodeURIComponent(`${tr.artists[0].name} - ${tr.name}`);
          const link = `https://music.youtube.com/search?q=${q}`;
          list.push({ link, dur: tr.duration_ms / 1000 });
          await sleep(120);
        }
        url = j.next;
      }

      // shuffle once if it's ON
      if (shuffle) {
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [list[i], list[j]] = [list[j], list[i]];
        }
      }

      await saveState();
      play();
      sendResponse({ ok: true, count: list.length });
    } catch (err) {
      console.error('[ERROR background.js]', err);
      sendResponse({ ok: false, error: err.message || 'Unknown error' });
    }
  })();
  return true;  // keep port open until sendResponse
});

// play a song and set next alarm
async function play() {
  if (!list.length) return;

  const { link, dur } = list[idx];
  idx = (idx + 1) % list.length;
  await saveState();

  if (ytTabId == null) {
    // first open: activates YT Music tab
    const [userTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = await chrome.tabs.create({ url: link, active: true });
    ytTabId = tab.id;
    await saveState();
    // after 3s: switch back to original tab
    setTimeout(() => {
      if (userTab?.id) chrome.tabs.update(userTab.id, { active: true });
    }, 3000);
  } else {
    // update URL in the background tab
    try {
      await chrome.tabs.update(ytTabId, { url: link, active: false });
    } catch (e) {
      // if tab is closed, open a new one with the link
      console.warn('[background] tab update failed, opening new tab', e);
      const newTab = await chrome.tabs.create({ url: link, active: false });
      ytTabId = newTab.id;
      await saveState();
    }
  }

  chrome.alarms.clear('nextTrack', () => {
    chrome.alarms.create('nextTrack', {
      when: Date.now() + (dur + 2) * 1000
    });
  });
}

// skip / previous commands
chrome.commands.onCommand.addListener(async cmd => {
  if (!list.length || ytTabId == null) await loadState();
  if (!list.length) return;

  chrome.alarms.clear('nextTrack');

  if (cmd === 'previous-track') {
    idx = (idx - 2 + list.length) % list.length;
  }
  // skip-track doesn't modify idx: play() will play the next track

  await saveState();
  play();
});
