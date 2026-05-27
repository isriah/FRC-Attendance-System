import os
import random
import sys
import time

# R503/Grow-style fingerprint bridge.
#
# The kiosk service expects newline-delimited messages:
# STAT:ONLINE
# STAT:OFFLINE
# MATCH:<student_id>,<template_slot>
#
# Fingerprint templates stay on the sensor. This bridge maps template slots to
# student IDs from the local kiosk SQLite database. Environment mappings are
# still supported as an override for quick bench tests.


def emit(line: str):
    print(line, flush=True)


def load_slot_map():
    import json
    import sqlite3

    raw = os.environ.get("FINGERPRINT_SLOT_MAP", "{}")
    parsed = json.loads(raw)
    slot_map = {int(slot): str(student_id) for slot, student_id in parsed.items()}

    db_path = os.environ.get("FINGERPRINT_ENROLLMENT_DB_PATH") or os.environ.get("KIOSK_DB_PATH")
    if db_path:
        try:
            with sqlite3.connect(db_path) as db:
                rows = db.execute(
                    """
                    SELECT template_slot, student_id
                    FROM local_enrollments
                    WHERE deleted_at IS NULL
                    """
                ).fetchall()
            slot_map.update({int(slot): str(student_id) for slot, student_id in rows})
        except Exception as exc:
            print(f"Could not load enrollment DB mapping: {exc}", file=sys.stderr, flush=True)

    prefix = "FINGERPRINT_SLOT_"
    for key, value in os.environ.items():
        if key.startswith(prefix) and key[len(prefix):].isdigit():
            slot_map[int(key[len(prefix):])] = str(value)

    return slot_map


def simulate_loop():
    import json

    emit("STAT:ONLINE")
    demo_students = json.loads(os.environ.get("FINGERPRINT_DEMO_STUDENTS", '["100001", "100002"]'))
    slot = 1
    while True:
        time.sleep(10)
        emit(f"MATCH:{random.choice(demo_students)},{slot}")
        slot += 1


def hardware_loop():
    import serial
    import adafruit_fingerprint

    port = os.environ.get("FINGERPRINT_SERIAL_PORT", "/dev/serial0")
    baudrate = int(os.environ.get("FINGERPRINT_BAUDRATE", "57600"))
    poll_seconds = float(os.environ.get("FINGERPRINT_POLL_SECONDS", "0.1"))
    repeat_delay_seconds = float(os.environ.get("FINGERPRINT_REPEAT_DELAY_SECONDS", "2"))
    debounce_seconds = float(os.environ.get("FINGERPRINT_DEBOUNCE_SECONDS", "8"))
    last_match = None
    last_match_at = 0.0

    while True:
        try:
            uart = serial.Serial(port, baudrate=baudrate, timeout=2)
            finger = adafruit_fingerprint.Adafruit_Fingerprint(uart)

            if finger.verify_password() != adafruit_fingerprint.OK:
                emit("STAT:OFFLINE")
                raise RuntimeError("Fingerprint sensor did not accept password")

            emit("STAT:ONLINE")

            while True:
                if finger.get_image() != adafruit_fingerprint.OK:
                    time.sleep(poll_seconds)
                    continue

                if finger.image_2_tz(1) != adafruit_fingerprint.OK:
                    time.sleep(poll_seconds)
                    continue

                if finger.finger_search() == adafruit_fingerprint.OK:
                    slot = int(finger.finger_id)
                    slot_map = load_slot_map()
                    student_id = slot_map.get(slot, str(slot))
                    now = time.monotonic()
                    if last_match != slot or now - last_match_at >= debounce_seconds:
                        emit(f"MATCH:{student_id},{slot}")
                        last_match = slot
                        last_match_at = now

                time.sleep(repeat_delay_seconds)
        except Exception as exc:
            emit("STAT:OFFLINE")
            print(f"Fingerprint reader error: {exc}", file=sys.stderr, flush=True)
            try:
                uart.close()
            except Exception:
                pass
            time.sleep(2)


if __name__ == "__main__":
    try:
        if os.environ.get("FINGERPRINT_SIMULATE", "").lower() in {"1", "true", "yes"}:
            simulate_loop()
        else:
            hardware_loop()
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as exc:
        emit("STAT:OFFLINE")
        print(str(exc), file=sys.stderr, flush=True)
        sys.exit(1)
