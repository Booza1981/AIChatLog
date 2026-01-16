// Token Bridge Utility
// Shared utility for storing and retrieving Gemini tokens across MAIN and ISOLATED worlds

// Token storage constants
const TOKEN_STORAGE_KEY = 'gemini_tokens';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Store tokens in chrome.storage.local
 * Called from MAIN world (gemini-xhr-interceptor.js)
 * @param {string} sessionToken - The SNlM0e session token
 * @param {string} atToken - The XSRF 'at' token
 */
async function storeTokens(sessionToken, atToken) {
  try {
    await chrome.storage.local.set({
      [TOKEN_STORAGE_KEY]: {
        sessionToken: sessionToken || null,
        atToken: atToken || null,
        timestamp: Date.now()
      }
    });
    console.log('[Token Bridge] Tokens stored successfully');
  } catch (error) {
    console.error('[Token Bridge] Failed to store tokens:', error);
  }
}

/**
 * Retrieve tokens from chrome.storage.local
 * Called from ISOLATED world (gemini-api.js content script)
 * @returns {Promise<{sessionToken: string, atToken: string}|null>}
 */
async function retrieveTokens() {
  try {
    const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
    const data = result[TOKEN_STORAGE_KEY];

    if (!data) {
      console.log('[Token Bridge] No tokens found in storage');
      return null;
    }

    // Check expiry
    const age = Date.now() - data.timestamp;
    if (age > TOKEN_EXPIRY_MS) {
      console.log('[Token Bridge] Tokens expired, removing from storage');
      await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
      return null;
    }

    console.log(`[Token Bridge] Tokens retrieved (age: ${Math.round(age / 1000)}s)`);
    return {
      sessionToken: data.sessionToken,
      atToken: data.atToken
    };
  } catch (error) {
    console.error('[Token Bridge] Failed to retrieve tokens:', error);
    return null;
  }
}

/**
 * Cleanup old tokens from storage
 */
async function cleanupTokens() {
  try {
    await chrome.storage.local.remove(TOKEN_STORAGE_KEY);
    console.log('[Token Bridge] Tokens cleaned up');
  } catch (error) {
    console.error('[Token Bridge] Failed to cleanup tokens:', error);
  }
}

/**
 * Update a single token (sessionToken or atToken) in storage
 * Useful when tokens are captured separately
 * @param {string} tokenType - Either 'sessionToken' or 'atToken'
 * @param {string} tokenValue - The token value
 */
async function updateToken(tokenType, tokenValue) {
  try {
    const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
    const currentData = result[TOKEN_STORAGE_KEY] || {};

    const newData = {
      sessionToken: currentData.sessionToken || null,
      atToken: currentData.atToken || null,
      timestamp: currentData.timestamp || Date.now(),
      ...{[tokenType]: tokenValue}
    };

    await chrome.storage.local.set({
      [TOKEN_STORAGE_KEY]: newData
    });

    console.log(`[Token Bridge] Updated ${tokenType} in storage`);
  } catch (error) {
    console.error(`[Token Bridge] Failed to update ${tokenType}:`, error);
  }
}
