"""
Claude.ai scraper implementation

IMPORTANT: Claude.ai's UI structure may change. Use browser DevTools to inspect:
1. Open claude.ai/chats in browser
2. Right-click conversation list → Inspect
3. Find the actual selectors for conversations
4. Update SELECTORS dict below with correct values

This scraper uses multiple fallback strategies to handle UI changes.
"""

from scrapers.base import BaseScraper
from playwright.async_api import Page, TimeoutError as PlaywrightTimeout
from typing import List, Dict, Optional
from datetime import datetime
import json
import re


class ClaudeScraper(BaseScraper):
    """
    Scraper for Claude.ai conversations.
    """

    # Selectors for Claude.ai UI elements
    # IMPORTANT: These may need adjustment based on actual DOM structure
    SELECTORS = {
        # Conversation list selectors (try in order)
        'conversation_list': [
            '[data-testid="conversation-list"]',
            '.conversations-list',
            '[role="list"]',
            'nav a[href^="/chat/"]',  # Fallback: all links starting with /chat/
        ],

        # Individual conversation item
        'conversation_item': [
            '[data-testid="conversation-item"]',
            '.conversation-item',
            'a[href^="/chat/"]',
        ],

        # Conversation title
        'conversation_title': [
            '[data-testid="conversation-title"]',
            '.conversation-title',
            'h3',
            'span',
        ],

        # Message container
        'message_container': [
            '[data-testid="message"]',
            '.message',
            '[role="article"]',
            'div[class*="message"]',
        ],

        # Message role indicator (user vs assistant)
        'message_role': [
            '[data-role]',
            '[data-message-role]',
            'div[class*="user"]',
            'div[class*="assistant"]',
        ],

        # Message content
        'message_content': [
            '[data-testid="message-content"]',
            '.message-content',
            'p',
            'div[class*="content"]',
        ],

        # Timestamp
        'message_timestamp': [
            '[data-testid="timestamp"]',
            'time',
            '[datetime]',
            'span[class*="time"]',
        ],
    }

    def __init__(self):
        super().__init__('claude')

    def get_base_url(self) -> str:
        """Return base URL for Claude."""
        return 'https://claude.ai/chats'

    async def verify_logged_in(self, page: Page) -> bool:
        """
        Check if user is logged in to Claude.
        Looks for indicators that we're on the chat interface, not login page.
        """
        try:
            # Wait for page to fully load
            await page.wait_for_load_state('networkidle', timeout=10000)

            # DEBUG: Print page info and take screenshot
            current_url = page.url
            page_title = await page.title()
            print(f"[Claude DEBUG] Current URL: {current_url}")
            print(f"[Claude DEBUG] Page title: {page_title}")

            # Take debug screenshot
            screenshot_path = "/app/volumes/database/claude_debug.png"
            await page.screenshot(path=screenshot_path)
            print(f"[Claude DEBUG] Screenshot saved to: {screenshot_path}")

            # Check URL - if we're redirected to login, we're not logged in
            if 'login' in current_url.lower() or 'signin' in current_url.lower():
                print(f"[Claude] Detected login page in URL: {current_url}")
                return False

            # Try to find conversation list or chat interface elements
            for selector in self.SELECTORS['conversation_list']:
                try:
                    element = await page.query_selector(selector)
                    if element:
                        print(f"[Claude] Found chat interface using selector: {selector}")
                        return True
                except Exception:
                    continue

            # Fallback: Look for any anchor with /chat/ path
            chat_links = await page.query_selector_all('a[href*="/chat"]')
            if len(chat_links) > 0:
                print(f"[Claude] Found {len(chat_links)} chat links - assuming logged in")
                return True

            print("[Claude] Could not find chat interface elements - may not be logged in")
            return False

        except Exception as e:
            print(f"[Claude] Error verifying login: {e}")
            return False

    async def get_conversation_list(self, page: Page) -> List[Dict]:
        """
        Extract list of conversations from Claude's sidebar.

        Returns list of dicts with: {id, title, url, updated_at}
        """
        print("[Claude] Extracting conversation list...")

        conversations = []

        try:
            # Navigate to chats page
            await page.goto(self.get_base_url(), wait_until='networkidle', timeout=30000)
            await self.random_delay(1, 2)

            # Try different selectors to find conversation links
            conversation_links = []

            for selector in self.SELECTORS['conversation_item']:
                try:
                    elements = await page.query_selector_all(selector)
                    if elements:
                        conversation_links = elements
                        print(f"[Claude] Found {len(elements)} conversations using selector: {selector}")
                        break
                except Exception:
                    continue

            if not conversation_links:
                print("[Claude] Warning: No conversations found. Check selectors.")
                return []

            # Extract conversation metadata
            for i, link in enumerate(conversation_links):
                try:
                    # Get href (conversation URL)
                    href = await link.get_attribute('href')
                    if not href or '/chat/' not in href:
                        continue

                    # Extract conversation ID from URL
                    # Format: /chat/{uuid} or similar
                    conv_id = href.split('/chat/')[-1].split('?')[0].split('#')[0]

                    # Get title - try multiple strategies
                    title = None
                    for title_selector in self.SELECTORS['conversation_title']:
                        try:
                            title_elem = await link.query_selector(title_selector)
                            if title_elem:
                                title = await title_elem.inner_text()
                                if title and title.strip():
                                    break
                        except Exception:
                            continue

                    # If no title found, use fallback
                    if not title:
                        title_text = await link.inner_text()
                        title = title_text.strip()[:100] if title_text else f"Conversation {i+1}"

                    conversations.append({
                        'id': conv_id,
                        'title': title.strip(),
                        'url': f"https://claude.ai{href}" if href.startswith('/') else href,
                        'updated_at': None  # Claude doesn't show timestamps in list
                    })

                except Exception as e:
                    print(f"[Claude] Error extracting conversation {i}: {e}")
                    continue

            print(f"[Claude] Successfully extracted {len(conversations)} conversations")
            return conversations

        except Exception as e:
            print(f"[Claude] Error getting conversation list: {e}")
            import traceback
            traceback.print_exc()
            return []

    async def scrape_single_conversation(self, page: Page, conversation_id: str) -> Dict:
        """
        Scrape messages from a single Claude conversation.

        Returns: {messages: [...], metadata: {...}}
        """
        print(f"[Claude] Scraping conversation: {conversation_id}")

        try:
            # Navigate to conversation
            conv_url = f"https://claude.ai/chat/{conversation_id}"
            await page.goto(conv_url, wait_until='networkidle', timeout=30000)
            await self.random_delay(1, 2)

            # Wait for messages to load
            await page.wait_for_timeout(2000)

            messages = []

            # Find all message elements
            message_elements = []
            for selector in self.SELECTORS['message_container']:
                try:
                    elements = await page.query_selector_all(selector)
                    if elements and len(elements) > 0:
                        message_elements = elements
                        print(f"[Claude] Found {len(elements)} messages using selector: {selector}")
                        break
                except Exception:
                    continue

            if not message_elements:
                print(f"[Claude] Warning: No messages found for conversation {conversation_id}")
                return {'messages': [], 'metadata': {}}

            # Extract each message
            for i, msg_elem in enumerate(message_elements):
                try:
                    # Determine role (user vs assistant)
                    # Strategy: Look for class names or data attributes
                    role = 'user'  # Default
                    html = await msg_elem.inner_html()

                    # Check for role indicators in HTML/classes
                    if 'assistant' in html.lower() or 'claude' in html.lower():
                        role = 'assistant'
                    elif 'user' in html.lower() or 'human' in html.lower():
                        role = 'user'

                    # Try to get role from data attributes
                    for role_selector in self.SELECTORS['message_role']:
                        try:
                            role_elem = await msg_elem.query_selector(role_selector)
                            if role_elem:
                                role_attr = await role_elem.get_attribute('data-role')
                                if not role_attr:
                                    role_attr = await role_elem.get_attribute('data-message-role')

                                if role_attr:
                                    role = role_attr.lower()
                                    break
                        except Exception:
                            continue

                    # Extract message content
                    content = None
                    for content_selector in self.SELECTORS['message_content']:
                        try:
                            content_elems = await msg_elem.query_selector_all(content_selector)
                            if content_elems:
                                # Concatenate all content elements (for multi-part messages)
                                content_parts = []
                                for elem in content_elems:
                                    text = await elem.inner_text()
                                    if text and text.strip():
                                        content_parts.append(text.strip())

                                if content_parts:
                                    content = '\n'.join(content_parts)
                                    break
                        except Exception:
                            continue

                    # Fallback: Get all text from message element
                    if not content:
                        content = await msg_elem.inner_text()

                    if not content or not content.strip():
                        continue  # Skip empty messages

                    # Try to extract timestamp
                    timestamp = None
                    for ts_selector in self.SELECTORS['message_timestamp']:
                        try:
                            ts_elem = await msg_elem.query_selector(ts_selector)
                            if ts_elem:
                                # Try datetime attribute first
                                dt_attr = await ts_elem.get_attribute('datetime')
                                if dt_attr:
                                    timestamp = datetime.fromisoformat(dt_attr.replace('Z', '+00:00'))
                                    break

                                # Fallback: Parse text
                                ts_text = await ts_elem.inner_text()
                                if ts_text:
                                    # Basic timestamp parsing (extend as needed)
                                    timestamp = self._parse_timestamp(ts_text)
                                    break
                        except Exception:
                            continue

                    messages.append({
                        'role': role if role in ['user', 'assistant'] else 'user',
                        'content': content.strip(),
                        'timestamp': timestamp or datetime.now(),
                        'sequence_number': i
                    })

                except Exception as e:
                    print(f"[Claude] Error extracting message {i}: {e}")
                    continue

            print(f"[Claude] Extracted {len(messages)} messages from conversation {conversation_id}")

            return {
                'messages': messages,
                'metadata': {
                    'conversation_url': conv_url
                }
            }

        except Exception as e:
            print(f"[Claude] Error scraping conversation {conversation_id}: {e}")
            import traceback
            traceback.print_exc()
            return {'messages': [], 'metadata': {}}

    async def scrape_conversations(self, limit: Optional[int] = None) -> List[Dict]:
        """
        Main scraping entry point.
        Scrapes conversations from Claude and returns structured data.

        Args:
            limit: Optional limit on number of conversations to scrape

        Returns:
            List of conversation dicts ready for database insertion
        """
        print("[Claude] Starting conversation scrape...")

        try:
            context = await self.get_browser_context()
            page = await self.new_stealth_page()

            # Get list of conversations
            conversation_list = await self.get_conversation_list(page)

            if not conversation_list:
                print("[Claude] No conversations found to scrape")
                await page.close()
                await self.cleanup()
                return []

            # Apply limit if specified
            if limit:
                conversation_list = conversation_list[:limit]
                print(f"[Claude] Limiting scrape to {limit} conversations")

            results = []

            for idx, conv_meta in enumerate(conversation_list):
                try:
                    print(f"\n[Claude] Progress: {idx+1}/{len(conversation_list)} - {conv_meta['title']}")

                    # Scrape individual conversation
                    conv_data = await self.scrape_single_conversation(page, conv_meta['id'])

                    if conv_data['messages']:
                        results.append({
                            'conversation_id': conv_meta['id'],
                            'title': conv_meta['title'],
                            'messages': conv_data['messages'],
                            'created_at': conv_data['messages'][0]['timestamp'] if conv_data['messages'] else datetime.now(),
                            'updated_at': conv_data['messages'][-1]['timestamp'] if conv_data['messages'] else datetime.now(),
                            'metadata': conv_data.get('metadata', {})
                        })

                    # Rate limiting
                    await self.random_delay(2, 4)

                except Exception as e:
                    print(f"[Claude] Error scraping conversation {conv_meta['id']}: {e}")
                    continue

            # Save session after successful scrape
            await self.save_session()

            print(f"\n[Claude] Scrape complete! Successfully scraped {len(results)} conversations")

            await page.close()
            await self.cleanup()

            return results

        except Exception as e:
            print(f"[Claude] Fatal error during scraping: {e}")
            import traceback
            traceback.print_exc()
            await self.cleanup()
            return []

    def _parse_timestamp(self, timestamp_text: str) -> Optional[datetime]:
        """
        Parse timestamp from text.
        Handles common formats like "2 hours ago", "Yesterday", etc.
        """
        try:
            # Add parsing logic for relative timestamps
            # For now, return current time as fallback
            return datetime.now()
        except Exception:
            return None
