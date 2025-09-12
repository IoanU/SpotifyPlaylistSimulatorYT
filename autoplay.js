// autoplay.js

(function () {
  // function to click the "Play" button on the "Top result" card
  function clickTopResult() {
    /*  The "Top Result" card is a <ytmusic-card-shelf-renderer>.
        It has a <ytmusic-play-button-renderer> in it.          */
    const topCardBtn = document.querySelector(
      'ytmusic-card-shelf-renderer ytmusic-play-button-renderer'
    );
    if (topCardBtn) {
      console.log('[autoplay] ▶️  Play on Top result');
      topCardBtn.click();
      return true;
    }
    return false;
  }

  // Sometimes the card loads after a few DOM mutations => MutationObserver
  const observer = new MutationObserver(() => {
    if (clickTopResult()) observer.disconnect();
  });

  // start the observer immediately
  observer.observe(document.body, { childList: true, subtree: true });

  // and try "cold" (maybe the card is already in DOM)
  clickTopResult();
})();
