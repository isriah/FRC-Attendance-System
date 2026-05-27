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
# student IDs using FINGERPRINT_SLOT_MAP, for example:
# FINGERPRINT_SLOT_MAP='{"1":"100001","2":"100002"}'


def emit(line: str):
    print(line, flush=True)


def load_slot_map():
    import json

    raw = os.environ.get("FINGERPRINT_SLOT_MAP", "{}")
    parsed = json.loads(raw)
    return {int(slot): str(student_id) for slot, student_id in parsed.items()}


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
    slot_map = load_slot_map()

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
            student_id = slot_map.get(slot, str(slot))
            emit(f"MATCH:{student_id},{slot}")

        time.sleep(repeat_delay_seconds)


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
