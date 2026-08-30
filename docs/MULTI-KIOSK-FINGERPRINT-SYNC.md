# Multi-kiosk fingerprint template sync (deferred)

**Status:** Backburnered. **Decision: do not implement now.** This note records research and guardrails only; it does not change the current fingerprint design.

## Scope and terminology

The kiosk hardware is the [Adafruit R503 UART fingerprint sensor (Product 4651)](https://www.adafruit.com/product/4651), which has local onboard flash for 200 fingerprints. The current product stores fingerprint templates on each sensor and keeps that kiosk's slot-to-member mappings locally. Scan events, including queued offline scans, synchronize independently and are already supported; that event synchronization is not biometric-template synchronization.

| Data | Current policy | Basis |
| --- | --- | --- |
| Raw fingerprint image | Never store, export, or sync it. Do not use it for device-to-device transfer. | Product/privacy policy. Adafruit guidance describes capture as an image that is converted into a template; the sensor retains templates rather than images. |
| Sensor template payload | Keep local today; do not export or sync in this product. | Product policy. It is biometric-derived data and needs a separately approved design. |
| Slot mapping and scan events | Slot mappings remain local; scan events/offline queue sync normally. | Verified current system behavior. |

## What is verified vs. inferred

**Verified from primary documentation:** Product 4651 is an R503, uses TTL UART, and lists capacity of 200 fingerprints. The official [Adafruit CircuitPython fingerprint library](https://github.com/adafruit/Adafruit_CircuitPython_Fingerprint) implements `get_fpdata()` and `send_fpdata()` operations for a sensor image or the character/template buffer, as well as load/store/delete model operations. The R503 manual linked by Adafruit describes volatile image/character buffers and a persistent flash fingerprint library.

**Inference—not validated by this product:** Matching R503 sensors may be able to transfer a template payload: load a source template into a character buffer, read it, send it to a destination character buffer, then store and match it. Library support makes that plausible; it does **not** prove cross-sensor interoperability, safe packet handling, or compatibility with our installed library/firmware/configuration and slot scheme.

## Required first proof before any design work

Run a two-sensor laboratory experiment using one explicitly designated test finger/template only—never a production member's biometric data:

1. Enroll the test finger on sensor A and record only non-biometric test IDs, firmware/library versions, parameters, and destination slot.
2. Export the template payload from A; import it into a chosen empty slot on matching sensor B.
3. Match the test finger on B, then delete the test template from both sensors and confirm it no longer matches.
4. Prove packet framing, template size, model/firmware compatibility, slot handling, error recovery, and that no payload remains in logs, queues, backups, or cloud storage.

This experiment is a feasibility check only. A successful test does not authorize shipping template synchronization.

## Future architecture choices (if approved later)

- Re-enroll each member at every kiosk; no template transfer.
- Authenticated, encrypted direct kiosk-to-kiosk transfer, with no cloud persistence.
- Centrally stored encrypted template envelopes, protected with per-kiosk keys.

Before selecting or implementing any option, require an explicit product decision; consent, retention, and deletion policy; role-based access and audit events; per-kiosk key management; encryption in transit and at rest; lost-kiosk revocation; a permanent ban on raw-image storage; and legal/privacy review appropriate to the deployment.

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-08-30 | **Do not implement now.** | Multi-kiosk template transfer is unvalidated and materially expands handling of biometric-derived data. The existing local-template design and scan-event/offline-queue synchronization remain in effect. |

## Primary references

- [Adafruit Product 4651: R503 sensor specifications](https://www.adafruit.com/product/4651)
- [Official Adafruit CircuitPython Fingerprint library](https://github.com/adafruit/Adafruit_CircuitPython_Fingerprint)
- [R503 module user manual linked from Product 4651](https://cdn-shop.adafruit.com/product-files/4651/4651_R503%20fingerprint%20module%20user%20manual.pdf)
