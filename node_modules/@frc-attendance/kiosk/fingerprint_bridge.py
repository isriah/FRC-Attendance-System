import json
import os
import random
import sys
import time

# Hardware integration point:
# Replace simulate_loop with calls to the selected onboard-template UART
# fingerprint module. The service expects newline-delimited messages:
# STAT:ONLINE
# STAT:OFFLINE
# MATCH:<student_id>,<template_slot>


def emit(line: str):
    print(line, flush=True)


def simulate_loop():
    emit("STAT:ONLINE")
    demo_students = json.loads(os.environ.get("FINGERPRINT_DEMO_STUDENTS", '["100001", "100002"]'))
    slot = 1
    while True:
        time.sleep(10)
        emit(f"MATCH:{random.choice(demo_students)},{slot}")
        slot += 1


if __name__ == "__main__":
    try:
        simulate_loop()
    except KeyboardInterrupt:
        sys.exit(0)
