/**
 * Automatic Console Logger
 * Intercepts ALL console.log/error/warn and sends to backend
 */

// Override console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function sendLogToBackend(level, args) {
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');

  // Send to backend (non-blocking)
  apiFetch('/api/auto-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      url: window.location.href
    })
  }).catch(() => {}); // Silently fail
}

console.log = function(...args) {
  originalLog.apply(console, args);
  sendLogToBackend('LOG', args);
};

console.error = function(...args) {
  originalError.apply(console, args);
  sendLogToBackend('ERROR', args);
};

console.warn = function(...args) {
  originalWarn.apply(console, args);
  sendLogToBackend('WARN', args);
};

// Log that auto-logger is loaded
console.log('[AUTO-LOGGER] Loaded - all console output will be logged to backend');
