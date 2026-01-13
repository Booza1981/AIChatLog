"""
Chat History Search - FastAPI Backend
Phase 1: Full API implementation with database and search
"""

from fastapi import FastAPI, BackgroundTasks, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import Optional
import uuid
import logging
import json

from database import Database
from models import (
    SearchResponse, ConversationSearchResult, Stats,
    HealthResponse, ScraperStatus, ScrapeResponse,
    ScrapeJobStatus, ServiceName
)
from scrapers.claude import ClaudeScraper

# Initialize FastAPI
app = FastAPI(
    title="Chat History Search API",
    version="1.0.0",
    description="Self-hosted chat history scraper and search system"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global database instance
db = Database()

# Global state for tracking active scraping jobs
active_jobs: dict[str, dict] = {}

# Scraper registry
SCRAPERS = {
    'claude': ClaudeScraper,  # Phase 2 - IMPLEMENTED ✓
    'chatgpt': None,  # ChatGPTScraper - Phase 4
    'gemini': None,  # GeminiScraper - Phase 4
    'perplexity': None  # PerplexityScraper - Phase 4
}


async def run_scraper_task(service: str, job_id: str):
    """
    Background task that runs the scraper.
    Updates active_jobs dict with progress/status.
    """
    try:
        # Update job status
        active_jobs[job_id] = {
            'service': service,
            'status': 'running',
            'started_at': datetime.now(),
            'conversations_scraped': 0,
            'error': None
        }

        # Get scraper class
        scraper_class = SCRAPERS.get(service)
        if not scraper_class:
            raise ValueError(f"Scraper not yet implemented for: {service}")

        # Initialize scraper
        scraper = scraper_class()

        # Check session health first
        is_healthy, error_msg = await scraper.check_session_health()
        if not is_healthy:
            active_jobs[job_id]['status'] = 'failed'
            active_jobs[job_id]['error'] = f"Session unhealthy: {error_msg}"

            # Update database
            await db.update_scraper_status(
                service=service,
                success=False,
                error_message=error_msg
            )
            return

        logger.info(f"[{service}] Session healthy, starting scrape...")

        # Run scraper
        conversations = await scraper.scrape_conversations()

        # Save to database
        saved_count = 0
        for conv in conversations:
            try:
                await db.upsert_conversation(
                    conversation_id=conv['conversation_id'],
                    source=service,
                    title=conv.get('title'),
                    messages=conv['messages'],
                    created_at=conv.get('created_at'),
                    updated_at=conv.get('updated_at')
                )
                saved_count += 1
                active_jobs[job_id]['conversations_scraped'] = saved_count
            except Exception as e:
                logger.error(f"[{service}] Error saving conversation: {e}")
                continue

        # Mark job as completed
        active_jobs[job_id]['status'] = 'completed'
        active_jobs[job_id]['completed_at'] = datetime.now()
        active_jobs[job_id]['total_conversations'] = saved_count

        # Update scraper status in database
        await db.update_scraper_status(
            service=service,
            success=True,
            total_conversations=saved_count
        )

        logger.info(f"[{service}] Scrape completed: {saved_count} conversations saved")

    except Exception as e:
        logger.error(f"[{service}] Scraping failed: {e}", exc_info=True)
        active_jobs[job_id]['status'] = 'failed'
        active_jobs[job_id]['error'] = str(e)

        # Update database
        await db.update_scraper_status(
            service=service,
            success=False,
            error_message=str(e)
        )


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "Chat History Search API",
        "version": "1.0.0",
        "phase": "Phase 1 - Foundation Complete",
        "status": "operational",
        "docs": "/docs",
        "endpoints": {
            "search": "/api/search",
            "stats": "/api/stats",
            "health": "/api/health",
            "scrape": "/api/scrape/{service}"
        }
    }


@app.post("/api/scrape/{service}", response_model=ScrapeResponse)
async def trigger_scrape(service: str, background_tasks: BackgroundTasks):
    """
    Trigger scraping for a specific service or all services.
    Runs in background to avoid blocking the request.

    Args:
        service: 'claude', 'chatgpt', 'gemini', 'perplexity', or 'all'

    Returns:
        Immediate response with job ID for tracking
    """
    # Validate service
    valid_services = list(SCRAPERS.keys()) + ['all']
    if service not in valid_services:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid service. Must be one of: {', '.join(valid_services)}"
        )

    # Check if service scraper is implemented
    if service != 'all' and SCRAPERS[service] is None:
        raise HTTPException(
            status_code=501,
            detail=f"Scraper not yet implemented for {service}. Available in Phase 2/4."
        )

    # Check if service is already running
    for job_id, job in active_jobs.items():
        if job['service'] == service and job['status'] == 'running':
            return ScrapeResponse(
                status='already_running',
                service=service,
                message=f"Scrape already in progress for {service}",
                job_id=job_id
            )

    # Generate job ID
    job_id = str(uuid.uuid4())

    # Schedule background task(s)
    if service == 'all':
        # Schedule all implemented services
        implemented_services = [svc for svc, cls in SCRAPERS.items() if cls is not None]
        for svc in implemented_services:
            svc_job_id = f"{job_id}-{svc}"
            background_tasks.add_task(run_scraper_task, svc, svc_job_id)

        return ScrapeResponse(
            status='started',
            service='all',
            message=f"Started scraping for {len(implemented_services)} services",
            job_id=job_id
        )
    else:
        # Schedule single service
        background_tasks.add_task(run_scraper_task, service, job_id)

        return ScrapeResponse(
            status='started',
            service=service,
            message=f"Started scraping for {service}",
            job_id=job_id
        )


@app.get("/api/scrape/status/{job_id}")
async def get_scrape_status(job_id: str):
    """
    Get status of a scraping job.

    Returns:
        Job status including progress and errors
    """
    # Check if job exists
    if job_id not in active_jobs:
        # Also check for 'all' jobs
        matching_jobs = {k: v for k, v in active_jobs.items() if k.startswith(job_id)}
        if matching_jobs:
            return {
                'job_id': job_id,
                'type': 'batch',
                'jobs': matching_jobs
            }
        else:
            raise HTTPException(status_code=404, detail="Job not found")

    return {
        'job_id': job_id,
        **active_jobs[job_id]
    }


@app.get("/api/search", response_model=SearchResponse)
async def search_conversations(
    q: str = Query(..., min_length=1, description="Search query"),
    source: Optional[str] = Query(None, description="Filter by service"),
    date_from: Optional[str] = Query(None, description="Filter from date (ISO format)"),
    date_to: Optional[str] = Query(None, description="Filter to date (ISO format)"),
    limit: int = Query(20, ge=1, le=100, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset")
):
    """
    Full-text search conversations using FTS5.
    Returns matching conversations with highlighted snippets.
    """
    try:
        results, total = await db.search_conversations(
            query=q,
            source=source,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
            offset=offset
        )

        # Convert to response models
        search_results = [
            ConversationSearchResult(**result)
            for result in results
        ]

        return SearchResponse(
            results=search_results,
            total=total,
            limit=limit,
            offset=offset,
            query=q
        )

    except Exception as e:
        logger.error(f"Search error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@app.get("/api/stats", response_model=Stats)
async def get_stats():
    """Return statistics about stored conversations."""
    try:
        stats = await db.get_stats()
        return Stats(**stats)
    except Exception as e:
        logger.error(f"Stats error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


@app.get("/api/recent")
async def get_recent_conversations(limit: int = Query(10, ge=1, le=50)):
    """Get recent conversations."""
    try:
        conversations = await db.get_recent_conversations(limit=limit)
        return {"conversations": conversations}
    except Exception as e:
        logger.error(f"Recent conversations error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get recent conversations: {str(e)}")


@app.post("/api/conversations/check")
async def check_conversations(request: Request):
    """
    Check which conversations need syncing.

    Takes a list of conversations with their IDs and timestamps,
    returns which ones need to be synced (either don't exist or are outdated).

    Request body:
    {
        "conversations": [
            {"conversation_id": "abc123", "source": "gemini", "updated_at": "2026-01-13T10:00:00Z"},
            ...
        ]
    }

    Response:
    {
        "needs_sync": ["abc123", "def456", ...]
    }
    """
    try:
        data = await request.json()
        conversations = data.get('conversations', [])

        if not conversations:
            return {"needs_sync": []}

        needs_sync = await db.check_conversations_exist(conversations)

        logger.info(f"Checked {len(conversations)} conversations, {len(needs_sync)} need syncing")

        return {
            "needs_sync": needs_sync,
            "total_checked": len(conversations),
            "total_needs_sync": len(needs_sync)
        }
    except Exception as e:
        logger.error(f"Check conversations error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to check conversations: {str(e)}")


@app.post("/api/import/{service}")
async def import_conversations(service: str, request: Request):
    """
    Import conversations from browser extension.

    This endpoint receives conversations extracted by the browser extension
    running in the user's real browser (no bot detection issues).
    """
    try:
        data = await request.json()
        conversations = data.get('conversations', [])

        if not conversations:
            return {"status": "success", "imported": 0, "message": "No conversations to import"}

        processed = 0

        for conv in conversations:
            # Parse timestamps
            created_at = datetime.fromisoformat(conv.get('created_at', conv['updated_at']).replace('Z', '+00:00'))
            updated_at = datetime.fromisoformat(conv['updated_at'].replace('Z', '+00:00'))

            # Parse message timestamps
            messages = conv.get('messages', [])
            for msg in messages:
                if 'timestamp' in msg and isinstance(msg['timestamp'], str):
                    msg['timestamp'] = datetime.fromisoformat(msg['timestamp'].replace('Z', '+00:00'))

            # Store conversation (upsert handles insert/update automatically)
            await db.upsert_conversation(
                conversation_id=conv['conversation_id'],
                source=service,
                title=conv['title'],
                created_at=created_at,
                updated_at=updated_at,
                messages=messages
            )
            processed += 1

        logger.info(f"Imported {processed} conversations from {service}")

        return {
            "status": "success",
            "imported": processed,
            "service": service
        }

    except Exception as e:
        logger.error(f"Import failed for {service}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Import failed: {str(e)}"
        )


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: int):
    """
    Get a full conversation with all messages.
    Returns HTML page showing the complete conversation.
    """
    try:
        conversation = await db.get_conversation(conversation_id)

        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Return HTML view
        messages_html = ""
        for msg in conversation['messages']:
            role_class = "user" if msg['role'] == 'user' else "assistant"
            messages_html += f"""
                <div class="message {role_class}">
                    <div class="message-role">{msg['role'].title()}</div>
                    <div class="message-content">{msg['content']}</div>
                    <div class="message-time">{msg['timestamp']}</div>
                </div>
            """

        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>{conversation['title']}</title>
            <style>
                body {{ font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }}
                h1 {{ color: #1f2937; }}
                .meta {{ color: #6b7280; font-size: 14px; margin-bottom: 30px; }}
                .message {{ margin: 20px 0; padding: 16px; border-radius: 8px; }}
                .message.user {{ background: #eff6ff; }}
                .message.assistant {{ background: #f3f4f6; }}
                .message-role {{ font-weight: 600; font-size: 12px; color: #6b7280; text-transform: uppercase; margin-bottom: 8px; }}
                .message-content {{ line-height: 1.6; white-space: pre-wrap; }}
                .message-time {{ font-size: 12px; color: #9ca3af; margin-top: 8px; }}
                .back-link {{ color: #3b82f6; text-decoration: none; }}
            </style>
        </head>
        <body>
            <a href="/" class="back-link">← Back to Search</a>
            <h1>{conversation['title']}</h1>
            <div class="meta">
                <strong>{conversation['source'].title()}</strong> •
                {conversation['message_count']} messages •
                Last updated: {conversation['updated_at']}
            </div>
            {messages_html}
        </body>
        </html>
        """

        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=html)

    except Exception as e:
        logger.error(f"Error getting conversation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint for Docker healthcheck.
    Returns system status and service health.
    """
    try:
        db_healthy = await db.check_connection()
        service_statuses = await db.get_all_scraper_statuses()

        scraper_statuses = [
            ScraperStatus(**status)
            for status in service_statuses
        ]

        return HealthResponse(
            status="healthy" if db_healthy else "degraded",
            timestamp=datetime.now().isoformat(),
            database=db_healthy,
            services=scraper_statuses
        )
    except Exception as e:
        logger.error(f"Health check error: {e}", exc_info=True)
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.now().isoformat(),
            database=False,
            services=[]
        )


@app.post("/api/auto-log")
async def auto_log(request: Request):
    """
    Automatic console log receiver - captures ALL console output from extension.
    """
    try:
        data = await request.json()
        log_file = "/app/extension-console.log"

        # Format log entry with level indicator
        level = data.get('level', 'LOG')
        timestamp = data.get('timestamp', datetime.now().isoformat())
        message = data.get('message', '')
        url = data.get('url', '')

        log_entry = f"[{timestamp}] [{level}] {message}\n"

        # Append to file
        with open(log_file, 'a') as f:
            f.write(log_entry)

        return {"status": "logged"}
    except Exception as e:
        # Don't log to avoid recursion
        return {"status": "error", "message": str(e)}


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    try:
        await db.initialize()
        logger.info("✓ Database initialized successfully")
        logger.info("✓ Application started - Phase 1 Complete")
    except Exception as e:
        logger.error(f"Startup failed: {e}", exc_info=True)
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    await db.close()
    logger.info("Application shutdown complete")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
