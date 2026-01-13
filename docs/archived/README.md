# Archived Documentation

This directory contains documentation that is no longer relevant to the current Chrome extension-based implementation but is preserved for historical reference.

## Files

### Authentication and VNC Setup (Outdated)
- **AUTHENTICATION_GUIDE.md** - Manual authentication guide for Playwright/VNC approach
- **MANUAL_AUTH.md** - Step-by-step manual auth instructions for browser automation

These are no longer needed as the Chrome extension uses the user's real browser session with existing authentication.

### Development and Debugging Notes
- **DEBUG_EXTENSION.md** - Extension debugging notes
- **DEVTOOLS_BUG.md** - Notes on Gemini devtools filtering bug
- **GEMINI_API_DISCOVERY.md** - Discovery process for Gemini's batchexecute API
- **GEMINI_TESTING_GUIDE.md** - Testing guide for Gemini scraper implementation

These documents capture the development process but are no longer needed for day-to-day usage or maintenance.

## Why These Were Archived

The project originally used Playwright browser automation with VNC for manual authentication. This approach had several issues:
- Required Docker with display server (VNC)
- Bot detection challenges
- Complex setup process
- Unreliable authentication flow

The current implementation uses a Chrome extension that runs in the user's real browser, solving all these issues. See the main README.md for current documentation.
