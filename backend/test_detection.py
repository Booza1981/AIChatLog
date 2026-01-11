#!/usr/bin/env python3
"""
Test what might be detecting us as a bot
"""
import asyncio
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

async def test_detection():
    async with async_playwright() as p:
        browser = await p.firefox.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            viewport={'width': 1920, 'height': 1080},
        )

        page = await context.new_page()
        await stealth_async(page)

        # Test bot detection
        print("Testing bot detection signals...")

        # Navigate to a bot detection test page
        await page.goto('https://bot.sannysoft.com/', timeout=30000)
        await page.wait_for_timeout(5000)

        # Take screenshot
        await page.screenshot(path='/app/volumes/database/bot_detection.png')
        print("Screenshot saved to /app/volumes/database/bot_detection.png")

        # Check for webdriver property
        webdriver = await page.evaluate('() => navigator.webdriver')
        print(f"navigator.webdriver: {webdriver}")

        # Check for automation flags
        chrome = await page.evaluate('() => window.chrome')
        print(f"window.chrome: {chrome}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(test_detection())
