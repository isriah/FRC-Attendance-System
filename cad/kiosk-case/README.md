# Attendance Kiosk Case CAD

This is a first parametric enclosure draft for the FRC attendance kiosk hardware:

- Raspberry Pi 4 Model B
- Waveshare 7inch DSI LCD (E), bare module
- Round R503 fingerprint reader

The model is intentionally adjustable. Check the top of `attendance-kiosk-case.scad` before printing, especially if the fingerprint reader is the M22 variant instead of the M25 variant.

## Parts

Set the `part_id` variable in `attendance-kiosk-case.scad`:

- `0`: assembly preview showing the shell, rear cover, and hardware placeholders.
- `1`: printable main body with screen recess, fingerprint reader opening, Pi standoffs, ventilation, and cable exits.
- `2`: printable service cover.

## First Prototype Notes

- Print the `front_shell` as a fit-check first, or cut a thin 3 mm front-face slice in your slicer to validate the screen and fingerprint openings.
- Use M3 screws for the rear cover.
- Use M2.5 screws for the Raspberry Pi standoffs.
- The screen recess assumes a small retaining bezel over the visible area. If touch near the screen edge feels cramped, increase `display_window_clearance`.
- The R503 opening assumes a 25 mm threaded body with a 28 mm front face. If your reader is the M22 version, reduce `finger_body_d` and `finger_cutout_d`.

## Verified Source Dimensions Used

- Waveshare 7inch DSI LCD (E): 170.18 mm x 104.20 mm front outline, 1280 x 800 resolution, DSI interface.
- R503 common round module: 28 mm face, M25 threaded body, with M22 variants also common.

Final fit should be confirmed with calipers before a long print.
