#!/usr/bin/env python3
"""
Script to identify and clean up duplicate conversations in the database.
Keeps the most recently updated version of each duplicate.
"""
import sqlite3
import sys
from pathlib import Path

# Path to database
DB_PATH = Path(__file__).parent.parent / "volumes" / "database" / "conversations.db"

def find_duplicates(conn):
    """Find conversations that appear multiple times (violating unique constraint)."""
    cursor = conn.cursor()

    # Find conversation_id + source combinations that appear more than once
    cursor.execute("""
        SELECT conversation_id, source, COUNT(*) as count
        FROM conversations
        GROUP BY conversation_id, source
        HAVING COUNT(*) > 1
    """)

    duplicates = cursor.fetchall()
    return duplicates

def get_duplicate_details(conn, conversation_id, source):
    """Get all entries for a specific conversation_id + source."""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, conversation_id, source, title, created_at, updated_at, message_count
        FROM conversations
        WHERE conversation_id = ? AND source = ?
        ORDER BY updated_at DESC
    """, (conversation_id, source))

    return cursor.fetchall()

def remove_duplicates(conn, conversation_id, source, dry_run=True):
    """
    Remove duplicate conversations, keeping only the most recently updated one.
    """
    entries = get_duplicate_details(conn, conversation_id, source)

    if len(entries) <= 1:
        return 0

    # Keep the first one (most recently updated), delete the rest
    keep_id = entries[0][0]
    delete_ids = [entry[0] for entry in entries[1:]]

    print(f"\n  Conversation: {conversation_id} ({source})")
    print(f"  Title: {entries[0][3]}")
    print(f"  Found {len(entries)} copies:")
    for entry in entries:
        print(f"    - ID {entry[0]}: updated={entry[5]}, messages={entry[6]}")
    print(f"  {'Would keep' if dry_run else 'Keeping'} ID {keep_id} (most recent)")
    print(f"  {'Would delete' if dry_run else 'Deleting'} IDs: {delete_ids}")

    if not dry_run:
        cursor = conn.cursor()
        for delete_id in delete_ids:
            # Messages will be cascade deleted due to foreign key constraint
            cursor.execute("DELETE FROM conversations WHERE id = ?", (delete_id,))
        conn.commit()

    return len(delete_ids)

def main():
    if not DB_PATH.exists():
        print(f"Error: Database not found at {DB_PATH}")
        sys.exit(1)

    # Check for --fix flag
    dry_run = "--fix" not in sys.argv

    if dry_run:
        print("DRY RUN MODE - No changes will be made")
        print("Run with --fix flag to actually remove duplicates\n")
    else:
        print("FIX MODE - Will remove duplicates!\n")

    conn = sqlite3.connect(DB_PATH)

    try:
        # Find duplicates
        duplicates = find_duplicates(conn)

        if not duplicates:
            print("✓ No duplicates found!")
            return

        print(f"Found {len(duplicates)} sets of duplicate conversations:\n")

        total_removed = 0
        for conversation_id, source, count in duplicates:
            removed = remove_duplicates(conn, conversation_id, source, dry_run)
            total_removed += removed

        print(f"\n{'Would remove' if dry_run else 'Removed'} {total_removed} duplicate entries")

        if dry_run:
            print("\nRun with --fix flag to actually remove duplicates:")
            print(f"  python {Path(__file__).name} --fix")
        else:
            print("\n✓ Duplicates removed successfully!")

    finally:
        conn.close()

if __name__ == "__main__":
    main()
