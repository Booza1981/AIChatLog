/**
 * Gemini API Inspector
 *
 * Paste this into DevTools console on gemini.google.com to inspect API calls
 *
 * Usage:
 * 1. Open gemini.google.com
 * 2. Open DevTools Console (F12)
 * 3. Paste this entire file and press Enter
 * 4. Run: inspectGeminiAPI()
 * 5. Click on conversations in the sidebar
 * 6. Check the logged data in console
 */

function inspectGeminiAPI() {
  console.log('[Gemini Inspector] Starting...');

  // Store original fetch
  const originalFetch = window.fetch;

  // Override fetch to intercept API calls
  window.fetch = async function(...args) {
    const url = args[0];
    const options = args[1] || {};

    // Only log batchexecute calls
    if (url && url.includes('batchexecute')) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[Gemini Inspector] BATCHEXECUTE CALL');
      console.log('URL:', url);

      // Extract rpcids parameter
      const urlObj = new URL(url);
      const rpcids = urlObj.searchParams.get('rpcids');
      console.log('RPC ID:', rpcids);

      // Log request body
      if (options.body) {
        console.log('Request Body:', options.body);

        // Try to parse if it's URL encoded
        try {
          const bodyStr = options.body.toString();
          if (bodyStr.startsWith('f.req=')) {
            const encoded = bodyStr.substring(6);
            const decoded = decodeURIComponent(encoded);
            console.log('Decoded Request:', decoded);

            try {
              const parsed = JSON.parse(decoded);
              console.log('Parsed Request:', parsed);
            } catch (e) {
              console.log('(Could not parse as JSON)');
            }
          }
        } catch (e) {
          console.log('Error parsing body:', e);
        }
      }

      // Call original fetch
      const response = await originalFetch.apply(this, args);

      // Clone response to read it
      const clonedResponse = response.clone();

      try {
        const text = await clonedResponse.text();
        console.log('Response (raw):', text.substring(0, 500) + '...');

        // Parse Google's response format
        // Google responses often start with )]}' for CSRF protection
        let cleaned = text;
        if (text.startsWith(')]}\'\n')) {
          cleaned = text.substring(5);
        }

        try {
          const parsed = JSON.parse(cleaned);
          console.log('Response (parsed):', parsed);

          // Try to extract the actual data
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('Response Data Structure:');
            console.log('- Type:', typeof parsed[0]);
            console.log('- Length:', parsed.length);

            // Google usually wraps data in nested arrays
            if (Array.isArray(parsed[0])) {
              console.log('First Element:', parsed[0]);

              // Look for JSON strings in the response
              parsed[0].forEach((item, idx) => {
                if (typeof item === 'string' && item.startsWith('[')) {
                  try {
                    const innerData = JSON.parse(item);
                    console.log(`Inner Data [${idx}]:`, innerData);
                  } catch (e) {}
                }
              });
            }
          }
        } catch (e) {
          console.log('Could not parse response as JSON:', e.message);
        }

      } catch (e) {
        console.log('Error reading response:', e);
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return response;
    }

    // For non-batchexecute calls, just pass through
    return originalFetch.apply(this, args);
  };

  console.log('[Gemini Inspector] ✓ Active! Now click on conversations...');
  console.log('[Gemini Inspector] Watch for logged API calls above');
}

// Auto-run
inspectGeminiAPI();
