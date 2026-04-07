"""
Async SQLite database layer for the Emergency Assistance System.
"""

import aiosqlite
import os
from datetime import datetime, timezone

DB_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DB_DIR, "emergencies.db")


async def init_db():
    """Create tables if they don't exist."""
    os.makedirs(DB_DIR, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS emergencies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'emergency',
                trigger_type TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                digipin TEXT NOT NULL,
                created_at TEXT NOT NULL,
                resolved_at TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emergency_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                description TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (emergency_id) REFERENCES emergencies(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emergency_id INTEGER NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                digipin TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (emergency_id) REFERENCES emergencies(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS audio_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emergency_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (emergency_id) REFERENCES emergencies(id)
            )
        """)
        await db.commit()


async def create_emergency(data: dict) -> int:
    """Insert a new emergency and its event logs. Returns the new emergency ID."""
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO emergencies (user_id, status, trigger_type, latitude, longitude, digipin, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                data["user_id"],
                data.get("status", "emergency"),
                data["trigger_type"],
                data["latitude"],
                data["longitude"],
                data["digipin"],
                now,
            ),
        )
        emergency_id = cursor.lastrowid

        # Insert initial location
        await db.execute(
            """INSERT INTO locations (emergency_id, latitude, longitude, digipin, timestamp)
               VALUES (?, ?, ?, ?, ?)""",
            (emergency_id, data["latitude"], data["longitude"], data["digipin"], now),
        )

        # Insert event logs
        for event in data.get("event_logs", []):
            await db.execute(
                """INSERT INTO events (emergency_id, event_type, description, timestamp)
                   VALUES (?, ?, ?, ?)""",
                (
                    emergency_id,
                    event["event_type"],
                    event["description"],
                    event["timestamp"],
                ),
            )

        await db.commit()
        return emergency_id


async def add_location(emergency_id: int, data: dict):
    """Add a location update for an active emergency."""
    now = data.get("timestamp") or datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO locations (emergency_id, latitude, longitude, digipin, timestamp)
               VALUES (?, ?, ?, ?, ?)""",
            (emergency_id, data["latitude"], data["longitude"], data["digipin"], now),
        )
        # Also update the main emergency record with latest coords
        await db.execute(
            """UPDATE emergencies SET latitude = ?, longitude = ?, digipin = ? WHERE id = ?""",
            (data["latitude"], data["longitude"], data["digipin"], emergency_id),
        )
        await db.commit()


async def add_event(emergency_id: int, event_type: str, description: str):
    """Add an event log entry."""
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO events (emergency_id, event_type, description, timestamp)
               VALUES (?, ?, ?, ?)""",
            (emergency_id, event_type, description, now),
        )
        await db.commit()


async def update_status(emergency_id: int, status: str):
    """Update emergency status."""
    async with aiosqlite.connect(DB_PATH) as db:
        updates = {"status": status}
        if status == "resolved":
            updates["resolved_at"] = datetime.now(timezone.utc).isoformat()
            await db.execute(
                """UPDATE emergencies SET status = ?, resolved_at = ? WHERE id = ?""",
                (status, updates["resolved_at"], emergency_id),
            )
        else:
            await db.execute(
                """UPDATE emergencies SET status = ? WHERE id = ?""",
                (status, emergency_id),
            )
        # Add event log
        await db.execute(
            """INSERT INTO events (emergency_id, event_type, description, timestamp)
               VALUES (?, ?, ?, ?)""",
            (
                emergency_id,
                "status_change",
                f"Status changed to {status}",
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        await db.commit()


async def save_audio_path(emergency_id: int, file_path: str):
    """Record an audio file path for an emergency."""
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO audio_files (emergency_id, file_path, timestamp)
               VALUES (?, ?, ?)""",
            (emergency_id, file_path, now),
        )
        await db.commit()


async def get_emergency(emergency_id: int) -> dict | None:
    """Fetch a single emergency with its events, locations, and audio info."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM emergencies WHERE id = ?", (emergency_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None

        record = dict(row)

        # Fetch events
        cursor = await db.execute(
            "SELECT * FROM events WHERE emergency_id = ? ORDER BY timestamp ASC",
            (emergency_id,),
        )
        record["events"] = [dict(r) for r in await cursor.fetchall()]

        # Fetch locations
        cursor = await db.execute(
            "SELECT * FROM locations WHERE emergency_id = ? ORDER BY timestamp ASC",
            (emergency_id,),
        )
        record["locations"] = [dict(r) for r in await cursor.fetchall()]

        # Check audio
        cursor = await db.execute(
            "SELECT * FROM audio_files WHERE emergency_id = ? ORDER BY timestamp DESC LIMIT 1",
            (emergency_id,),
        )
        audio = await cursor.fetchone()
        record["has_audio"] = audio is not None
        if audio:
            record["audio_path"] = dict(audio)["file_path"]

        return record


async def get_all_emergencies(status_filter: str | None = None) -> list[dict]:
    """Fetch all emergencies, optionally filtered by status."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if status_filter:
            cursor = await db.execute(
                "SELECT * FROM emergencies WHERE status = ? ORDER BY created_at DESC",
                (status_filter,),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM emergencies ORDER BY created_at DESC"
            )
        rows = await cursor.fetchall()
        results = []
        for row in rows:
            record = dict(row)
            # Fetch events count and latest
            ev_cursor = await db.execute(
                "SELECT * FROM events WHERE emergency_id = ? ORDER BY timestamp ASC",
                (record["id"],),
            )
            record["events"] = [dict(r) for r in await ev_cursor.fetchall()]

            # Latest location
            loc_cursor = await db.execute(
                "SELECT * FROM locations WHERE emergency_id = ? ORDER BY timestamp DESC LIMIT 1",
                (record["id"],),
            )
            loc = await loc_cursor.fetchone()
            if loc:
                record["latest_location"] = dict(loc)

            # Audio check
            audio_cursor = await db.execute(
                "SELECT COUNT(*) as cnt FROM audio_files WHERE emergency_id = ?",
                (record["id"],),
            )
            audio_row = await audio_cursor.fetchone()
            record["has_audio"] = dict(audio_row)["cnt"] > 0

            results.append(record)
        return results
