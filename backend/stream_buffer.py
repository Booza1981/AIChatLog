"""
StreamBuffer for handling SSE/WebSocket streaming responses
Accumulates chunks until completion marker detected
"""

import json
import asyncio
from typing import Dict, List, Optional
from dataclasses import dataclass
from datetime import datetime


@dataclass
class StreamChunk:
    """Represents a single SSE chunk."""
    timestamp: datetime
    data: dict
    raw: str


class StreamBuffer:
    """
    Handles streaming responses from SSE/WebSocket connections.
    Service-agnostic design with per-service parsers.
    """

    def __init__(self):
        self.buffers: Dict[str, List[StreamChunk]] = {}
        self.completion_markers = {
            'chatgpt': ['data: [DONE]', '[DONE]'],
            'claude': ['event: message_stop', 'data: [DONE]'],
            'gemini': ['data: [DONE]'],  # TBD - investigate
            'perplexity': ['data: [DONE]']  # TBD - investigate
        }

    def add_chunk(self, conversation_id: str, chunk: str, service: str):
        """Add a chunk to the buffer."""
        if conversation_id not in self.buffers:
            self.buffers[conversation_id] = []

        # Parse SSE format
        if chunk.startswith('data: ') and not self.is_completion_marker(chunk, service):
            try:
                data = json.loads(chunk[6:])  # Remove "data: " prefix
                self.buffers[conversation_id].append(
                    StreamChunk(timestamp=datetime.now(), data=data, raw=chunk)
                )
            except json.JSONDecodeError:
                # Some chunks may not be JSON (e.g., heartbeats)
                pass

    def is_completion_marker(self, chunk: str, service: str) -> bool:
        """Check if chunk indicates stream completion."""
        markers = self.completion_markers.get(service, ['data: [DONE]'])
        return any(marker in chunk for marker in markers)

    def get_complete_message(self, conversation_id: str, service: str) -> Optional[str]:
        """
        Reconstruct full message from chunks.
        Service-specific extraction logic.
        """
        if conversation_id not in self.buffers:
            return None

        chunks = self.buffers[conversation_id]

        # ChatGPT-specific extraction
        if service == 'chatgpt':
            # ChatGPT sends incremental updates, take the last complete message
            for chunk in reversed(chunks):
                try:
                    # ChatGPT format: {"message": {"content": {"parts": ["text"]}}}
                    parts = chunk.data.get('message', {}).get('content', {}).get('parts', [])
                    if parts:
                        full_message = ''.join(parts)
                        self.buffers.pop(conversation_id)  # Clean up
                        return full_message
                except (KeyError, TypeError):
                    continue

        # Claude-specific extraction (if using SSE)
        elif service == 'claude':
            # Claude format: {"type": "content_block_delta", "delta": {"text": "..."}}
            text_chunks = []
            for chunk in chunks:
                if chunk.data.get('type') == 'content_block_delta':
                    text = chunk.data.get('delta', {}).get('text', '')
                    text_chunks.append(text)

            self.buffers.pop(conversation_id)
            return ''.join(text_chunks) if text_chunks else None

        # Gemini-specific extraction (TBD based on actual API)
        elif service == 'gemini':
            # Placeholder - needs investigation
            text_chunks = []
            for chunk in chunks:
                # Generic extraction attempt
                if 'text' in chunk.data:
                    text_chunks.append(chunk.data['text'])

            self.buffers.pop(conversation_id)
            return ''.join(text_chunks) if text_chunks else None

        # Perplexity-specific extraction (TBD)
        elif service == 'perplexity':
            # Placeholder - needs investigation
            text_chunks = []
            for chunk in chunks:
                if 'text' in chunk.data:
                    text_chunks.append(chunk.data['text'])

            self.buffers.pop(conversation_id)
            return ''.join(text_chunks) if text_chunks else None

        # Generic fallback
        self.buffers.pop(conversation_id)
        return None

    async def wait_for_completion(
        self,
        conversation_id: str,
        service: str,
        timeout: int = 300
    ) -> bool:
        """
        Wait for stream to complete or timeout.
        Used when intercepting network requests.
        """
        start_time = datetime.now()
        while (datetime.now() - start_time).seconds < timeout:
            if conversation_id not in self.buffers:
                return False  # No chunks received yet

            # Check if last chunk is completion marker
            if self.buffers[conversation_id]:
                last_chunk = self.buffers[conversation_id][-1]
                if self.is_completion_marker(last_chunk.raw, service):
                    return True

            await asyncio.sleep(0.5)  # Poll every 500ms

        return False  # Timeout

    def clear_buffer(self, conversation_id: str):
        """Clear buffer for a specific conversation."""
        if conversation_id in self.buffers:
            self.buffers.pop(conversation_id)

    def clear_all_buffers(self):
        """Clear all buffers."""
        self.buffers.clear()
