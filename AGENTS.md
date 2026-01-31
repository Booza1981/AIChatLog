# Repository Guidelines

## Project Structure & Module Organization

- `backend/`: FastAPI service, SQLite/FTS5 database access, and scraper stubs.
- `frontend/`: Static search UI served via Docker (HTML/CSS).
- `chrome-extension/`: Manifest V3 extension, background worker, popup UI, and content scripts.
- `scripts/`: Maintenance utilities (duplicate fixes, cleanup).
- `docs/` and `docs/archived/`: Current and legacy documentation.
- `Database/`: Runtime data; SQLite database stored here by default (override with `DATABASE_VOLUME_PATH`).

## Build, Test, and Development Commands

- `docker-compose up -d`: Start backend and frontend containers.
- `docker-compose logs -f backend`: Tail API logs during sync and search.
- `test-extension.sh`: Sanity-check Docker, backend health, and database counts.
- `curl http://localhost:8000/api/health`: Quick API health probe.

## Coding Style & Naming Conventions

- Python: 4-space indentation, type hints where practical, keep FastAPI handlers small and focused.
- JavaScript: 2-space indentation; prefer `const`/`let`, avoid globals in content scripts.
- Files: keep new extension scripts in `chrome-extension/`, backend logic in `backend/`.
- Naming: use descriptive, service-specific identifiers (e.g., `gemini-api.js`, `chatgpt-sync-state-manager.js`).

## Testing Guidelines

- No formal test runner configured; `backend/test_*.py` are ad-hoc scripts.
- Run individual tests directly, e.g. `python backend/test_detection.py`.
- Extension changes should be validated manually in Chrome via the popup and DevTools console.

## Commit & Pull Request Guidelines

- Commit history uses short, imperative summaries (e.g., “Fix Gemini sync…”, “Add database cleanup…”).
- Keep commits scoped to one subsystem when possible (backend, extension, or frontend).
- PRs should describe the user-visible behavior change, list verification steps, and include screenshots for UI/extension changes.

## Security & Configuration Notes

- Local services run on `localhost:8000` (API) and `localhost:3000` (UI).
- Do not expose these ports publicly without adding authentication.
- Extension uses browser session cookies; avoid logging sensitive tokens in debug output.
