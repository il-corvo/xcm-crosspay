import { useMemo, useState } from "react";
import "./App.css";

import { WalletPanel } from "./WalletPanel";
import type { ChainKey, WalletChainData } from "./WalletPanel";
import { SendForm } from "./SendForm";

import type { TransferRequest } from "../../xcm-engine/types";
import { validateRequest } from "../../xcm-engine/validate";
import { quoteFeesDot, DEFAULT_SERVICE_FEE } from "../../xcm-engine/fees";

import { buildXcmDryRun } from "../../xcm-engine/dryRun";
import type { XcmDryRun } from "../../xcm-engine/dryRun";

export default function App() {
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? "dev";

  const [req, setReq] = useState<TransferRequest>({
    from: "assethub",
    to: "hydradx",
    asset: "DOT",
    amount: "",
  });

  const [wallet, setWallet] = useState<WalletChainData>({
    status: "Not connected",
  });

  const [dryRun, setDryRun] = useState<XcmDryRun | undefined>(undefined);

  const errors = useMemo(() => validateRequest(req), [req]);

  // Phase 0/1 placeholder: network fee estimate is fixed (we will do real estimation later)
  const networkFeeDotEst = 0.012;

  const amt = Number(req.amount || "0");
  const amtNum = Number.isFinite(amt) ? amt : 0;

  // Service fee base:
  // - If sending DOT: service fee is proportional to amount
  // - If sending USDC: service fee uses min clamp (Phase 1 simplification)
  const amountForServiceFeeDot = req.asset === "DOT" ? amtNum : 0;

  const feeQuote = useMemo(() => {
    const q = quoteFeesDot(
      amountForServiceFeeDot,
      networkFeeDotEst,
      DEFAULT_SERVICE_FEE
    );
    if (req.asset !== "DOT") {
      q.notes = [...q.notes, "USDC transfer: service fee is currently min-clamped (Phase 1)."];
    }
    return q;
  }, [req.asset, amountForServiceFeeDot]);

  // Wallet safety check (ED)
  const bal = Number(wallet.balanceDot ?? "NaN");
  const ed = Number(wallet.edDot ?? "NaN");
  const feeTotal = Number(feeQuote.totalFeeDot);

  const hasWalletNums =
    Number.isFinite(bal) && Number.isFinite(ed) && Number.isFinite(feeTotal);

  // Required DOT depends on asset:
  // - DOT transfer consumes DOT amount + DOT fees
  // - USDC transfer consumes only DOT fees (still must keep ED on the selected "from" chain)
  const requiredDot = req.asset === "DOT" ? amtNum + feeTotal : feeTotal;

  const remaining = hasWalletNums ? bal - requiredDot : NaN;
  const safe = hasWalletNums ? remaining >= ed : false;

  const safetyMsg = !hasWalletNums
    ? "Wallet data not ready yet."
    : safe
    ? `OK: remaining ≈ ${remaining.toFixed(6)} DOT (ED ${ed}).`
    : `Too much: would leave ≈ ${remaining.toFixed(6)} DOT (below ED ${ed}).`;

  const canSend = errors.length === 0 && safe;

  const handleDryRun = () => {
    const preview = buildXcmDryRun(req, feeQuote);
    setDryRun(preview);
  };

  return (
    <div style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>XCM CrossPay</h1>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Non-custodial XCM transfers across Polkadot chains — simple, defensive flows.
        </p>
      </header>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 10,
          padding: 16,
          background: "#fafafa",
        }}
      >
        <strong>⚠️ Public alpha</strong>
        <ul style={{ marginTop: 10 }}>
          <li>All transactions are signed by the user (non-custodial).</li>
          <li>No funds are ever held by this app.</li>
          <li>Failed executions and edge cases are possible.</li>
          <li>
            <b>Use small amounts</b>.
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ marginBottom: 8 }}>Phase 0 scope</h2>
        <ul>
          <li>
            <b>Assets</b>: DOT, USDC (Asset Hub)
          </li>
          <li>
            <b>Chains</b>: Asset Hub ↔ HydraDX
          </li>
          <li>
            <b>Routing</b>: defensive (via Asset Hub when needed)
          </li>
          <li>
            <b>Fees</b>: network fees + service fee (0.15%, clamped)
          </li>
        </ul>
      </section>

      <WalletPanel
        chain={req.from as ChainKey}
        onChainData={(d) => setWallet((prev) => ({ ...prev, ...d }))}
      />

      <SendForm
        value={req}
        onChange={(next) => {
          setReq(next);
          setDryRun(undefined); // clear preview when user changes input
        }}
        feeQuote={feeQuote}
        safetyMsg={safetyMsg}
        canSend={canSend}
        onDryRun={handleDryRun}
        dryRun={dryRun}
      />

      <section style={{ marginTop: 28, opacity: 0.7 }}>
        <h2 style={{ marginBottom: 8 }}>Status</h2>
        <p style={{ margin: 0 }}>
          Wallet is connected (read-only). Phase 1 supports transparent XCM dry-run preview.
        </p>
        <p style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Wallet status:</b> {wallet.status}
        </p>
        {errors.length > 0 && (
          <p style={{ marginTop: 10 }}>
            <b>Form errors:</b> {errors.join(" | ")}
          </p>
        )}
      </section>

      <footer style={{ marginTop: 40, opacity: 0.6 }}>
        <p style={{ margin: 0 }}>
          Source:{" "}
          <a
            href="https://github.com/il-corvo/xcm-crosspay"
            target="_blank"
            rel="noreferrer"
          >
            GitHub (MIT)
          </a>
        </p>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.6 }}>
          Build: {buildSha.slice(0, 7)}
        </div>
      </footer>
    </div>
  );
}

