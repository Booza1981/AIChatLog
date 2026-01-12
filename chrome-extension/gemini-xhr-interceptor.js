/**
 * Gemini XHR Interceptor - Runs at document_start in MAIN world
 * Captures all batchexecute requests to extract tokens
 */

// Storage for captured tokens
window.__geminiCapturedTokens__ = {
  sessionToken: null,
  atToken: null,
  lastRequest: null
};

console.log('[Gemini XHR] 🚀 Installing interceptor at document_start...');

// Store original XHR
const OriginalXHR = window.XMLHttpRequest;

// Override XMLHttpRequest
window.XMLHttpRequest = function() {
  const xhr = new OriginalXHR();
  let requestUrl = null;
  let requestBody = null;

  // Intercept open
  const originalOpen = xhr.open;
  xhr.open = function(method, url) {
    requestUrl = url;
    return originalOpen.apply(this, arguments);
  };

  // Intercept send
  const originalSend = xhr.send;
  xhr.send = function(body) {
    requestBody = body;

    // Only intercept batchexecute calls
    if (requestUrl && requestUrl.includes('batchexecute')) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 [Gemini XHR] Intercepted batchexecute request');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📍 URL:', requestUrl);

      // Parse URL
      try {
        const urlObj = new URL(requestUrl);
        console.log('\n📦 URL Parameters:');
        urlObj.searchParams.forEach((value, key) => {
          console.log(`  ${key}: ${value}`);
        });
      } catch (e) {}

      // Parse body
      if (body && typeof body === 'string') {
        console.log('\n📨 Request Body:');
        console.log('  Raw:', body.substring(0, 200) + '...');

        // Parse form parameters
        const formParams = {};
        body.split('&').forEach(param => {
          const [key, value] = param.split('=');
          if (key && value) {
            try {
              formParams[key] = decodeURIComponent(value);
            } catch (e) {
              formParams[key] = value;
            }
          }
        });

        console.log('\n  📋 Form Parameters:', Object.keys(formParams));

        // Capture "at" token
        if (formParams.at) {
          window.__geminiCapturedTokens__.atToken = formParams.at;
          console.log('\n  ✅ CAPTURED "at" TOKEN');
          console.log('     Value:', formParams.at);

          // Dispatch event to notify content script
          window.dispatchEvent(new CustomEvent('geminiAtTokenCaptured', {
            detail: formParams.at
          }));
        }

        // Parse f.req
        if (formParams['f.req']) {
          try {
            const parsed = JSON.parse(formParams['f.req']);
            console.log('\n  🎨 f.req structure:', JSON.stringify(parsed, null, 2).substring(0, 500) + '...');

            // Look for MaZiqc with session token
            if (Array.isArray(parsed) && parsed[0] && parsed[0][0]) {
              const rpcCall = parsed[0][0];
              console.log('\n  🎯 RPC ID:', rpcCall[0]);

              if (rpcCall[0] === 'MaZiqc' && rpcCall[1]) {
                const params = JSON.parse(rpcCall[1]);
                console.log('  📋 MaZiqc params:', params);

                if (Array.isArray(params) && params[1] && typeof params[1] === 'string') {
                  window.__geminiCapturedTokens__.sessionToken = params[1];
                  console.log('\n  ✅ CAPTURED SESSION TOKEN');
                  console.log('     Length:', params[1].length);
                  console.log('     Preview:', params[1].substring(0, 80) + '...');

                  // Dispatch event to notify content script
                  window.dispatchEvent(new CustomEvent('geminiSessionTokenCaptured', {
                    detail: params[1]
                  }));
                }
              }
            }

            // Store for debugging
            window.__geminiCapturedTokens__.lastRequest = {
              url: requestUrl,
              body: formParams['f.req'],
              parsed: parsed,
              formParams: formParams,
              timestamp: new Date().toISOString()
            };

            console.log('\n  💾 Full request saved to: window.__geminiCapturedTokens__.lastRequest');

          } catch (e) {
            console.error('  ❌ Error parsing f.req:', e);
          }
        }
      }

      // Intercept response
      const originalOnLoad = xhr.onload;
      xhr.onload = function() {
        console.log('\n📥 Response (status:', xhr.status, ')');
        if (xhr.status === 200) {
          console.log('  ✅ Success');
        } else {
          console.log('  ❌ Error');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        if (originalOnLoad) {
          originalOnLoad.apply(this, arguments);
        }
      };

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    return originalSend.apply(this, arguments);
  };

  return xhr;
};

console.log('[Gemini XHR] ✅ Interceptor installed successfully');
console.log('[Gemini XHR] Will capture all batchexecute requests');
console.log('[Gemini XHR] TIP: Scroll conversation list or click a conversation to trigger capture');
