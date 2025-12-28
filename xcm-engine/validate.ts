import type { TransferRequest } from "./types";

export function validateRequest(req: TransferRequest): string[] {
  const errs: string[] = [];

  if (req.from === req.to) errs.push("From and To chains must be different.");

  if (!req.amount || Number(req.amount) <= 0) {
    errs.push("Amount must be greater than zero.");
  }

  // Phase 0/1 strict scope
  const allowedAssets = new Set(["DOT", "USDC_AH", "USDC_HYDRA"]);
  if (!allowedAssets.has(req.asset)) errs.push("Unsupported asset (Phase 0/1).");

  const allowedChains = new Set(["assethub", "hydradx"]);
  if (!allowedChains.has(req.from) || !allowedChains.has(req.to)) {
    errs.push("Unsupported chain (Phase 0/1).");
  }

  return errs;
}

