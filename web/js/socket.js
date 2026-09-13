// WebSocket with exponential-backoff reconnect and a watchdog. iOS can leave a
// dead-but-"open" socket after the app is backgrounded; the server sends a
// status frame every second, so 4 s of silence means the socket is gone.

const WATCHDOG_MS = 4000;
const MAX_BACKOFF_MS = 5000;

export function createSocket({ onBinary, onText, onState }) {
  const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  let ws = null;
  let backoff = 500;
  let retryTimer = 0;
  let lastMessage = 0;
  let open = false;

  function setOpen(v) {
    if (open === v) return;
    open = v;
    onState(v);
  }

  function drop() {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch { /* already closed */ }
    ws = null;
    setOpen(false);
  }

  function connect() {
    clearTimeout(retryTimer);
    drop();
    lastMessage = performance.now();
    const s = new WebSocket(url);
    s.binaryType = 'arraybuffer';
    s.onopen = () => {
      backoff = 500;
      lastMessage = performance.now();
      setOpen(true);
    };
    s.onmessage = (e) => {
      lastMessage = performance.now();
      if (typeof e.data === 'string') {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        onText(msg);
      } else {
        onBinary(e.data);
      }
    };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      setOpen(false);
      scheduleRetry();
    };
    ws = s;
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const delay = backoff * (0.8 + Math.random() * 0.4);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    retryTimer = setTimeout(connect, delay);
  }

  setInterval(() => {
    if (ws && performance.now() - lastMessage > WATCHDOG_MS) {
      drop();
      scheduleRetry();
    }
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!open || performance.now() - lastMessage > 1500) {
      backoff = 500;
      connect();
    }
  });

  connect();
  return { get open() { return open; } };
}
