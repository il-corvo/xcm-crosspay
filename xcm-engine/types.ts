export type ChainKey = "assethub" | "hydradx";

export type AssetKey =
  | "USDC_AH"
  | "USDT_AH"
  | "USDC_HYDRA"
  | "USDT_HYDRA";

export type FeeClamp = {
  pct: number;
  minDot: number;
  maxDot: number;
};

export type TransferRequest = {
  from: ChainKey;
  to: ChainKey;
  asset: AssetKey;
  amount: string;
};

export type FeeQuote = {
  networkFeeDotEst: string;
  serviceFeeDot: string;
  totalFeeDot: string;
  notes: string[];
};

