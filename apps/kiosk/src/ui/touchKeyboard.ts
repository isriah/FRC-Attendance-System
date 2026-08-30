export type KeyboardLayout = "letters" | "symbols";

export interface KeyboardKey {
  value: string;
  label?: string;
  action?: "shift" | "backspace" | "layout" | "space";
  className?: string;
}

export const letterRows: KeyboardKey[][] = [
  [..."1234567890"].map((value) => ({ value, className: "keyboard-key-number" })),
  [..."qwertyuiop"].map((value) => ({ value })),
  [..."asdfghjkl"].map((value) => ({ value })),
  [
    { value: "", action: "shift", label: "⇧", className: "keyboard-key-wide" },
    ...[..."zxcvbnm"].map((value) => ({ value })),
    { value: "", action: "backspace", label: "⌫", className: "keyboard-key-wide" }
  ],
  [
    { value: "", action: "layout", label: "123", className: "keyboard-key-mode" },
    { value: "", action: "space", label: "space", className: "keyboard-key-space" },
    { value: "." },
    { value: "@" }
  ]
];

export const symbolRows: KeyboardKey[][] = [
  [..."1234567890"].map((value) => ({ value })),
  [..."-/:;()$&@"].map((value) => ({ value })),
  [..."#%*+=_\\|~<>"].map((value) => ({ value })),
  [
    { value: "", action: "layout", label: "ABC", className: "keyboard-key-mode" },
    { value: "", action: "space", label: "space", className: "keyboard-key-space" },
    { value: "", action: "backspace", label: "⌫", className: "keyboard-key-wide" }
  ]
];

export function keyboardRows(layout: KeyboardLayout): KeyboardKey[][] {
  return layout === "letters" ? letterRows : symbolRows;
}

export function characterForKey(key: KeyboardKey, shift: boolean): string {
  return shift && key.value.length === 1 && /[a-z]/.test(key.value) ? key.value.toUpperCase() : key.value;
}
