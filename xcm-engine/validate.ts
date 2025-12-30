import type { TransferRequest } from "./types";

export function validateRequest(req: TransferRequest): string[] {
  const errs: string[] = [];

  if (req.from === req.to) errs.push("From and To chains must be different.");

  if (!req.amount || Number(req.amount) <= 0) {
    errs.push("Amount must be greater than zero.");
  }

  const allowedAssets = new Set(["USDC_AH", "USDT_AH", "USDC_HYDRA", "USDT_HYDRA"]);
  if (!allowedAssets.has(req.asset)) errs.push("Unsupported asset.");

  const allowedChains = new Set(["assethub", "hydradx"]);
  if (!allowedChains.has(req.from) || !allowedChains.has(req.to)) {
    errs.push("Unsupported chain.");
  }

  return errs;
}

