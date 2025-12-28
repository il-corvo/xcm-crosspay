export type ChainKey = "assethub" | "hydradx";

export type AssetKey = "DOT" | "USDC_AH" | "USDC_HYDRA";

export type FeeClamp = {
  pct: number; // e.g. 0.0015 = 0.15%
  minDot: number; // e.g. 0.02
  maxDot: number; // e.g. 0.20
};

export type TransferRequest = {
  from: ChainKey;
  to: ChainKey;
  asset: AssetKey;
  amount: string; // decimal string (UI-level)
};

export type FeeQuote = {
  networkFeeDotEst: string; // decimal string
  serviceFeeDot: string; // decimal string
  totalFeeDot: string; // decimal string
  notes: string[];
};

