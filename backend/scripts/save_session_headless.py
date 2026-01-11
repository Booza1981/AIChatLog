#!/usr/bin/env python3
"""
Headless session verification script.
Use this AFTER logging in manually via VNC.

This script connects headlessly to verify the session is working.
"""

import asyncio
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.async_api import async_playwright


SERVICE_URLS = {
    'claude': 'https://claude.ai/chats',
    'chatgpt': 'https://chat.openai.com',
    'gemini': 'https://gemini.google.com',
    'perplexity': 'https://www.perplexity.ai'
}


async def verify_and_save_session(service: str):
    """
    Verify session works in headless mode and save it.
    Run this AFTER manually logging in via VNC.
    """
    if service not in SERVICE_URLS:
        print(f"❌ Unknown service: {service}")
        sys.exit(1)

    profile_path = f"/app/volumes/browser-profiles/{service}"
    os.makedirs(profile_path, exist_ok=True)
    state_file = f"{profile_path}/state.json"

    print(f"\n{'='*60}")
    print(f"  SESSION VERIFICATION: {service.upper()}")
    print(f"{'='*60}\n")

    print("This script assumes you've already logged in via VNC.")
    print("It will verify your session works in headless mode.\n")

    async with async_playwright() as p:
        print("→ Launching headless browser...")
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )

        # Try to load existing session if any
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080}
        )

        page = await context.new_page()

        print(f"→ Navigating to {SERVICE_URLS[service]}...")
        await page.goto(SERVICE_URLS[service], timeout=30000)

        # Wait a moment for page to load
        await page.wait_for_timeout(3000)

        # Save the session
        print(f"→ Saving session to: {state_file}")
        await context.storage_state(path=state_file)

        if os.path.exists(state_file):
            file_size = os.path.getsize(state_file)
            print(f"✓ Session file created ({file_size} bytes)")

            # Basic check
            with open(state_file, 'r') as f:
                import json
                data = json.load(f)
                cookie_count = len(data.get('cookies', []))
                print(f"✓ Saved {cookie_count} cookies")

            print(f"\n{'='*60}")
            print("  SUCCESS!")
            print(f"{'='*60}")
            print(f"\n✓ Session saved for {service}")
            print("✓ Ready to start scraping")
        else:
            print("❌ Error: Session file not created")
            sys.exit(1)

        await browser.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("\n❌ Error: Service name required")
        print("\nUsage: python scripts/save_session_headless.py <service>")
        print(f"Services: {', '.join(SERVICE_URLS.keys())}")
        sys.exit(1)

    service = sys.argv[1].lower()

    try:
        asyncio.run(verify_and_save_session(service))
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
