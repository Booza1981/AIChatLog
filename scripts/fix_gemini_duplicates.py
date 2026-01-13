#!/usr/bin/env python3
"""
Script to fix Gemini conversation duplicates caused by inconsistent "c_" prefix usage.
Normalizes all Gemini conversation IDs to remove "c_" prefix and removes duplicates.
"""
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "volumes" / "database" / "conversations.db"

def normalize_id(conv_id):
    """Remove 'c_' prefix if present"""
    if conv_id and conv_id.startswith('c_'):
        return conv_id[2:]  # Remove first 2 characters
    return conv_id

def find_gemini_id_duplicates(conn):
    """
    Find Gemini conversations where the same base ID exists with and without 'c_' prefix.
    Returns list of (id_without_prefix, [list of db rows with this ID]).
    """
    cursor = conn.cursor()

    # Get all Gemini conversations
    cursor.execute("""
        SELECT id, conversation_id, title, created_at, updated_at, message_count
        FROM conversations
        WHERE source = 'gemini'
        ORDER BY conversation_id
    """)

    all_gemini = cursor.fetchall()

    # Group by normalized ID
    by_normalized_id = {}
    for row in all_gemini:
        db_id, conv_id, title, created, updated, msg_count = row
        normalized = normalize_id(conv_id)

        if normalized not in by_normalized_id:
            by_normalized_id[normalized] = []

        by_normalized_id[normalized].append({
            'db_id': db_id,
            'conv_id': conv_id,
            'title': title,
            'created_at': created,
            'updated_at': updated,
            'message_count': msg_count
        })

    # Find groups with more than one entry (duplicates)
    duplicates = {}
    for normalized_id, entries in by_normalized_id.items():
        if len(entries) > 1:
            duplicates[normalized_id] = entries

    return duplicates

def fix_duplicates(conn, dry_run=True):
    """
    Fix duplicates by:
    1. Keeping the entry with more messages (or most recent if tied)
    2. Renaming its conversation_id to normalized format (without c_ prefix)
    3. Deleting other entries
    """
    duplicates = find_gemini_id_duplicates(conn)

    if not duplicates:
        print("✓ No Gemini ID duplicates found!")
        return 0

    print(f"Found {len(duplicates)} sets of Gemini duplicates:\n")

    total_removed = 0
    total_updated = 0

    for normalized_id, entries in duplicates.items():
        print(f"Normalized ID: {normalized_id}")
        print(f"  Found {len(entries)} copies:")

        for entry in entries:
            print(f"    - DB ID {entry['db_id']}: conv_id='{entry['conv_id']}' | "
                  f"title='{entry['title'][:50]}' | msgs={entry['message_count']}")

        # Sort by: most messages first, then most recent
        sorted_entries = sorted(
            entries,
            key=lambda x: (x['message_count'], x['updated_at']),
            reverse=True
        )

        # Keep the first one (best candidate)
        keep_entry = sorted_entries[0]
        delete_entries = sorted_entries[1:]

        print(f"  {'Would keep' if dry_run else 'Keeping'} DB ID {keep_entry['db_id']} "
              f"({keep_entry['message_count']} msgs)")

        # Update the kept entry to use normalized ID
        if keep_entry['conv_id'] != normalized_id:
            print(f"  {'Would update' if dry_run else 'Updating'} conversation_id: "
                  f"'{keep_entry['conv_id']}' → '{normalized_id}'")
            if not dry_run:
                conn.execute(
                    "UPDATE conversations SET conversation_id = ? WHERE id = ?",
                    (normalized_id, keep_entry['db_id'])
                )
                total_updated += 1

        # Delete the others
        for entry in delete_entries:
            print(f"  {'Would delete' if dry_run else 'Deleting'} DB ID {entry['db_id']}")
            if not dry_run:
                conn.execute("DELETE FROM conversations WHERE id = ?", (entry['db_id'],))
                total_removed += 1

        print()

    if not dry_run:
        conn.commit()

    print(f"\nSummary:")
    print(f"  {'Would update' if dry_run else 'Updated'} {total_updated} conversation IDs")
    print(f"  {'Would remove' if dry_run else 'Removed'} {total_removed} duplicate entries")

    return total_removed

def normalize_all_gemini_ids(conn, dry_run=True):
    """
    Normalize ALL Gemini conversation IDs to remove 'c_' prefix.
    This prevents future duplicates.
    """
    cursor = conn.cursor()

    # Find all Gemini conversations with 'c_' prefix
    cursor.execute("""
        SELECT id, conversation_id
        FROM conversations
        WHERE source = 'gemini' AND conversation_id LIKE 'c_%'
    """)

    to_normalize = cursor.fetchall()

    if not to_normalize:
        print("✓ All Gemini conversation IDs already normalized!\n")
        return 0

    print(f"Found {len(to_normalize)} Gemini conversations with 'c_' prefix to normalize:\n")

    for db_id, conv_id in to_normalize[:10]:  # Show first 10
        normalized = normalize_id(conv_id)
        print(f"  DB ID {db_id}: '{conv_id}' → '{normalized}'")

    if len(to_normalize) > 10:
        print(f"  ... and {len(to_normalize) - 10} more")

    print()

    if not dry_run:
        for db_id, conv_id in to_normalize:
            normalized = normalize_id(conv_id)
            conn.execute(
                "UPDATE conversations SET conversation_id = ? WHERE id = ?",
                (normalized, db_id)
            )
        conn.commit()
        print(f"✓ Normalized {len(to_normalize)} conversation IDs\n")
    else:
        print(f"{'Would normalize' if dry_run else 'Normalized'} {len(to_normalize)} conversation IDs\n")

    return len(to_normalize)

def main():
    if not DB_PATH.exists():
        print(f"Error: Database not found at {DB_PATH}")
        sys.exit(1)

    dry_run = "--fix" not in sys.argv

    if dry_run:
        print("=" * 70)
        print("DRY RUN MODE - No changes will be made")
        print("Run with --fix flag to actually fix duplicates")
        print("=" * 70)
        print()
    else:
        print("=" * 70)
        print("FIX MODE - Will modify database!")
        print("=" * 70)
        print()

    conn = sqlite3.connect(DB_PATH)

    try:
        # Step 1: Fix existing duplicates (with different c_ prefix variations)
        print("STEP 1: Fixing existing duplicates")
        print("-" * 70)
        removed = fix_duplicates(conn, dry_run)

        print()

        # Step 2: Normalize all remaining Gemini IDs
        print("STEP 2: Normalizing all Gemini conversation IDs")
        print("-" * 70)
        normalized = normalize_all_gemini_ids(conn, dry_run)

        if dry_run and (removed > 0 or normalized > 0):
            print()
            print("=" * 70)
            print("To apply these changes, run:")
            print(f"  python3 {Path(__file__).name} --fix")
            print("=" * 70)
        elif not dry_run:
            print()
            print("=" * 70)
            print("✓ Database cleaned up successfully!")
            print("=" * 70)

    finally:
        conn.close()

if __name__ == "__main__":
    main()
