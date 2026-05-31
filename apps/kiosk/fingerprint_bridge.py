import os
import random
import json
import select
import sys
import time
from pathlib import Path

# R503/Grow-style fingerprint bridge.
#
# The kiosk service expects newline-delimited messages:
# STAT:ONLINE
# STAT:OFFLINE
# MATCH:<student_id>,<template_slot>
# NO_MATCH
#
# Fingerprint templates stay on the sensor. This bridge maps template slots to
# student IDs from the local kiosk SQLite database. Environment mappings are
# still supported as an override for quick bench tests.


def emit(line: str):
    print(line, flush=True)


LED_ENABLED = os.environ.get("FINGERPRINT_LED_ENABLED", "true").lower() not in {"0", "false", "no"}
LED_RED = 1
LED_BLUE = 2
LED_PURPLE = 3
LED_BREATHE = 1
LED_FLASH = 2
LED_ON = 3
LED_OFF = 4
LED_COLORS = {"red": LED_RED, "blue": LED_BLUE, "purple": LED_PURPLE}
LED_MODES = {"breathe": LED_BREATHE, "flash": LED_FLASH, "on": LED_ON, "off": LED_OFF}


def load_kiosk_states():
    states_path = Path(__file__).resolve().parent / "src" / "kioskStates.json"
    with states_path.open("r", encoding="utf-8") as file:
        return json.load(file)


KIOSK_STATES = load_kiosk_states()


def set_reader_led(finger, color=LED_BLUE, mode=LED_ON, speed=0x40, cycles=0):
    if not LED_ENABLED or not hasattr(finger, "set_led"):
        return
    try:
        finger.set_led(color=color, mode=mode, speed=speed, cycles=cycles)
    except Exception as exc:
        print(f"Could not set fingerprint LED: {exc}", file=sys.stderr, flush=True)


def set_semantic_led(finger, state_id: str):
    state = KIOSK_STATES.get(state_id)
    if state is None:
        print(f"Unknown kiosk LED state: {state_id}", file=sys.stderr, flush=True)
        return

    led = state["led"]
    set_reader_led(
        finger,
        color=LED_COLORS[led["color"]],
        mode=LED_MODES[led["mode"]],
        speed=int(led.get("speed", 0x40)),
        cycles=int(led.get("cycles", 0)),
    )

    return_to = led.get("returnTo")
    if return_to:
        time.sleep(float(led.get("returnAfterSeconds", 1.0)))
        set_semantic_led(finger, return_to)


def handle_led_commands(finger):
    try:
        readable, _, _ = select.select([sys.stdin], [], [], 0)
    except Exception:
        return

    if not readable:
        return

    line = sys.stdin.readline().strip()
    if line.startswith("LED_STATE:"):
        set_semantic_led(finger, line.split(":", 1)[1])


def sleep_with_led_commands(finger, seconds: float):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        handle_led_commands(finger)
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))


def load_slot_map():
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
    last_no_match_at = 0.0

    while True:
        try:
            uart = serial.Serial(port, baudrate=baudrate, timeout=2)
            finger = adafruit_fingerprint.Adafruit_Fingerprint(uart)

            if finger.verify_password() != adafruit_fingerprint.OK:
                emit("STAT:OFFLINE")
                raise RuntimeError("Fingerprint sensor did not accept password")

            set_semantic_led(finger, "ready")
            emit("STAT:ONLINE")

            while True:
                handle_led_commands(finger)
                if finger.get_image() != adafruit_fingerprint.OK:
                    time.sleep(poll_seconds)
                    continue

                set_semantic_led(finger, "processing")
                emit("STATE:processing")

                if finger.image_2_tz(1) != adafruit_fingerprint.OK:
                    now = time.monotonic()
                    if now - last_no_match_at >= debounce_seconds:
                        emit("NO_MATCH")
                        last_no_match_at = now
                    else:
                        set_semantic_led(finger, "ready")
                    time.sleep(poll_seconds)
                    continue

                if finger.finger_search() == adafruit_fingerprint.OK:
                    slot = int(finger.finger_id)
                    slot_map = load_slot_map()
                    student_id = slot_map.get(slot)
                    now = time.monotonic()
                    if student_id is None:
                        if now - last_no_match_at >= debounce_seconds:
                            emit("NO_MATCH")
                            last_no_match_at = now
                        sleep_with_led_commands(finger, repeat_delay_seconds)
                        continue

                    if last_match != slot or now - last_match_at >= debounce_seconds:
                        emit(f"MATCH:{student_id},{slot}")
                        last_match = slot
                        last_match_at = now
                    else:
                        set_semantic_led(finger, "ready")
                else:
                    now = time.monotonic()
                    if now - last_no_match_at >= debounce_seconds:
                        emit("NO_MATCH")
                        last_no_match_at = now

                sleep_with_led_commands(finger, repeat_delay_seconds)
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
