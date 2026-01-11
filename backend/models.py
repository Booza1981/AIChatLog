"""
Pydantic models for API request/response validation
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class ServiceName(str, Enum):
    """Supported chat services."""
    CLAUDE = "claude"
    CHATGPT = "chatgpt"
    GEMINI = "gemini"
    PERPLEXITY = "perplexity"
    ALL = "all"


class MessageRole(str, Enum):
    """Message roles."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class Message(BaseModel):
    """Individual message in a conversation."""
    role: MessageRole
    content: str
    timestamp: Optional[datetime] = None
    sequence_number: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class ConversationBase(BaseModel):
    """Base conversation model."""
    conversation_id: str
    source: ServiceName
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0


class ConversationCreate(ConversationBase):
    """Create conversation request."""
    messages: List[Message]
    metadata: Optional[Dict[str, Any]] = None


class ConversationResponse(ConversationBase):
    """Conversation response with messages."""
    id: int
    last_message_at: Optional[datetime] = None
    messages: Optional[List[Message]] = None

    class Config:
        from_attributes = True


class ConversationSearchResult(ConversationBase):
    """Search result with snippet."""
    id: int
    snippet: str


class SearchRequest(BaseModel):
    """Search request parameters."""
    q: str = Field(..., min_length=1, description="Search query")
    source: Optional[ServiceName] = Field(None, description="Filter by service")
    date_from: Optional[str] = Field(None, description="Filter from date (ISO format)")
    date_to: Optional[str] = Field(None, description="Filter to date (ISO format)")
    limit: int = Field(20, ge=1, le=100, description="Results per page")
    offset: int = Field(0, ge=0, description="Pagination offset")


class SearchResponse(BaseModel):
    """Search response with results and pagination."""
    results: List[ConversationSearchResult]
    total: int
    limit: int
    offset: int
    query: str


class ScrapeRequest(BaseModel):
    """Scrape trigger request."""
    service: ServiceName


class ScrapeResponse(BaseModel):
    """Scrape trigger response."""
    status: str
    service: str
    message: str
    job_id: Optional[str] = None


class ScrapeJobStatus(BaseModel):
    """Scrape job status."""
    job_id: str
    service: str
    status: str  # running, completed, failed
    started_at: datetime
    completed_at: Optional[datetime] = None
    conversations_scraped: int = 0
    error: Optional[str] = None


class ScraperStatus(BaseModel):
    """Scraper health status."""
    service: str
    last_successful_scrape: Optional[datetime] = None
    last_attempt: Optional[datetime] = None
    session_healthy: bool = False
    error_count: int = 0
    last_error_message: Optional[str] = None
    consecutive_failures: int = 0
    total_conversations_scraped: int = 0


class Stats(BaseModel):
    """Database statistics."""
    total_conversations: int
    by_source: Dict[str, int]
    total_messages: int
    date_range: Dict[str, Optional[str]]


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    timestamp: str
    database: bool
    services: List[ScraperStatus]
