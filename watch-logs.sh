#!/bin/bash
# Watch extension console logs in real-time

echo "Watching extension console logs..."
echo "Clear old logs? (y/n)"
read -r clear_logs

if [ "$clear_logs" = "y" ]; then
    docker exec chat-history-backend rm -f /app/extension-console.log
    echo "Logs cleared."
fi

echo ""
echo "=== Extension Console Logs (live) ==="
echo ""

docker exec chat-history-backend tail -f /app/extension-console.log 2>/dev/null || echo "Waiting for logs..."
