/**
 * Gemini Request Capture Tool
 * Paste this in console on gemini.google.com
 * Then click a conversation to capture the real API format
 */

console.log('🔍 GEMINI REQUEST CAPTURER ACTIVE');
console.log('Now click on a conversation in the sidebar...\n');

// Store original fetch
const originalFetch = window.fetch;

// Override fetch to log batchexecute calls
window.fetch = async function(...args) {
    const url = args[0];
    const options = args[1] || {};

    // Only intercept batchexecute calls
    if (url && typeof url === 'string' && url.includes('batchexecute')) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🎯 CAPTURED BATCHEXECUTE REQUEST');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Parse URL
        const urlObj = new URL(url);
        console.log('📍 URL:', url);
        console.log('\n📦 URL Parameters:');
        urlObj.searchParams.forEach((value, key) => {
            console.log(`  ${key}: ${value}`);
        });

        console.log('\n📋 Request Headers:');
        if (options.headers) {
            Object.entries(options.headers).forEach(([key, value]) => {
                console.log(`  ${key}: ${value}`);
            });
        }

        console.log('\n📨 Request Body:');
        if (options.body) {
            console.log('  Type:', typeof options.body);
            console.log('  Content:', options.body);

            // Try to decode if it's URL encoded
            if (typeof options.body === 'string' && options.body.startsWith('f.req=')) {
                try {
                    const decoded = decodeURIComponent(options.body.substring(6));
                    console.log('\n  📖 Decoded f.req:');
                    console.log('  ', decoded);

                    // Try to pretty-print JSON
                    try {
                        const parsed = JSON.parse(decoded);
                        console.log('\n  🎨 Parsed JSON:');
                        console.log('  ', JSON.stringify(parsed, null, 2));
                    } catch (e) {
                        console.log('  (Not JSON or complex format)');
                    }
                } catch (e) {
                    console.log('  (Could not decode)');
                }
            }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    // Call original fetch
    return originalFetch.apply(this, args);
};

console.log('✅ Interceptor installed!');
console.log('👉 Now click a conversation to see the API call format');
