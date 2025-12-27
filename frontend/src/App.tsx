import { useMemo, useState } from "react";
import "./App.css";

import { WalletPanel } from "./WalletPanel";
import type { ChainKey, WalletChainData } from "./WalletPanel";
import { SendForm } from "./SendForm";

import type { TransferRequest } from "../../xcm-engine/types";
import { validateRequest } from "../../xcm-engine/validate";
import { quoteFeesDot, DEFAULT_SERVICE_FEE } from "../../xcm-engine/fees";

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

  const errors = useMemo(() => validateRequest(req), [req]);

  // Placeholder Phase 0: stima fissa fee di rete (poi la stimiamo via RPC/chain)
  const networkFeeDotEst = 0.012;

  const amt = Number(req.amount || "0");
  const amtNum = Number.isFinite(amt) ? amt : 0;

  // Service fee model: percent only on DOT sends; for USDC we use min clamp (for now).
  const amountForServiceFeeDot = req.asset === "DOT" ? amtNum : 0;

  const feeQuote = useMemo(() => {
    const q = quoteFeesDot(amountForServiceFeeDot, networkFeeDotEst, DEFAULT_SERVICE_FEE);
    if (req.asset !== "DOT") {
      q.notes = [...q.notes, "USDC transfer: service fee is currently min-clamped (Phase 0)."];
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.asset, amountForServiceFeeDot]);

  const bal = Number(wallet.balanceDot ?? "NaN");
  const ed = Number(wallet.edDot ?? "NaN");
  const feeTotal = Number(feeQuote.totalFeeDot);

  const hasWalletNums = Number.isFinite(bal) && Number.isFinite(ed) && Number.isFinite(feeTotal);

  // Required DOT depends on asset:
  // - if sending DOT: amount + fees
  // - if sending USDC: fees only (still must keep ED)
  const requiredDot = req.asset === "DOT" ? (amtNum + feeTotal) : feeTotal;
  const remaining = hasWalletNums ? (bal - requiredDot) : NaN;

  const safe = hasWalletNums ? (remaining >= ed) : false;

  const safetyMsg = !hasWalletNums
    ? "Wallet data not ready yet."
    : safe
      ? `OK: remaining ≈ ${remaining.toFixed(6)} DOT (ED ${ed}).`
      : `Too much: would leave ≈ ${remaining.toFixed(6)} DOT (below ED ${ed}).`;

  const canSend = errors.length === 0 && safe;

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
        onChange={setReq}
        feeQuote={feeQuote}
        safetyMsg={safetyMsg}
        canSend={canSend}
      />

      <section style={{ marginTop: 28, opacity: 0.7 }}>
        <h2 style={{ marginBottom: 8 }}>Status</h2>
        <p style={{ margin: 0 }}>
          UI is live. Wallet is connected. Next: XCM payload (dry-run) then submit.
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
          <a href="https://github.com/il-corvo/xcm-crosspay" target="_blank" rel="noreferrer">
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

