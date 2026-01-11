"""
Base scraper class with common browser automation logic
All service-specific scrapers inherit from this
"""

from abc import ABC, abstractmethod
from playwright.async_api import async_playwright, BrowserContext, Page, Playwright
from playwright_stealth import stealth_async
from typing import List, Dict, Optional
import os
import json
import asyncio
import random
from datetime import datetime
from stream_buffer import StreamBuffer


class BaseScraper(ABC):
    """
    Abstract base scraper with common browser automation logic.
    All service-specific scrapers inherit from this.
    """

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.profile_path = f"/app/volumes/browser-profiles/{service_name}"
        self.playwright: Optional[Playwright] = None
        self.browser = None
        self.context: Optional[BrowserContext] = None
        self.stream_buffer = StreamBuffer()

    async def initialize(self):
        """Initialize Playwright and browser context."""
        self.playwright = await async_playwright().start()
        # Try Firefox with software rendering for WebGL
        self.browser = await self.playwright.firefox.launch(
            headless=True,
            args=[
                '--no-sandbox',
            ],
            firefox_user_prefs={
                # Enable WebGL with software rendering (critical for Cloudflare)
                'webgl.disabled': False,
                'webgl.force-enabled': True,
                'webgl.software-rendering': True,
                # Disable automation flags
                'dom.webdriver.enabled': False,
                'useAutomationExtension': False,
                # Privacy settings
                'privacy.trackingprotection.enabled': False,
                # Media settings
                'media.peerconnection.enabled': True,
            }
        )

    async def get_browser_context(self) -> BrowserContext:
        """
        Load persistent browser context with saved session state.
        Returns authenticated context if session exists.
        """
        if not self.browser:
            await self.initialize()

        state_file = f"{self.profile_path}/state.json"
        storage_state = None

        # Load saved session if exists
        if os.path.exists(state_file):
            try:
                with open(state_file, 'r') as f:
                    storage_state = json.load(f)
                print(f"[{self.service_name}] Loaded session from {state_file}")
            except json.JSONDecodeError:
                print(f"[{self.service_name}] Warning: Corrupted session file, starting fresh")

        # Create context with saved state
        self.context = await self.browser.new_context(
            storage_state=storage_state,
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            viewport={'width': 1920, 'height': 1080},
            locale='en-US',
            timezone_id='America/New_York',
            # Extra headers to appear more human
            extra_http_headers={
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        )

        # Install anti-detection scripts
        await self.context.add_init_script("""
            // Remove webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });

            // Mock plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });

            // Mock languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });

            // Chrome runtime
            window.chrome = {
                runtime: {}
            };

            // Permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        """)

        return self.context

    async def new_stealth_page(self) -> Page:
        """
        Create a new page with stealth mode enabled.
        This applies anti-detection techniques to bypass bot detection.
        """
        if not self.context:
            await self.get_browser_context()

        page = await self.context.new_page()
        await stealth_async(page)
        return page

    async def save_session(self):
        """Save current session state to disk."""
        if not self.context:
            raise RuntimeError("No active context to save")

        os.makedirs(self.profile_path, exist_ok=True)
        state_file = f"{self.profile_path}/state.json"

        await self.context.storage_state(path=state_file)
        print(f"[{self.service_name}] Session saved to {state_file}")

    async def check_session_health(self) -> tuple[bool, Optional[str]]:
        """
        Test if saved session is still valid.
        Returns: (is_healthy, error_message)
        """
        try:
            context = await self.get_browser_context()
            page = await self.new_stealth_page()

            # Navigate to service
            await page.goto(self.get_base_url(), wait_until='networkidle', timeout=30000)

            # Give page time to redirect if login required
            await asyncio.sleep(2)

            # Check if logged in using service-specific verification
            is_logged_in = await self.verify_logged_in(page)

            await page.close()

            if is_logged_in:
                return True, None
            else:
                return False, "Not logged in (redirected to login page or missing expected elements)"

        except Exception as e:
            return False, f"Health check failed: {str(e)}"
        finally:
            if self.context:
                await self.cleanup()

    async def cleanup(self):
        """Clean up browser resources."""
        if self.context:
            await self.context.close()
            self.context = None
        if self.browser:
            await self.browser.close()
            self.browser = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None

    async def random_delay(self, min_seconds: float = 1.0, max_seconds: float = 3.0):
        """Add random delay to appear more human."""
        delay = random.uniform(min_seconds, max_seconds)
        await asyncio.sleep(delay)

    # Abstract methods that subclasses must implement

    @abstractmethod
    def get_base_url(self) -> str:
        """Return base URL for the service (e.g., https://claude.ai/chats)."""
        pass

    @abstractmethod
    async def verify_logged_in(self, page: Page) -> bool:
        """
        Check if user is logged in by inspecting page.
        Should check for service-specific indicators (e.g., presence of chat interface).
        """
        pass

    @abstractmethod
    async def scrape_conversations(self) -> List[Dict]:
        """
        Main scraping logic - returns list of conversations.
        Each conversation should have format:
        {
            'conversation_id': str,
            'title': str,
            'created_at': datetime,
            'updated_at': datetime,
            'messages': [
                {'role': 'user', 'content': '...', 'timestamp': datetime},
                {'role': 'assistant', 'content': '...', 'timestamp': datetime}
            ]
        }
        """
        pass

    @abstractmethod
    async def get_conversation_list(self, page: Page) -> List[Dict]:
        """
        Get list of conversation IDs and metadata.
        Returns: [{'id': '...', 'title': '...', 'updated_at': '...'}, ...]
        """
        pass

    @abstractmethod
    async def scrape_single_conversation(self, page: Page, conversation_id: str) -> Dict:
        """
        Scrape a single conversation's messages.
        Returns: {'messages': [...], 'metadata': {...}}
        """
        pass
