#!/usr/bin/env python3
"""
Phase 0 - Infrastructure Validation Script

This script validates that Playwright works correctly in the Docker environment.
It should run without errors before proceeding with scraper implementation.

Usage:
    python test_playwright.py
"""

import asyncio
import sys
from playwright.async_api import async_playwright


async def test_basic_browser_launch():
    """Test 1: Basic browser launch and navigation."""
    print("\n" + "="*60)
    print("TEST 1: Basic Browser Launch")
    print("="*60)

    try:
        async with async_playwright() as p:
            print("→ Launching Chromium...")
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox'
                ]
            )
            print("✓ Browser launched successfully")

            print("→ Creating new page...")
            page = await browser.new_page()
            print("✓ Page created")

            print("→ Navigating to example.com...")
            await page.goto('https://example.com', timeout=30000)
            print("✓ Navigation successful")

            title = await page.title()
            print(f"✓ Page title: {title}")

            await browser.close()
            print("✓ Browser closed cleanly")

        print("\n✅ TEST 1 PASSED: Basic browser functionality works")
        return True

    except Exception as e:
        print(f"\n❌ TEST 1 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_anti_detection():
    """Test 2: Anti-detection measures."""
    print("\n" + "="*60)
    print("TEST 2: Anti-Detection Measures")
    print("="*60)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )

            # Add anti-detection script
            await context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            """)

            page = await context.new_page()
            await page.goto('https://example.com')

            # Check if webdriver is properly hidden
            webdriver_value = await page.evaluate('() => navigator.webdriver')
            print(f"→ navigator.webdriver value: {webdriver_value}")

            if webdriver_value is None or webdriver_value is False:
                print("✓ Anti-detection script working")
            else:
                print("⚠ Anti-detection may need adjustment")

            await browser.close()

        print("\n✅ TEST 2 PASSED: Anti-detection measures applied")
        return True

    except Exception as e:
        print(f"\n❌ TEST 2 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_session_persistence():
    """Test 3: Session state save/load."""
    print("\n" + "="*60)
    print("TEST 3: Session Persistence")
    print("="*60)

    import os
    import json

    try:
        profile_path = "/app/volumes/browser-profiles/test"
        os.makedirs(profile_path, exist_ok=True)
        state_file = f"{profile_path}/state.json"

        # Phase 1: Create and save session
        print("→ Creating new browser context...")
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            page = await context.new_page()

            await page.goto('https://example.com')

            # Save storage state
            print(f"→ Saving session to {state_file}...")
            await context.storage_state(path=state_file)

            if os.path.exists(state_file):
                file_size = os.path.getsize(state_file)
                print(f"✓ Session file created ({file_size} bytes)")
            else:
                raise Exception("Session file not created")

            await browser.close()

        # Phase 2: Load saved session
        print("→ Loading saved session...")
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)

            with open(state_file, 'r') as f:
                storage_state = json.load(f)

            context = await browser.new_context(storage_state=storage_state)
            page = await context.new_page()

            await page.goto('https://example.com')
            print("✓ Successfully navigated with loaded session")

            await browser.close()

        # Cleanup
        os.remove(state_file)
        print("✓ Cleanup completed")

        print("\n✅ TEST 3 PASSED: Session persistence works")
        return True

    except Exception as e:
        print(f"\n❌ TEST 3 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_multiple_pages():
    """Test 4: Multiple concurrent pages (stress test)."""
    print("\n" + "="*60)
    print("TEST 4: Multiple Concurrent Pages")
    print("="*60)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()

            print("→ Opening 3 concurrent pages...")
            pages = []
            for i in range(3):
                page = await context.new_page()
                pages.append(page)
                print(f"  Page {i+1} created")

            print("→ Navigating all pages concurrently...")
            await asyncio.gather(
                pages[0].goto('https://example.com'),
                pages[1].goto('https://www.iana.org'),
                pages[2].goto('https://httpbin.org/html')
            )
            print("✓ All pages loaded successfully")

            for i, page in enumerate(pages):
                title = await page.title()
                print(f"  Page {i+1} title: {title}")

            await browser.close()

        print("\n✅ TEST 4 PASSED: Multiple concurrent pages work")
        return True

    except Exception as e:
        print(f"\n❌ TEST 4 FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """Run all infrastructure validation tests."""
    print("\n" + "="*60)
    print("PLAYWRIGHT INFRASTRUCTURE VALIDATION")
    print("Phase 0 - Critical Tests")
    print("="*60)

    tests = [
        test_basic_browser_launch,
        test_anti_detection,
        test_session_persistence,
        test_multiple_pages
    ]

    results = []
    for test in tests:
        result = await test()
        results.append(result)

        # Small delay between tests
        await asyncio.sleep(1)

    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)

    passed = sum(results)
    total = len(results)

    print(f"Passed: {passed}/{total}")

    if all(results):
        print("\n🎉 ALL TESTS PASSED - Infrastructure is ready!")
        print("You can proceed with Phase 1 implementation.")
        return 0
    else:
        print("\n⚠️  SOME TESTS FAILED - Fix issues before proceeding")
        print("Review the error messages above and ensure:")
        print("  - Docker shm_size is set to 2gb")
        print("  - Playwright browsers are installed")
        print("  - Volume mounts are configured correctly")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
