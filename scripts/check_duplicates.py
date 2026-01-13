#!/usr/bin/env python3
"""
Script to check for all types of duplicates in the database.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "volumes" / "database" / "conversations.db"

def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check 1: Duplicates by conversation_id + source (violates unique constraint)
    print("=" * 70)
    print("CHECK 1: Duplicates by conversation_id + source")
    print("=" * 70)
    cursor.execute("""
        SELECT conversation_id, source, COUNT(*) as count
        FROM conversations
        GROUP BY conversation_id, source
        HAVING COUNT(*) > 1
    """)

    id_duplicates = cursor.fetchall()
    if id_duplicates:
        print(f"Found {len(id_duplicates)} conversation_id+source duplicates:\n")
        for conv_id, source, count in id_duplicates:
            print(f"  {source}: {conv_id} ({count} copies)")

            # Get details
            cursor.execute("""
                SELECT id, title, created_at, updated_at, message_count
                FROM conversations
                WHERE conversation_id = ? AND source = ?
                ORDER BY updated_at DESC
            """, (conv_id, source))

            entries = cursor.fetchall()
            for entry in entries:
                print(f"    - DB ID {entry[0]}: '{entry[1]}' | updated={entry[3]} | msgs={entry[4]}")
            print()
    else:
        print("✓ No conversation_id+source duplicates found\n")

    # Check 2: Same title appearing multiple times (different conversation_ids)
    print("=" * 70)
    print("CHECK 2: Same title appearing multiple times")
    print("=" * 70)
    cursor.execute("""
        SELECT title, source, COUNT(*) as count
        FROM conversations
        WHERE title IS NOT NULL AND title != ''
        GROUP BY title, source
        HAVING COUNT(*) > 1
        ORDER BY count DESC
        LIMIT 20
    """)

    title_duplicates = cursor.fetchall()
    if title_duplicates:
        print(f"Found {len(title_duplicates)} titles that appear multiple times:\n")
        for title, source, count in title_duplicates:
            print(f"  '{title}' ({source}): {count} conversations")

            # Get details
            cursor.execute("""
                SELECT id, conversation_id, created_at, updated_at, message_count
                FROM conversations
                WHERE title = ? AND source = ?
                ORDER BY created_at DESC
            """, (title, source))

            entries = cursor.fetchall()
            for entry in entries:
                print(f"    - DB ID {entry[0]}: conv_id={entry[1][:20]}... | created={entry[2]} | msgs={entry[4]}")
            print()
    else:
        print("✓ No duplicate titles found\n")

    # Check 3: Total conversation count
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    cursor.execute("SELECT source, COUNT(*) FROM conversations GROUP BY source")
    counts = cursor.fetchall()
    print("Total conversations by source:")
    for source, count in counts:
        print(f"  {source}: {count}")

    cursor.execute("SELECT COUNT(*) FROM conversations")
    total = cursor.fetchone()[0]
    print(f"  TOTAL: {total}\n")

    conn.close()

if __name__ == "__main__":
    main()
