// xcm-engine/capabilities.ts
export type Chain = "assethub" | "hydradx" | "relay" | "people";
export type Asset = "DOT" | "USDC" | "USDT";

export type RouteMode =
  | "stable_reserve"
  | "dot_teleport"
  | "dot_execute_advanced";

export const CAPABILITIES = {
  stablecoin: {
    assets: ["USDC", "USDT"] as const,
    routes: [
      { from: "assethub", to: "hydradx", mode: "stable_reserve" as const },
      { from: "hydradx", to: "assethub", mode: "stable_reserve" as const },
    ],
    minAmount: 0.10,
  },

  dotTeleport: {
    assets: ["DOT"] as const,
    routes: [
      // Relay
      { from: "assethub", to: "relay", mode: "dot_teleport" as const },
      { from: "relay", to: "assethub", mode: "dot_teleport" as const },

      // People (para 1004)
      { from: "assethub", to: "people", mode: "dot_teleport" as const },
      { from: "people", to: "assethub", mode: "dot_teleport" as const },
    ],
    minAmount: 0.05,
  },

  dotExecuteAdvanced: {
    enabledByDefault: false,
    assets: ["DOT"] as const,
    routes: [{ from: "assethub", to: "hydradx", mode: "dot_execute_advanced" as const }],
    minAmount: 0.05,
    maxAmount: 0.50,
  },
} as const;

