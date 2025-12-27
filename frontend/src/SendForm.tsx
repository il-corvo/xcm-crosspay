import { useMemo, useState } from "react";

// Import dal root repo: in Vite non abbiamo alias, usiamo path relativo.
// Nota: frontend è a /frontend, quindi per raggiungere /xcm-engine:
import type { TransferRequest } from "../../xcm-engine/types";
import { validateRequest } from "../../xcm-engine/validate";
import { quoteFeesDot, DEFAULT_SERVICE_FEE } from "../../xcm-engine/fees";

const CHAINS = [
  { key: "assethub", name: "Polkadot Asset Hub" },
  { key: "hydradx", name: "HydraDX" },
] as const;

const ASSETS = [
  { key: "DOT", name: "DOT" },
  { key: "USDC_AH", name: "USDC (Asset Hub)" },
] as const;

export function SendForm() {
  const [from, setFrom] = useState<TransferRequest["from"]>("assethub");
  const [to, setTo] = useState<TransferRequest["to"]>("hydradx");
  const [asset, setAsset] = useState<TransferRequest["asset"]>("DOT");
  const [amount, setAmount] = useState<string>("");

  const req: TransferRequest = { from, to, asset, amount };

  const errors = useMemo(() => validateRequest(req), [from, to, asset, amount]);

  // Placeholder: stima fee rete fissa per ora (poi la stimiamo davvero via RPC)
  const networkFeeDotEst = 0.012;

  const feeQuote = useMemo(() => {
    const amt = Number(amount || "0");
    const amountDot = Number.isFinite(amt) ? amt : 0;
    return quoteFeesDot(amountDot, networkFeeDotEst, DEFAULT_SERVICE_FEE);
  }, [amount]);

  const canSubmit = errors.length === 0;

  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
        marginTop: 20,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Send (Phase 0)</h2>

      <div style={{ display: "grid", gap: 12 }}>
        <label>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>From</div>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value as TransferRequest["from"])}
            style={{ width: "100%", padding: 10, borderRadius: 8 }}
          >
            {CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>To</div>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value as TransferRequest["to"])}
            style={{ width: "100%", padding: 10, borderRadius: 8 }}
          >
            {CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Asset</div>
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as TransferRequest["asset"])}
            style={{ width: "100%", padding: 10, borderRadius: 8 }}
          >
            {ASSETS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Amount</div>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 1.25"
            inputMode="decimal"
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
          />
        </label>
      </div>

      {errors.length > 0 && (
        <div
          style={{
            marginTop: 14,
            border: "1px solid #f0c9c9",
            background: "#fff6f6",
            padding: 12,
            borderRadius: 10,
          }}
        >
          <strong>Fix required</strong>
          <ul style={{ marginTop: 8 }}>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          border: "1px solid #eaeaea",
          background: "#fafafa",
          padding: 12,
          borderRadius: 10,
        }}
      >
        <strong>Fees (estimate)</strong>
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          <div>Network fee (est): {feeQuote.networkFeeDotEst} DOT</div>
          <div>Service fee: {feeQuote.serviceFeeDot} DOT</div>
          <div>
            <b>Total: {feeQuote.totalFeeDot} DOT</b>
          </div>
        </div>

        {feeQuote.notes.length > 0 && (
          <ul style={{ marginTop: 8, opacity: 0.75 }}>
            {feeQuote.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}

        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
          Note: network fee is a placeholder in Phase 0 UI. Real estimation comes next.
        </div>
      </div>

      <button
        disabled={!canSubmit}
        style={{
          marginTop: 14,
          width: "100%",
          padding: 12,
          borderRadius: 10,
          border: "none",
          cursor: canSubmit ? "pointer" : "not-allowed",
          opacity: canSubmit ? 1 : 0.5,
        }}
        onClick={() => alert("Coming soon: wallet connect + XCM build/submit")}
      >
        {canSubmit ? "Send (coming soon)" : "Fix fields to continue"}
      </button>
    </div>
  );
}
