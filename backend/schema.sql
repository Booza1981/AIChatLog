-- Chat History Search Database Schema
-- SQLite with FTS5 (Full-Text Search)

-- Primary conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT UNIQUE NOT NULL,  -- Service-specific ID (e.g., UUID from Claude)
    source TEXT NOT NULL CHECK(source IN ('claude', 'chatgpt', 'gemini', 'perplexity')),
    title TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    last_message_at TIMESTAMP,
    message_count INTEGER DEFAULT 0,
    full_text TEXT,  -- Concatenated messages for FTS (format: "user: ...\nassistant: ...\n")
    metadata TEXT,   -- JSON field for service-specific data
    UNIQUE(conversation_id, source)
);

CREATE INDEX IF NOT EXISTS idx_conv_source ON conversations(source);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_last_message ON conversations(last_message_at DESC);

-- Messages table (normalized storage)
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    sequence_number INTEGER NOT NULL,  -- Order within conversation
    metadata TEXT,  -- JSON for tool calls, citations, etc.
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    UNIQUE(conversation_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_msg_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_msg_role ON messages(role);

-- FTS5 virtual table using EXTERNAL CONTENT (critical for performance)
-- External content means FTS doesn't duplicate data, just indexes it
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
    title,
    full_text,
    content='conversations',  -- Links to conversations table
    content_rowid='id',       -- Maps to conversations.id
    tokenize='porter unicode61 remove_diacritics 2'  -- Better tokenization
);

-- Triggers to keep FTS synchronized with conversations table
CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
    INSERT INTO conversations_fts(rowid, title, full_text)
    VALUES (new.id, new.title, new.full_text);
END;

CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
    DELETE FROM conversations_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
    UPDATE conversations_fts
    SET title = new.title, full_text = new.full_text
    WHERE rowid = new.id;
END;

-- Scraper status tracking
CREATE TABLE IF NOT EXISTS scraper_status (
    service TEXT PRIMARY KEY CHECK(service IN ('claude', 'chatgpt', 'gemini', 'perplexity')),
    last_successful_scrape TIMESTAMP,
    last_attempt TIMESTAMP,
    session_healthy BOOLEAN DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    last_error_message TEXT,
    consecutive_failures INTEGER DEFAULT 0,
    total_conversations_scraped INTEGER DEFAULT 0,
    last_conversation_id TEXT  -- For resuming after failures
);

-- Initialize scraper status for all services
INSERT OR IGNORE INTO scraper_status (service, session_healthy) VALUES
    ('claude', 0),
    ('chatgpt', 0),
    ('gemini', 0),
    ('perplexity', 0);

-- Import tracking (for official exports)
CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    import_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    file_name TEXT,
    conversations_imported INTEGER DEFAULT 0,
    messages_imported INTEGER DEFAULT 0,
    status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source);
CREATE INDEX IF NOT EXISTS idx_imports_timestamp ON imports(import_timestamp DESC);
