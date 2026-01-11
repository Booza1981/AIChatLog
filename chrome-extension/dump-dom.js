/**
 * Claude DOM Dumper
 * Saves the DOM structure to help with debugging
 *
 * Run this on claude.ai (in a conversation) to save DOM structure
 */

console.log('Starting DOM dump...');

const domData = {
  url: window.location.href,
  timestamp: new Date().toISOString(),

  // Sidebar conversations
  sidebarLinks: Array.from(document.querySelectorAll('a[data-dd-action-name="sidebar-chat-item"]')).map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent.trim().substring(0, 100),
    html: a.outerHTML.substring(0, 300)
  })),

  // Messages
  userMessages: Array.from(document.querySelectorAll('div[data-testid="user-message"]')).map((el, i) => ({
    index: i,
    text: el.textContent.trim().substring(0, 200),
    html: el.outerHTML.substring(0, 500)
  })),

  claudeMessages: Array.from(document.querySelectorAll('.font-claude-response')).map((el, i) => ({
    index: i,
    text: el.textContent.trim().substring(0, 200),
    html: el.outerHTML.substring(0, 500)
  })),

  // Page structure
  title: document.title,
  h1Tags: Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()),
  mainContent: document.querySelector('main') ? 'found' : 'not found',
};

// Create downloadable JSON
const blob = new Blob([JSON.stringify(domData, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'claude-dom-structure.json';
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);

console.log('DOM dump downloaded! Check your Downloads folder for claude-dom-structure.json');
console.log('Summary:', {
  sidebarLinks: domData.sidebarLinks.length,
  userMessages: domData.userMessages.length,
  claudeMessages: domData.claudeMessages.length
});
