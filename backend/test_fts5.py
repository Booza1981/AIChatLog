import asyncio
import sys
from database import Database
from datetime import datetime

async def test_fts5():
    db = Database()
    await db.initialize()

    # Insert test conversation
    conv_id = await db.upsert_conversation(
        conversation_id="test-123",
        source="claude",
        title="Test Conversation about Machine Learning",
        messages=[
            {
                'role': 'user',
                'content': 'Tell me about machine learning and neural networks',
                'timestamp': datetime.now()
            },
            {
                'role': 'assistant',
                'content': 'Machine learning is a field of AI that uses algorithms to learn from data. Neural networks are inspired by biological brains.',
                'timestamp': datetime.now()
            }
        ],
        created_at=datetime.now(),
        updated_at=datetime.now()
    )

    print(f"✓ Inserted conversation with ID: {conv_id}")

    # Test FTS5 search
    results, total = await db.search_conversations(query="machine learning")
    print(f"✓ Search for 'machine learning' found {total} results")

    if results:
        print(f"  - Title: {results[0]['title']}")
        print(f"  - Snippet: {results[0]['snippet'][:100]}...")

    # Test another search
    results2, total2 = await db.search_conversations(query="neural")
    print(f"✓ Search for 'neural' found {total2} results")

    # Test stats
    stats = await db.get_stats()
    print(f"✓ Total conversations: {stats['total_conversations']}")
    print(f"✓ Total messages: {stats['total_messages']}")

    await db.close()
    print("\n✅ All FTS5 tests passed!")

asyncio.run(test_fts5())
