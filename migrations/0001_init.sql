CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_lc TEXT NOT NULL,
  count INTEGER NOT NULL,
  cover TEXT NOT NULL,
  href TEXT NOT NULL,
  album_order INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS album_details (
  album_id TEXT PRIMARY KEY,
  detail_json TEXT NOT NULL,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS likes_albums (
  album_id TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS likes_photos (
  album_id TEXT NOT NULL,
  photo_id INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (album_id, photo_id),
  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_albums_order ON albums(album_order);
CREATE INDEX IF NOT EXISTS idx_albums_title_lc ON albums(title_lc);
CREATE INDEX IF NOT EXISTS idx_albums_photo_offsets ON albums(start_offset, end_offset);
