-- Migration: 0001_gallery_schema.sql

CREATE TABLE IF NOT EXISTS gallery_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author_name TEXT NOT NULL,
    source_url TEXT,
    r2_json_key TEXT NOT NULL,
    r2_thumb_key TEXT NOT NULL,
    aspect_ratio REAL NOT NULL,
    likes_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    approved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_gallery_approved_likes ON gallery_items (status, likes_count DESC, created_at DESC)
WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS gallery_likes_ledger (
    item_id TEXT NOT NULL,
    visitor_uuid TEXT NOT NULL,
    liked_at INTEGER NOT NULL,
    PRIMARY KEY (item_id, visitor_uuid),
    FOREIGN KEY(item_id) REFERENCES gallery_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ip_rate_limits (
    ip_hash TEXT PRIMARY KEY,
    requests_count INTEGER DEFAULT 0,
    window_reset INTEGER NOT NULL
);
