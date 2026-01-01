// xcm-engine/guard.ts
import { CAPABILITIES } from "./capabilities";
import type { Chain, Asset, RouteMode } from "./capabilities";

export type GuardInput = {
  from: Chain;
  to: Chain;
  asset: Asset;
  amount: number;

  // Native token safety (if available)
  fromNativeFree?: number;
  fromNativeED?: number;

  // Relay bootstrap safety (dynamic)
  relayFreeDot?: number;
  relayEDDot?: number;
};

export type GuardResult = {
  ok: boolean;
  hardBlock: boolean;
  mode?: RouteMode;
  reason?: string;
  minRequired?: number;
};

function inRoutes(from: Chain, to: Chain, mode: RouteMode): boolean {
  const all = [
    ...CAPABILITIES.stablecoin.routes,
    ...CAPABILITIES.dotTeleport.routes,
    ...CAPABILITIES.dotExecuteAdvanced.routes,
  ];
  return all.some((r) => r.from === from && r.to === to && r.mode === mode);
}

export function guardRoute(input: GuardInput): GuardResult {
  const { from, to, asset, amount } = input;

  if (from === to) {
    return { ok: false, hardBlock: true, reason: "From and To must be different." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, hardBlock: true, reason: "Amount must be greater than zero." };
  }

  // ----- Stablecoin reserve routes -----
  if ((asset === "USDC" || asset === "USDT") && (from === "assethub" || from === "hydradx")) {
    const mode: RouteMode = "stable_reserve";
    if (!inRoutes(from, to, mode)) {
      return { ok: false, hardBlock: true, mode, reason: "Stablecoin route not supported in safe-mode." };
    }
    if (amount < CAPABILITIES.stablecoin.minAmount) {
      return {
        ok: false,
        hardBlock: true,
        mode,
        reason: `Minimum stablecoin amount is ${CAPABILITIES.stablecoin.minAmount.toFixed(2)}.`,
      };
    }
    return { ok: true, hardBlock: false, mode };
  }

  // ----- DOT teleport routes (AH <-> Relay) -----
  if (asset === "DOT" && (from === "assethub" || from === "relay")) {
    const mode: RouteMode = "dot_teleport";
    if (!inRoutes(from, to, mode)) {
      return { ok: false, hardBlock: true, mode, reason: "DOT teleport route not supported." };
    }
    if (amount < CAPABILITIES.dotTeleport.minAmount) {
      return {
        ok: false,
        hardBlock: true,
        mode,
        reason: `Minimum DOT teleport amount is ${CAPABILITIES.dotTeleport.minAmount.toFixed(2)}.`,
      };
    }

    // Dynamic relay bootstrap guard (your choice A):
    // only when AH -> Relay and relay is below ED
    if (from === "assethub" && to === "relay") {
      const rf = input.relayFreeDot;
      const red = input.relayEDDot;

      if (typeof rf === "number" && typeof red === "number" && rf < red) {
        // buffers: 0.01 + 0.05 DOT
        const minRequired = (red - rf) + 0.01 + 0.05;
        if (amount < minRequired) {
          return {
            ok: false,
            hardBlock: true,
            mode,
            minRequired,
            reason: `Relay account is below ED. Send at least ~${minRequired.toFixed(4)} DOT to bootstrap safely.`,
          };
        }
      }
    }

    return { ok: true, hardBlock: false, mode };
  }

  // ----- DOT advanced execute (AH -> Hydra) -----
  if (asset === "DOT" && from === "assethub" && to === "hydradx") {
    const mode: RouteMode = "dot_execute_advanced";
    if (amount < CAPABILITIES.dotExecuteAdvanced.minAmount || amount > CAPABILITIES.dotExecuteAdvanced.maxAmount) {
      return {
        ok: false,
        hardBlock: true,
        mode,
        reason: `Advanced DOT execute supports ${CAPABILITIES.dotExecuteAdvanced.minAmount.toFixed(2)}–${CAPABILITIES.dotExecuteAdvanced.maxAmount.toFixed(2)} DOT.`,
      };
    }
    return { ok: true, hardBlock: false, mode, reason: "Advanced route enabled (experimental)." };
  }

  return { ok: false, hardBlock: true, reason: "Unsupported asset/route combination." };
}

