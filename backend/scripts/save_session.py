#!/usr/bin/env python3
"""
Interactive session saving script for chat services.
Run this inside VNC environment after logging into a service.

Usage:
    python scripts/save_session.py <service>

    Services: claude, chatgpt, gemini, perplexity
"""

import asyncio
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.async_api import async_playwright


SERVICE_URLS = {
    'claude': 'https://claude.ai/chats',
    'chatgpt': 'https://chat.openai.com',
    'gemini': 'https://gemini.google.com',
    'perplexity': 'https://www.perplexity.ai'
}


async def save_session_interactive(service: str):
    """
    Interactive session saving script.
    Launches browser with display (VNC provides X11).
    """
    if service not in SERVICE_URLS:
        print(f"❌ Unknown service: {service}")
        print(f"   Available services: {', '.join(SERVICE_URLS.keys())}")
        sys.exit(1)

    profile_path = f"/app/volumes/browser-profiles/{service}"
    os.makedirs(profile_path, exist_ok=True)
    state_file = f"{profile_path}/state.json"

    print(f"\n{'='*60}")
    print(f"  SAVE SESSION: {service.upper()}")
    print(f"{'='*60}\n")

    async with async_playwright() as p:
        # Launch browser with display (VNC provides X11)
        print("→ Launching browser...")
        browser = await p.chromium.launch(
            headless=False,  # Show browser in VNC
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )

        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080}
        )

        page = await context.new_page()

        print(f"→ Navigating to {SERVICE_URLS[service]}...")
        await page.goto(SERVICE_URLS[service])

        print(f"\n{'='*60}")
        print("  INSTRUCTIONS")
        print(f"{'='*60}")
        print("\n1. Complete login in the browser window that just opened")
        print("2. Handle 2FA if required")
        print("3. Verify you can see your conversations/chat interface")
        print("4. Return here and press Enter when done")
        print("\n⏳ Waiting for user confirmation...")

        # Wait for user confirmation in terminal
        input("\n→ Press Enter after logging in...")

        # Save session state
        print(f"\n→ Saving session to: {state_file}")
        await context.storage_state(path=state_file)

        # Verify file was created
        if os.path.exists(state_file):
            file_size = os.path.getsize(state_file)
            print(f"✓ Session saved successfully ({file_size} bytes)")
            print(f"\n{'='*60}")
            print("  SUCCESS!")
            print(f"{'='*60}")
            print(f"\n✓ Session saved for {service}")
            print("✓ You can now close the VNC window")
            print("✓ Run automated scraping with:")
            print(f"  curl -X POST http://localhost:8000/api/scrape/{service}")
        else:
            print("❌ Error: Session file not created")
            sys.exit(1)

        await browser.close()


def main():
    if len(sys.argv) < 2:
        print("\n❌ Error: Service name required")
        print("\nUsage: python scripts/save_session.py <service>")
        print(f"Services: {', '.join(SERVICE_URLS.keys())}")
        print("\nExample:")
        print("  python scripts/save_session.py claude")
        sys.exit(1)

    service = sys.argv[1].lower()

    try:
        asyncio.run(save_session_interactive(service))
    except KeyboardInterrupt:
        print("\n\n⚠ Cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
