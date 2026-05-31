import states from "./kioskStates.json";

export const kioskStates = states;

export type KioskStateId = keyof typeof kioskStates;

export type DisplayStatus = KioskStateId;

export interface KioskDisplayState {
  status: DisplayStatus;
  message: string;
  detail: string;
  updatedAt: string;
}

export function baseDisplayState(status: KioskStateId): Omit<KioskDisplayState, "updatedAt"> {
  const state = kioskStates[status];
  return {
    status,
    message: state.display.message,
    detail: state.display.detail
  };
}
