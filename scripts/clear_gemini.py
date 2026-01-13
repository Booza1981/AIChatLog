#!/usr/bin/env python3
"""
Clear all Gemini conversations from the database.
Use this to clean up after data corruption.

Run from host with: docker exec chat-history-backend python /app/scripts/clear_gemini.py
"""

import sqlite3
import sys

# Database path inside Docker container
DB_PATH = "/app/volumes/database/conversations.db"


def clear_gemini():
    """Delete all Gemini conversations and their search index entries."""

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get count before deletion
    cursor.execute("SELECT COUNT(*) FROM conversations WHERE source = 'gemini'")
    count = cursor.fetchone()[0]

    if count == 0:
        print("No Gemini conversations found in database.")
        conn.close()
        return

    print(f"Found {count} Gemini conversations to delete.")

    # Delete from search index first (foreign key constraint)
    cursor.execute(
        "DELETE FROM conversations_fts WHERE rowid IN (SELECT id FROM conversations WHERE source = 'gemini')"
    )
    print("✓ Deleted search index entries")

    # Delete conversations
    cursor.execute("DELETE FROM conversations WHERE source = 'gemini'")
    print("✓ Deleted conversation records")

    # Commit changes
    conn.commit()

    # Verify deletion
    cursor.execute("SELECT COUNT(*) FROM conversations WHERE source = 'gemini'")
    remaining = cursor.fetchone()[0]

    if remaining == 0:
        print(f"\n✅ Successfully deleted all {count} Gemini conversations")
    else:
        print(f"\n⚠️ Warning: {remaining} Gemini conversations still remain")

    conn.close()


if __name__ == "__main__":
    clear_gemini()
