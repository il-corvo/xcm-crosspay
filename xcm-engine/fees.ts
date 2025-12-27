import type { FeeClamp, FeeQuote } from "./types";

export const DEFAULT_SERVICE_FEE: FeeClamp = {
  pct: 0.0015,   // 0.15%
  minDot: 0.02,
  maxDot: 0.20,
};

// NOTE: this is UI-level placeholder. Real network fee estimation comes later.
export function quoteFeesDot(
  amountDot: number,
  networkFeeDotEst: number,
  clamp: FeeClamp = DEFAULT_SERVICE_FEE
): FeeQuote {
  const notes: string[] = [];

  // service fee = amount * pct, clamped
  let service = amountDot * clamp.pct;

  if (service < clamp.minDot) {
    service = clamp.minDot;
    notes.push(`Service fee clamped to minimum ${clamp.minDot} DOT`);
  }
  if (service > clamp.maxDot) {
    service = clamp.maxDot;
    notes.push(`Service fee clamped to maximum ${clamp.maxDot} DOT`);
  }

  const total = networkFeeDotEst + service;

  return {
    networkFeeDotEst: networkFeeDotEst.toFixed(6),
    serviceFeeDot: service.toFixed(6),
    totalFeeDot: total.toFixed(6),
    notes,
  };
}
