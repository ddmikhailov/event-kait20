export type QrReadState = { value: string; lastSeenAt: number };

// In-memory only. Re-arm the same ticket after a full second without a readable QR.
export const acceptQrRead = (
  state: QrReadState,
  value: string | undefined,
  now: number,
): boolean => {
  if (!value) {
    if (now - state.lastSeenAt >= 1_000) state.value = '';
    return false;
  }
  const changed = state.value !== value;
  state.value = value;
  state.lastSeenAt = now;
  return changed;
};
