/**
 * ChatGPT Token Interceptor
 * Intercepts fetch AND XHR requests to capture the access token
 * Must run in MAIN world at document_start
 */

// Silent install - only log on success/failure

// Immediately store token on window for access
window.__chatgptToken__ = null;

// Store token in a DOM element so content script can access it
function storeTokenInDOM(token) {
  let el = document.getElementById('__chatgpt_token__');
  if (!el) {
    el = document.createElement('div');
    el.id = '__chatgpt_token__';
    el.style.display = 'none';
    // Append to documentElement which exists even at document_start
    if (document.documentElement) {
      document.documentElement.appendChild(el);
    } else {
      // Fallback: wait for DOM
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.appendChild(el);
      });
    }
  }
  el.textContent = token;
}

// Unified token setter
function captureToken(token, source) {
  if (!token || token.length < 50) return;

  window.__chatgptToken__ = token;
  storeTokenInDOM(token);
  window.dispatchEvent(new CustomEvent('chatgptTokenCaptured', { detail: token }));
}

// ========== FETCH INTERCEPTOR ==========
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const [input, init] = args;

  let authHeader = null;

  // Case 1: fetch(Request) - headers are in the Request object
  if (input instanceof Request) {
    authHeader = input.headers.get('Authorization');
  }
  // Case 2: fetch(url, options) - headers are in options
  else if (init && init.headers) {
    if (init.headers instanceof Headers) {
      authHeader = init.headers.get('Authorization');
    } else if (typeof init.headers === 'object') {
      authHeader = init.headers['Authorization'] || init.headers['authorization'];
    }
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    captureToken(authHeader.substring(7), 'fetch');
  }

  return originalFetch.apply(this, args);
};

// ========== XHR INTERCEPTOR ==========
const OriginalXHR = window.XMLHttpRequest;
window.XMLHttpRequest = function() {
  const xhr = new OriginalXHR();

  const originalSetRequestHeader = xhr.setRequestHeader;
  xhr.setRequestHeader = function(name, value) {
    if (name.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ')) {
      captureToken(value.substring(7), 'XHR');
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  return xhr;
};

// ========== SEARCH PAGE FOR EXISTING TOKEN ==========
function findTokenInPage() {
  if (window.__chatgptToken__) return true;

  try {
    // Method 1: Look in __NEXT_DATA__
    const nextDataScript = document.getElementById('__NEXT_DATA__');
    if (nextDataScript) {
      try {
        const data = JSON.parse(nextDataScript.textContent);
        const token = data?.props?.pageProps?.accessToken ||
                      data?.props?.pageProps?.user?.accessToken;
        if (token) {
          captureToken(token, '__NEXT_DATA__');
          return true;
        }
      } catch (e) {}
    }

    // Method 2: Look for inline scripts with accessToken
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const content = script.textContent || '';
      const patterns = [
        /"accessToken"\s*:\s*"([^"]+)"/,
        /"access_token"\s*:\s*"([^"]+)"/,
        /accessToken\s*=\s*["']([^"']+)["']/,
      ];

      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match && match[1] && match[1].length > 100) {
          captureToken(match[1], 'inline script');
          return true;
        }
      }
    }
  } catch (e) { /* ignore */ }

  return false;
}

// Try to fetch token from auth session endpoint
async function fetchTokenFromSession() {
  if (window.__chatgptToken__) return true;

  try {
    const response = await fetch('https://chatgpt.com/api/auth/session', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();
      if (data.accessToken) {
        captureToken(data.accessToken, 'session API');
        return true;
      }
    }
  } catch (e) { /* ignore */ }

  return false;
}

// Run token search when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    findTokenInPage();
    if (!window.__chatgptToken__) {
      fetchTokenFromSession();
    }
  });
} else {
  setTimeout(() => {
    findTokenInPage();
    if (!window.__chatgptToken__) {
      fetchTokenFromSession();
    }
  }, 100);
}

// Re-check periodically in case token loads later
let searchAttempts = 0;
const searchInterval = setInterval(async () => {
  if (window.__chatgptToken__ || searchAttempts > 20) {
    clearInterval(searchInterval);
    return;
  }

  if (!findTokenInPage() && searchAttempts % 5 === 0) {
    await fetchTokenFromSession();
  }

  searchAttempts++;
}, 500);

// Helper functions for debugging
window.setChatGPTToken = function(token) {
  captureToken(token, 'manual');
};

window.getChatGPTToken = function() {
  return window.__chatgptToken__;
};
