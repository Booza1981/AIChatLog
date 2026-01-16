"""
Database module for Chat History Search
Handles SQLite database with FTS5 full-text search
"""

import aiosqlite
import json
import os
from datetime import datetime
from typing import List, Dict, Optional, Tuple
from pathlib import Path


class Database:
    """
    Async SQLite database handler with FTS5 support.
    """

    def __init__(self, db_path: str = None):
        """Initialize database connection."""
        if db_path is None:
            db_path = os.getenv('DATABASE_PATH', '/app/volumes/database/conversations.db')

        self.db_path = db_path
        self.db: Optional[aiosqlite.Connection] = None

        # Ensure database directory exists
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)

    async def initialize(self):
        """
        Initialize database connection and create schema.
        Called on application startup.
        """
        self.db = await aiosqlite.connect(self.db_path)

        # Enable foreign keys
        await self.db.execute('PRAGMA foreign_keys = ON')

        # Create schema from SQL file
        schema_path = Path(__file__).parent / 'schema.sql'
        with open(schema_path, 'r') as f:
            schema_sql = f.read()

        await self.db.executescript(schema_sql)
        await self.db.commit()

        print(f"[Database] Initialized at {self.db_path}")

    async def close(self):
        """Close database connection."""
        if self.db:
            await self.db.close()

    async def check_connection(self) -> bool:
        """Check if database connection is healthy."""
        try:
            if not self.db:
                return False
            async with self.db.execute('SELECT 1') as cursor:
                result = await cursor.fetchone()
                return result == (1,)
        except Exception:
            return False

    # ==================== CONVERSATION OPERATIONS ====================

    async def upsert_conversation(
        self,
        conversation_id: str,
        source: str,
        title: Optional[str],
        messages: List[Dict],
        created_at: Optional[datetime] = None,
        updated_at: Optional[datetime] = None,
        metadata: Optional[Dict] = None
    ) -> int:
        """
        Insert or update a conversation with its messages.
        Returns the database row ID.
        """
        now = datetime.now()
        created_at = created_at or now
        updated_at = updated_at or now

        # Build full_text from messages for FTS5
        full_text_parts = []
        for msg in messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            full_text_parts.append(f"{role}: {content}")
        full_text = '\n'.join(full_text_parts)

        # Get last message timestamp
        last_message_at = None
        if messages:
            last_msg = messages[-1]
            if 'timestamp' in last_msg:
                last_message_at = last_msg['timestamp']
            else:
                last_message_at = updated_at

        # Serialize metadata to JSON
        metadata_json = json.dumps(metadata) if metadata else None

        # Upsert conversation
        async with self.db.execute(
            """
            INSERT INTO conversations (
                conversation_id, source, title, created_at, updated_at,
                last_message_at, message_count, full_text, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(conversation_id, source) DO UPDATE SET
                title = excluded.title,
                updated_at = excluded.updated_at,
                last_message_at = excluded.last_message_at,
                message_count = excluded.message_count,
                full_text = excluded.full_text,
                metadata = excluded.metadata
            RETURNING id
            """,
            (
                conversation_id, source, title, created_at, updated_at,
                last_message_at, len(messages), full_text, metadata_json
            )
        ) as cursor:
            row = await cursor.fetchone()
            db_conv_id = row[0]

        # Delete old messages for this conversation (if updating)
        await self.db.execute(
            'DELETE FROM messages WHERE conversation_id = ?',
            (db_conv_id,)
        )

        # Insert new messages
        for seq_num, msg in enumerate(messages):
            msg_timestamp = msg.get('timestamp', updated_at)
            msg_metadata = json.dumps(msg.get('metadata')) if 'metadata' in msg else None

            await self.db.execute(
                """
                INSERT INTO messages (
                    conversation_id, role, content, timestamp, sequence_number, metadata
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    db_conv_id,
                    msg['role'],
                    msg['content'],
                    msg_timestamp,
                    seq_num,
                    msg_metadata
                )
            )

        await self.db.commit()
        return db_conv_id

    async def get_conversation(self, conversation_id: int) -> Optional[Dict]:
        """Get a conversation by database ID with all messages."""
        async with self.db.execute(
            'SELECT * FROM conversations WHERE id = ?',
            (conversation_id,)
        ) as cursor:
            cursor.row_factory = aiosqlite.Row
            row = await cursor.fetchone()

            if not row:
                return None

            conv = dict(row)

            # Get messages
            async with self.db.execute(
                '''
                SELECT role, content, timestamp, sequence_number, metadata
                FROM messages
                WHERE conversation_id = ?
                ORDER BY sequence_number ASC
                ''',
                (conversation_id,)
            ) as msg_cursor:
                msg_cursor.row_factory = aiosqlite.Row
                conv['messages'] = [dict(row) async for row in msg_cursor]

            return conv

    async def check_conversations_exist(
        self,
        conversations: List[Dict[str, str]]
    ) -> List[str]:
        """
        Check which conversations need syncing.

        Args:
            conversations: List of dicts with 'conversation_id', 'source', and optionally 'updated_at'

        Returns:
            List of conversation_ids that need syncing (either don't exist or are outdated)
        """
        needs_sync = []

        for conv in conversations:
            conv_id = conv.get('conversation_id')
            source = conv.get('source')
            updated_at = conv.get('updated_at')

            if not conv_id or not source:
                continue

            # Check if conversation exists
            async with self.db.execute(
                'SELECT updated_at FROM conversations WHERE conversation_id = ? AND source = ?',
                (conv_id, source)
            ) as cursor:
                row = await cursor.fetchone()

                if not row:
                    # Doesn't exist, needs sync
                    needs_sync.append(conv_id)
                elif not updated_at:
                    # No timestamp provided (e.g., DOM stub), assume needs sync to be safe
                    needs_sync.append(conv_id)
                else:
                    # Compare timestamps
                    db_updated = row[0]

                    # Parse timestamp if it's a string
                    if isinstance(updated_at, str):
                        try:
                            new_updated = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
                        except:
                            # If parsing fails, assume needs sync
                            needs_sync.append(conv_id)
                            continue
                    else:
                        new_updated = updated_at

                    # Parse DB timestamp
                    if isinstance(db_updated, str):
                        try:
                            db_updated = datetime.fromisoformat(db_updated.replace('Z', '+00:00'))
                        except:
                            # If parsing fails, assume needs sync
                            needs_sync.append(conv_id)
                            continue

                    # If new version is newer, needs sync
                    if new_updated > db_updated:
                        needs_sync.append(conv_id)

        return needs_sync

    # ==================== SEARCH OPERATIONS ====================

    async def search_conversations(
        self,
        query: str,
        source: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        limit: int = 20,
        offset: int = 0
    ) -> Tuple[List[Dict], int]:
        """
        Full-text search conversations using FTS5.
        Returns (results, total_count).
        """
        # Build WHERE clause
        where_clauses = ['conversations_fts MATCH ?']
        params = [query]

        if source:
            where_clauses.append('c.source = ?')
            params.append(source)

        if date_from:
            where_clauses.append('c.created_at >= ?')
            params.append(date_from)

        if date_to:
            where_clauses.append('c.created_at <= ?')
            params.append(date_to)

        where_clause = ' AND '.join(where_clauses)

        # Get total count
        count_sql = f'''
            SELECT COUNT(*)
            FROM conversations c
            JOIN conversations_fts ON conversations_fts.rowid = c.id
            WHERE {where_clause}
        '''

        async with self.db.execute(count_sql, params) as cursor:
            row = await cursor.fetchone()
            total_count = row[0]

        # Get results with snippets
        search_sql = f'''
            SELECT
                c.id,
                c.conversation_id,
                c.source,
                c.title,
                c.created_at,
                c.updated_at,
                c.message_count,
                snippet(conversations_fts, 1, '<mark>', '</mark>', '...', 32) as snippet
            FROM conversations c
            JOIN conversations_fts ON conversations_fts.rowid = c.id
            WHERE {where_clause}
            ORDER BY c.updated_at DESC
            LIMIT ? OFFSET ?
        '''

        params.extend([limit, offset])

        async with self.db.execute(search_sql, params) as cursor:
            cursor.row_factory = aiosqlite.Row
            results = [dict(row) async for row in cursor]

        return results, total_count

    # ==================== STATISTICS ====================

    async def get_stats(self) -> Dict:
        """Get database statistics."""
        stats = {}

        # Total conversations
        async with self.db.execute('SELECT COUNT(*) FROM conversations') as cursor:
            row = await cursor.fetchone()
            stats['total_conversations'] = row[0]

        # By source
        async with self.db.execute(
            'SELECT source, COUNT(*) FROM conversations GROUP BY source'
        ) as cursor:
            by_source = {row[0]: row[1] async for row in cursor}
            stats['by_source'] = by_source

        # Total messages
        async with self.db.execute('SELECT COUNT(*) FROM messages') as cursor:
            row = await cursor.fetchone()
            stats['total_messages'] = row[0]

        # Date range
        async with self.db.execute(
            'SELECT MIN(created_at), MAX(created_at) FROM conversations'
        ) as cursor:
            row = await cursor.fetchone()
            stats['date_range'] = {
                'earliest': row[0],
                'latest': row[1]
            }

        return stats

    # ==================== SCRAPER STATUS ====================

    async def update_scraper_status(
        self,
        service: str,
        success: bool,
        error_message: Optional[str] = None,
        total_conversations: Optional[int] = None
    ):
        """Update scraper status after a scrape attempt."""
        now = datetime.now()

        if success:
            await self.db.execute(
                '''
                UPDATE scraper_status SET
                    last_successful_scrape = ?,
                    last_attempt = ?,
                    session_healthy = 1,
                    consecutive_failures = 0,
                    last_error_message = NULL,
                    total_conversations_scraped = COALESCE(?, total_conversations_scraped)
                WHERE service = ?
                ''',
                (now, now, total_conversations, service)
            )
        else:
            await self.db.execute(
                '''
                UPDATE scraper_status SET
                    last_attempt = ?,
                    session_healthy = 0,
                    error_count = error_count + 1,
                    consecutive_failures = consecutive_failures + 1,
                    last_error_message = ?
                WHERE service = ?
                ''',
                (now, error_message, service)
            )

        await self.db.commit()

    async def get_scraper_status(self, service: str) -> Optional[Dict]:
        """Get scraper status for a service."""
        async with self.db.execute(
            'SELECT * FROM scraper_status WHERE service = ?',
            (service,)
        ) as cursor:
            cursor.row_factory = aiosqlite.Row
            row = await cursor.fetchone()
            return dict(row) if row else None

    async def get_all_scraper_statuses(self) -> List[Dict]:
        """Get all scraper statuses."""
        async with self.db.execute('SELECT * FROM scraper_status') as cursor:
            cursor.row_factory = aiosqlite.Row
            return [dict(row) async for row in cursor]

    async def get_recent_conversations(self, limit: int = 10) -> List[Dict]:
        """Get recent conversations ordered by updated_at."""
        async with self.db.execute(
            '''
            SELECT
                id,
                conversation_id,
                source,
                title,
                created_at,
                updated_at,
                message_count
            FROM conversations
            ORDER BY updated_at DESC
            LIMIT ?
            ''',
            (limit,)
        ) as cursor:
            cursor.row_factory = aiosqlite.Row
            return [dict(row) async for row in cursor]
