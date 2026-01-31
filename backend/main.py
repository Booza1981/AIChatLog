"""
Chat History Search - FastAPI Backend
Phase 1: Full API implementation with database and search
"""

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import Optional, List
import logging
import json

from database import Database
from models import (
    SearchResponse, ConversationSearchResult, Stats,
    HealthResponse, ServiceStatus, ServiceStatusUpdate
)

# Initialize FastAPI
app = FastAPI(
    title="Chat History Search API",
    version="1.0.0",
    description="Self-hosted chat history sync and search system"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_private_network_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global database instance
db = Database()



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
            "service_status": "/api/service-status"
        }
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
async def get_recent_conversations(
    limit: int = Query(10, ge=1, le=50),
    source: Optional[str] = Query(None, description="Filter by service")
):
    """Get recent conversations."""
    try:
        conversations = await db.get_recent_conversations(limit=limit, source=source)
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
        services = await db.get_all_service_statuses()
        return HealthResponse(
            status="healthy" if db_healthy else "degraded",
            timestamp=datetime.now().isoformat(),
            database=db_healthy,
            services=[ServiceStatus(**service) for service in services]
        )
    except Exception as e:
        logger.error(f"Health check error: {e}", exc_info=True)
        return HealthResponse(
            status="unhealthy",
            timestamp=datetime.now().isoformat(),
            database=False,
            services=[]
        )


@app.get("/api/service-status", response_model=List[ServiceStatus])
async def get_service_statuses():
    """Return status for all services."""
    try:
        services = await db.get_all_service_statuses()
        return [ServiceStatus(**service) for service in services]
    except Exception as e:
        logger.error(f"Service status error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get service status: {str(e)}")


@app.post("/api/service-status")
async def update_service_status(update: ServiceStatusUpdate):
    """Update status for a service."""
    try:
        await db.update_service_status(
            service=update.service,
            success=update.success,
            session_healthy=update.session_healthy,
            error_message=update.error_message,
            total_conversations=update.total_conversations,
            last_conversation_id=update.last_conversation_id
        )
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Service status update error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update service status: {str(e)}")


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
