"""Exercise both production invoice queries against synthetic SQLite data.

Run with: python3 scripts/test-klippekort-invoice.py
"""

import pathlib
import re
import sqlite3
import unittest


class KlippekortInvoiceTests(unittest.TestCase):
    def test_preview_and_generation_exclude_prepaid_entries(self):
        source = (pathlib.Path(__file__).resolve().parents[1]
                  / "src-tauri/src/commands/auto_invoice.rs").read_text(encoding="utf-8-sig")
        queries = re.findall(r'"(SELECT t\.id, t\.description, t\.duration,.*?)"', source, re.S)
        self.assertEqual(len(queries), 2, "Test both preview and generation")
        with sqlite3.connect(":memory:") as conn:
            conn.executescript("""
                CREATE TABLE projects (id TEXT, hourly_rate REAL, name TEXT);
                CREATE TABLE clients (id TEXT, hourly_rate REAL);
                CREATE TABLE time_entries (
                    id TEXT, description TEXT, duration INTEGER, project_id TEXT,
                    client_id TEXT, start_time TEXT, is_running INTEGER,
                    klippekort_id TEXT, klippekort_deducted_hours REAL,
                    is_billable INTEGER);
            """)
            cases = [
                ("uncovered", None, 0, 1, 0, "client", "2026-10-10T12:00:00"),
                ("covered", "card", 1, 1, 0, "client", "2026-10-10T12:00:00"),
                ("other_card", "other", 1, 1, 0, "client", "2026-10-10T12:00:00"),
                ("legacy_link", "card", 0, 1, 0, "client", "2026-10-10T12:00:00"),
                ("deducted_only", None, 1, 1, 0, "client", "2026-10-10T12:00:00"),
                ("partly_covered", "card", 0.25, 1, 0, "client", "2026-10-10T12:00:00"),
                ("non_billable", None, 0, 0, 0, "client", "2026-10-10T12:00:00"),
                ("running", None, 0, 1, 1, "client", "2026-10-10T12:00:00"),
                ("other_client", None, 0, 1, 0, "other", "2026-10-10T12:00:00"),
                ("outside_period", None, 0, 1, 0, "client", "2026-09-10T12:00:00"),
            ]
            for entry_id, card, deducted, billable, running, client, start in cases:
                conn.execute(
                    "INSERT INTO time_entries VALUES (?, ?, 3600, NULL, ?, ?, ?, ?, ?, ?)",
                    (entry_id, entry_id, client, start, running, card, deducted, billable),
                )
            for index, query in enumerate(queries):
                with self.subTest(command=("preview", "generate")[index]):
                    params = {
                        "1": 800, "2": "client", "3": "2026-10-01T00:00:00",
                        "4": "2026-10-31T23:59:59",
                    }
                    rows = conn.execute(query, params).fetchall()
                    self.assertEqual([row[0] for row in rows], ["uncovered"])
                    self.assertEqual(rows[0][2:4], (3600, 800))
                    conn.execute("UPDATE time_entries SET is_billable = 0 WHERE id = 'uncovered'")
                    self.assertEqual(conn.execute(query, params).fetchall(), [])
                    conn.execute("UPDATE time_entries SET is_billable = 1 WHERE id = 'uncovered'")


if __name__ == "__main__":
    unittest.main()
