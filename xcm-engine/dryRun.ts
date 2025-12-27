import type { TransferRequest } from "./types";
import type { FeeQuote } from "./types";

export type XcmDryRun = {
  mode: "dry-run";
  from: string;
  to: string;
  asset: string;
  amount: string;
  route: string;
  fees: FeeQuote;
  xcm: Record<string, unknown>;
};

export function buildXcmDryRun(
  req: TransferRequest,
  fee: FeeQuote
): XcmDryRun {
  // Phase 0: explicit, boring, predictable
  const route =
    req.from === "assethub" || req.to === "assethub"
      ? "direct"
      : "via Asset Hub";

  // This is NOT executable XCM yet.
  // It is a transparent preview of intent.
  const xcmPreview = {
    WithdrawAsset: {
      asset: req.asset,
      amount: req.amount,
      from: req.from,
    },
    BuyExecution: {
      fees: fee.totalFeeDot,
      asset: "DOT",
    },
    DepositAsset: {
      asset: req.asset,
      amount: req.amount,
      to: req.to,
    },
  };

  return {
    mode: "dry-run",
    from: req.from,
    to: req.to,
    asset: req.asset,
    amount: req.amount,
    route,
    fees: fee,
    xcm: xcmPreview,
  };
}

