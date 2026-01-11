#!/bin/bash

echo "=== Chat History Extension Debugger ==="
echo ""

# Check Docker
echo "1. Checking Docker..."
if ! docker ps &> /dev/null; then
    echo "   ❌ Docker is not running!"
    echo "   Please start Docker Desktop or run: sudo systemctl start docker"
    exit 1
fi
echo "   ✓ Docker is running"
echo ""

# Check backend container
echo "2. Checking backend container..."
if ! docker ps | grep -q chat-history-backend; then
    echo "   ❌ Backend container not running!"
    echo "   Starting backend..."
    docker-compose up -d backend
    sleep 3
fi
echo "   ✓ Backend is running"
echo ""

# Check backend health
echo "3. Checking backend health..."
HEALTH=$(curl -s http://localhost:8000/api/health 2>&1)
if [ $? -eq 0 ]; then
    echo "   ✓ Backend is healthy"
    echo "   Response: $HEALTH" | head -c 100
    echo "..."
else
    echo "   ❌ Backend not responding on localhost:8000"
    echo "   Error: $HEALTH"
    exit 1
fi
echo ""

# Check database
echo "4. Checking database..."
CONV_COUNT=$(docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db "SELECT COUNT(*) FROM conversations;" 2>&1)
MSG_COUNT=$(docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db "SELECT COUNT(*) FROM messages;" 2>&1)

if [ $? -eq 0 ]; then
    echo "   ✓ Database accessible"
    echo "   Conversations: $CONV_COUNT"
    echo "   Messages: $MSG_COUNT"
else
    echo "   ❌ Database error"
    echo "   Error: $CONV_COUNT"
fi
echo ""

# Show recent imports
echo "5. Recent imports (last 5):"
docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db \
  "SELECT source, title, datetime(updated_at) FROM conversations ORDER BY updated_at DESC LIMIT 5;" 2>&1 | head -10
echo ""

echo "=== Ready to test! ==="
echo ""
echo "Next steps:"
echo "1. Open Chrome and go to claude.ai"
echo "2. Click on any conversation to open it"
echo "3. Open DevTools (F12) → Console tab"
echo "4. Click the extension icon → 'Sync Now'"
echo "5. Watch the console for [Claude] messages"
echo ""
echo "Backend logs: docker-compose logs -f backend"
echo "Database query: docker exec chat-history-backend sqlite3 /app/volumes/database/conversations.db 'SELECT * FROM conversations;'"
