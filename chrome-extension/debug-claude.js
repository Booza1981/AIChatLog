/**
 * Claude DOM Inspector
 * Run this in the Console on a Claude conversation page
 *
 * Instructions:
 * 1. Go to claude.ai
 * 2. Open ANY conversation
 * 3. Press F12 → Console tab
 * 4. Paste this entire file and press Enter
 */

console.log('='.repeat(80));
console.log('CLAUDE DOM INSPECTOR');
console.log('='.repeat(80));

// Basic page info
console.log('\n📍 PAGE INFO:');
console.log('URL:', window.location.href);
console.log('Hostname:', window.location.hostname);
console.log('Pathname:', window.location.pathname);
console.log('Is Claude?', window.location.hostname.includes('claude.ai'));
console.log('Has /chat/?', window.location.pathname.startsWith('/chat/'));

if (window.location.pathname.startsWith('/chat/')) {
  const convId = window.location.pathname.split('/chat/')[1];
  console.log('Conversation ID:', convId || 'NONE FOUND');
} else {
  console.log('⚠️  NOT on a conversation page! Click a conversation first.');
}

// Sidebar conversations
console.log('\n📁 SIDEBAR CONVERSATIONS:');
const sidebarLinks = document.querySelectorAll('a[href^="/chat/"]');
console.log('Found links:', sidebarLinks.length);
if (sidebarLinks.length > 0) {
  console.log('First 3 links:', Array.from(sidebarLinks).slice(0, 3).map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent.trim().substring(0, 50)
  })));
}

// Try to find title
console.log('\n📝 TITLE DETECTION:');
const titleSelectors = [
  'h1',
  '[data-testid="conversation-title"]',
  '.conversation-title',
  'header h1',
  'header h2'
];
titleSelectors.forEach(selector => {
  const el = document.querySelector(selector);
  console.log(`${selector}:`, el ? `"${el.textContent.trim().substring(0, 50)}"` : 'NOT FOUND');
});

// Try to find messages
console.log('\n💬 MESSAGE DETECTION:');
const messageSelectors = [
  '[data-testid="message"]',
  '[role="article"]',
  '.message',
  'div[class*="message"]',
  'div[class*="Message"]',
  '[class*="conversation"]',
  '[class*="chat"]'
];
messageSelectors.forEach(selector => {
  const elements = document.querySelectorAll(selector);
  console.log(`${selector}: ${elements.length} found`);
});

// Let's try to find ANY likely message containers
console.log('\n🔍 SEARCHING FOR MESSAGE PATTERNS:');
const allDivs = document.querySelectorAll('div');
console.log('Total divs on page:', allDivs.length);

// Look for divs that might be messages (have substantial text)
const likelyMessages = Array.from(allDivs).filter(div => {
  const text = div.textContent.trim();
  // Messages usually have decent length and some depth
  return text.length > 50 && text.length < 5000 && div.children.length > 0;
});
console.log('Divs with 50-5000 chars:', likelyMessages.length);

if (likelyMessages.length > 0 && likelyMessages.length < 100) {
  console.log('\nSample potential message containers (first 3):');
  likelyMessages.slice(0, 3).forEach((div, i) => {
    console.log(`\nMessage ${i + 1}:`);
    console.log('  Classes:', div.className);
    console.log('  Text preview:', div.textContent.trim().substring(0, 100) + '...');
    console.log('  HTML:', div.outerHTML.substring(0, 200) + '...');
  });
}

// Check main content area
console.log('\n📦 MAIN CONTENT AREA:');
const main = document.querySelector('main');
if (main) {
  console.log('Found <main> element');
  console.log('Children count:', main.children.length);
  console.log('Text length:', main.textContent.length);
} else {
  console.log('No <main> element found');
}

// React/Vue detection
console.log('\n⚛️  FRAMEWORK DETECTION:');
console.log('Has __NEXT_DATA__?', !!document.getElementById('__NEXT_DATA__'));
console.log('Has _reactRootContainer?', !![...document.querySelectorAll('*')].find(el => el._reactRootContainer));

console.log('\n' + '='.repeat(80));
console.log('✅ INSPECTION COMPLETE');
console.log('Send this output to help debug the selectors!');
console.log('='.repeat(80));
