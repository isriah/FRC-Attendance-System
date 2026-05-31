import argparse
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import serial
import adafruit_fingerprint


LED_ENABLED = True
LED_RED = 1
LED_BLUE = 2
LED_PURPLE = 3
LED_BREATHE = 1
LED_FLASH = 2
LED_ON = 3
LED_OFF = 4


def set_reader_led(finger, color=LED_BLUE, mode=LED_ON, speed=0x40, cycles=0):
    if not LED_ENABLED or not hasattr(finger, "set_led"):
        return
    try:
        finger.set_led(color=color, mode=mode, speed=speed, cycles=cycles)
    except Exception as exc:
        print(f"Could not set fingerprint LED: {exc}")


def connect_reader(port: str, baudrate: int):
    uart = serial.Serial(port, baudrate=baudrate, timeout=2)
    finger = adafruit_fingerprint.Adafruit_Fingerprint(uart)
    if finger.verify_password() != adafruit_fingerprint.OK:
        raise RuntimeError("Fingerprint sensor not found or password rejected")
    set_reader_led(finger, color=LED_BLUE, mode=LED_BREATHE, speed=0x80, cycles=0)
    return finger


def enroll_sensor_slot(finger, slot: int):
    for scan_num in range(1, 3):
        set_reader_led(finger, color=LED_PURPLE, mode=LED_BREATHE, speed=0x60, cycles=0)
        print(f"Place finger for scan {scan_num}")
        while finger.get_image() != adafruit_fingerprint.OK:
            time.sleep(0.1)

        if finger.image_2_tz(scan_num) != adafruit_fingerprint.OK:
            set_reader_led(finger, color=LED_RED, mode=LED_FLASH, speed=0x30, cycles=3)
            raise RuntimeError("Could not convert fingerprint image")

        set_reader_led(finger, color=LED_BLUE, mode=LED_FLASH, speed=0x30, cycles=2)
        print("Remove finger")
        time.sleep(2)

    if finger.create_model() != adafruit_fingerprint.OK:
        set_reader_led(finger, color=LED_RED, mode=LED_FLASH, speed=0x30, cycles=3)
        raise RuntimeError("Fingerprint scans did not match")

    if finger.store_model(slot) != adafruit_fingerprint.OK:
        set_reader_led(finger, color=LED_RED, mode=LED_FLASH, speed=0x30, cycles=3)
        raise RuntimeError(f"Could not store fingerprint in slot {slot}")

    set_reader_led(finger, color=LED_BLUE, mode=LED_FLASH, speed=0x30, cycles=3)


def save_mapping(db_path: str, student_id: str, slot: int, finger_label: str | None):
    enrolled_at = datetime.now(timezone.utc).isoformat()
    resolved_db_path = resolve_db_path(db_path)
    resolved_db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(resolved_db_path) as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS local_enrollments (
              student_id TEXT NOT NULL,
              template_slot INTEGER NOT NULL,
              finger_label TEXT,
              enrolled_at TEXT NOT NULL,
              deleted_at TEXT,
              PRIMARY KEY (student_id, template_slot)
            )
            """
        )
        db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS local_enrollments_active_slot_idx
            ON local_enrollments(template_slot)
            WHERE deleted_at IS NULL
            """
        )
        db.execute(
            "UPDATE local_enrollments SET deleted_at = ? WHERE template_slot = ? AND deleted_at IS NULL",
            (enrolled_at, slot),
        )
        db.execute(
            """
            INSERT INTO local_enrollments (student_id, template_slot, finger_label, enrolled_at, deleted_at)
            VALUES (?, ?, ?, ?, NULL)
            ON CONFLICT(student_id, template_slot) DO UPDATE SET
              finger_label = excluded.finger_label,
              enrolled_at = excluded.enrolled_at,
              deleted_at = NULL
            """,
            (student_id, slot, finger_label, enrolled_at),
        )


def resolve_db_path(db_path: str) -> Path:
    path = Path(db_path)
    if path.is_absolute():
        return path

    cwd_path = Path.cwd() / path
    if cwd_path.parent.exists():
        return cwd_path

    parts = path.parts
    if len(parts) >= 2 and parts[0] == "apps" and parts[1] == "kiosk" and Path.cwd().name == "kiosk":
        return Path.cwd() / Path(*parts[2:])

    return cwd_path


def main():
    parser = argparse.ArgumentParser(description="Enroll or map an R503 fingerprint slot to a student ID.")
    parser.add_argument("--student-id", required=True)
    parser.add_argument("--slot", required=True, type=int)
    parser.add_argument("--finger-label", default=None)
    parser.add_argument("--db", default="./kiosk-cache.sqlite")
    parser.add_argument("--port", default="/dev/serial0")
    parser.add_argument("--baudrate", default=57600, type=int)
    parser.add_argument("--no-led", action="store_true", help="Do not control the R503 LED ring during enrollment.")
    parser.add_argument("--map-only", action="store_true", help="Only write the slot mapping; do not enroll on sensor.")
    args = parser.parse_args()

    global LED_ENABLED
    LED_ENABLED = not args.no_led

    if not args.map_only:
        finger = connect_reader(args.port, args.baudrate)
        enroll_sensor_slot(finger, args.slot)

    save_mapping(args.db, args.student_id, args.slot, args.finger_label)
    print(f"Mapped fingerprint slot {args.slot} to student {args.student_id}")


if __name__ == "__main__":
    main()
