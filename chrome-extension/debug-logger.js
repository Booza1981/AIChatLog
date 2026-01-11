/**
 * Debug Logger - Writes logs to file for agent debugging
 */

const DEBUG_LOG_FILE = '/tmp/claude-extension-debug.log';

async function debugLog(message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message,
    data,
    url: window.location.href
  };

  // Log to console
  console.log(`[DEBUG] ${message}`, data || '');

  // Send to backend to write to file
  try {
    await fetch('http://localhost:8000/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry)
    });
  } catch (e) {
    // Silently fail if backend not available
  }
}

// Make it globally available
window.debugLog = debugLog;
