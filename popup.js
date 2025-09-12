// popup.js

document.addEventListener('DOMContentLoaded', () => {
  const clientId       = 'baddc47aa2244d79addddeec709a9231';
  const redirectUri    = chrome.identity.getRedirectURL('cb');
  const linkInput      = document.getElementById('spLink');
  const shuffleToggle  = document.getElementById('shuffleToggle');
  const statusEl       = document.getElementById('status');

  // initialize shuffle checkbox from storage
  chrome.storage.local.get('shuffle', data => {
    shuffleToggle.checked = !!data.shuffle;
  });
  // when user toggles shuffle
  shuffleToggle.addEventListener('change', () => {
    chrome.storage.local.set({ shuffle: shuffleToggle.checked });
  });

  // PKCE helpers
  function generateVerifier() {
    const arr = new Uint32Array(56);
    crypto.getRandomValues(arr);
    return Array.from(arr, dec => ('0' + dec.toString(16)).slice(-2)).join('');
  }
  async function generateChallenge(v) {
    const data   = new TextEncoder().encode(v);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  document.getElementById('startBtn').onclick = async () => {
    const playlistUrl = linkInput.value.trim();
    if (!/^https:\/\/open\.spotify\.com\/playlist\/.+/.test(playlistUrl)) {
      return alert('Enter a valid Spotify playlist URL!');
    }

    chrome.storage.local.get('sp_token', async store => {
      if (store.sp_token) {
        startPlayback(store.sp_token);
      } else {
        // PKCE setup
        const verifier  = generateVerifier();
        const challenge = await generateChallenge(verifier);
        chrome.storage.local.set({ pkce_verifier: verifier });

        // build auth URL
        const authUrl =
          `https://accounts.spotify.com/authorize?` +
          `client_id=${clientId}` +
          `&response_type=code` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&code_challenge_method=S256` +
          `&code_challenge=${challenge}` +
          `&scope=playlist-read-private%20playlist-read-collaborative`;
        console.log('[popup] Auth URL =', authUrl);

        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          async cbUrl => {
            if (!cbUrl) {
              console.error('[popup] Auth failed:', chrome.runtime.lastError);
              return alert('Spotify auth failed: ' + (chrome.runtime.lastError?.message || 'canceled'));
            }
            console.log('[popup] Received cbUrl =', cbUrl);

            const m = cbUrl.match(/[?&]code=([^&]+)/);
            if (!m) return alert('No code received');

            const code = m[1];
            try {
              const params = new URLSearchParams();
              params.append('client_id', clientId);
              params.append('grant_type', 'authorization_code');
              params.append('code', code);
              params.append('redirect_uri', redirectUri);
              params.append('code_verifier', verifier);

              const resp = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
              });
              const data = await resp.json();
              if (!data.access_token) {
                console.error('[popup] Token exchange error:', data);
                return alert(`Token exchange failed!\n${data.error}: ${data.error_description || ''}`);
              }
              chrome.storage.local.set({ sp_token: data.access_token }, () => {
                startPlayback(data.access_token);
              });
            } catch (e) {
              console.error('[popup] Exchange error:', e);
              alert('Exchange failed: ' + e.message);
            }
          }
        );
      }
    });

    function startPlayback(token) {
      statusEl.textContent = 'Building playlist...';

      chrome.runtime.sendMessage(
        { action: 'start', token, playlist: playlistUrl },
        res => {
          if (chrome.runtime.lastError) {
            console.error('[popup] Message error:', chrome.runtime.lastError);
            statusEl.textContent = 'Background error! ' + chrome.runtime.lastError.message;
            return;
          }
          if (res?.ok) {
            statusEl.textContent = `Playlist with ${res.count} songs playing...`;
          } else {
            console.error('[popup] Start error:', res.error);
            // If receiving 401 error, auth token is invalid or expired: relogin
            if (res.error === 'Spotify API 401') {
              statusEl.textContent = 'Expired toker, authenticating again...';
              chrome.storage.local.remove('sp_token', () => {
                // auto-restarting login flow
                document.getElementById('startBtn').click();
              });
            } else {
              statusEl.textContent = 'Starting error: ' + (res.error || 'unknown');
            }
          }
        }
      );
    }
  };
});
