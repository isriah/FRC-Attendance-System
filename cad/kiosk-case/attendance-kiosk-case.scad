/*
  FRC Attendance Kiosk enclosure, first printable draft.

  Hardware target:
  - Raspberry Pi 4 Model B
  - Waveshare 7inch DSI LCD (E), bare module
  - Round R503 fingerprint reader

  Export one part at a time by changing `part`.
*/

part_id = 0; // 0 assembly_preview, 1 front_shell, 2 rear_cover

$fn = 64;

// Case envelope.
case_w = 210;
case_h = 168;
case_d = 55;
wall = 3;
front_wall = 3;
corner_r = 8;

// Display. Values are intentionally easy to tune after caliper checks.
display_glass_w = 170.18;
display_glass_h = 104.20;
display_visible_w = 151.80;
display_visible_h = 95.10;
display_pocket_clearance = 0.8;
display_window_clearance = 1.2;
display_pocket_depth = 1.8;
display_x = (case_w - display_glass_w) / 2;
display_y = 54;

// Fingerprint reader. Common R503 dimensions vary by M22/M25 body.
finger_face_d = 28;
finger_body_d = 25.4;
finger_cutout_d = 26.2;
finger_mount_angle = 12;
finger_x = case_w / 2;
finger_y = 24;

// Raspberry Pi 4B mounting pattern.
pi_w = 85;
pi_h = 56;
pi_hole_dx = 58;
pi_hole_dy = 49;
pi_hole_d = 2.8;
pi_standoff_d = 7;
pi_standoff_h = 10;
pi_x = case_w / 2;
pi_y = 104;

// Fasteners and service cover.
case_screw_d = 3.2;
case_screw_post_d = 8.5;
case_screw_positions = [
  [14, 14],
  [case_w - 14, 14],
  [14, case_h - 14],
  [case_w - 14, case_h - 14]
];

module rounded_rect_2d(w, h, r) {
  hull() {
    translate([r, r]) circle(r = r);
    translate([w - r, r]) circle(r = r);
    translate([r, h - r]) circle(r = r);
    translate([w - r, h - r]) circle(r = r);
  }
}

module rounded_prism(w, h, d, r) {
  linear_extrude(height = d)
    rounded_rect_2d(w, h, r);
}

module screw_hole(depth) {
  translate([0, 0, -0.1])
    cylinder(h = depth + 0.2, d = case_screw_d);
}

module pi_standoff(x, y) {
  translate([x, y, wall])
    difference() {
      cylinder(h = pi_standoff_h, d = pi_standoff_d);
      translate([0, 0, -0.1])
        cylinder(h = pi_standoff_h + 0.2, d = pi_hole_d);
    }
}

module vent_slot(x, y, z, len) {
  translate([x, y, z])
    cube([len, 2.5, wall + 0.4]);
}

module front_shell() {
  difference() {
    union() {
      rounded_prism(case_w, case_h, case_d, corner_r);

      // Rear cover screw posts.
      for (pos = case_screw_positions) {
        translate([pos[0], pos[1], wall])
          cylinder(h = case_d - wall - front_wall, d = case_screw_post_d);
      }

      // Pi standoffs.
      pi_standoff(pi_x - pi_hole_dx / 2, pi_y - pi_hole_dy / 2);
      pi_standoff(pi_x + pi_hole_dx / 2, pi_y - pi_hole_dy / 2);
      pi_standoff(pi_x - pi_hole_dx / 2, pi_y + pi_hole_dy / 2);
      pi_standoff(pi_x + pi_hole_dx / 2, pi_y + pi_hole_dy / 2);

      // Finger reader boss, tilted toward the user.
      translate([finger_x, finger_y, case_d - front_wall - 3])
        rotate([finger_mount_angle, 0, 0])
          cylinder(h = 8, d = finger_face_d + 8);
    }

    // Main interior cavity, open from the rear.
    translate([wall, wall, -0.1])
      cube([case_w - 2 * wall, case_h - 2 * wall, case_d - front_wall + 0.1]);

    // Display glass recess.
    translate([
      display_x - display_pocket_clearance,
      display_y - display_pocket_clearance,
      case_d - front_wall - display_pocket_depth
    ])
      cube([
        display_glass_w + 2 * display_pocket_clearance,
        display_glass_h + 2 * display_pocket_clearance,
        display_pocket_depth + 0.2
      ]);

    // Touch-visible window, leaving a retaining bezel over the glass edge.
    translate([
      (case_w - display_visible_w) / 2 - display_window_clearance,
      display_y + (display_glass_h - display_visible_h) / 2 - display_window_clearance,
      case_d - front_wall - display_pocket_depth - 0.2
    ])
      cube([
        display_visible_w + 2 * display_window_clearance,
        display_visible_h + 2 * display_window_clearance,
        front_wall + display_pocket_depth + 0.6
      ]);

    // Fingerprint reader through-hole.
    translate([finger_x, finger_y, case_d - front_wall - 6])
      rotate([finger_mount_angle, 0, 0])
        cylinder(h = 24, d = finger_cutout_d);

    // Rear cover screw holes.
    for (pos = case_screw_positions) {
      translate([pos[0], pos[1], wall])
        screw_hole(case_d);
    }

    // Power and Ethernet/USB service exits.
    translate([case_w - wall - 0.2, 42, 12])
      cube([wall + 0.4, 36, 16]);
    translate([70, -0.2, 10])
      cube([70, wall + 0.4, 14]);

    // Cooling slots near the Pi.
    for (i = [0:5]) {
      vent_slot(68 + i * 12, case_h - wall - 0.2, 18, 8);
      vent_slot(68 + i * 12, case_h - wall - 0.2, 30, 8);
    }
  }
}

module rear_cover() {
  difference() {
    rounded_prism(case_w - 1.2, case_h - 1.2, 3, corner_r - 1);

    for (pos = case_screw_positions) {
      translate([pos[0] - 0.6, pos[1] - 0.6, -0.1])
        cylinder(h = 3.2, d = case_screw_d + 0.4);
    }

    // Rear ventilation array.
    for (row = [0:2]) {
      for (col = [0:8]) {
        translate([58 + col * 10, 38 + row * 12, -0.1])
          cube([6, 3, 3.2]);
      }
    }
  }
}

module display_placeholder() {
  color("black")
    translate([display_x, display_y, case_d - front_wall - display_pocket_depth])
      cube([display_glass_w, display_glass_h, 0.8]);
}

module pi_placeholder() {
  color("green")
    translate([pi_x - pi_w / 2, pi_y - pi_h / 2, wall + pi_standoff_h])
      cube([pi_w, pi_h, 1.6]);
}

module finger_placeholder() {
  color("silver")
    translate([finger_x, finger_y, case_d + 1])
      rotate([finger_mount_angle, 0, 0])
        cylinder(h = 15, d = finger_face_d);
}

if (part_id == 1) {
  front_shell();
} else if (part_id == 2) {
  rear_cover();
} else {
  color("#b80100") front_shell();
  translate([0.6, 0.6, -6]) color("#333333") rear_cover();
  display_placeholder();
  pi_placeholder();
  finger_placeholder();
}
