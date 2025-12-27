import type { FeeQuote, TransferRequest } from "../../xcm-engine/types";
import { validateRequest } from "../../xcm-engine/validate";

const CHAINS = [
  { key: "assethub", name: "Polkadot Asset Hub" },
  { key: "hydradx", name: "HydraDX" },
] as const;

const ASSETS = [
  { key: "DOT", name: "DOT" },
  { key: "USDC_AH", name: "USDC (Asset Hub)" },
] as const;

export function SendForm(props: {
  value: TransferRequest;
  onChange: (next: TransferRequest) => void;
  feeQuote: FeeQuote;
  safetyMsg: string;
  canSend: boolean;
}) {
  const { value, onChange, feeQuote, safetyMsg, canSend } = props;

  const errors = validateRequest(value);

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
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value as TransferRequest["from"] })}
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
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value as TransferRequest["to"] })}
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
            value={value.asset}
            onChange={(e) => onChange({ ...value, asset: e.target.value as TransferRequest["asset"] })}
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
            value={value.amount}
            onChange={(e) => onChange({ ...value, amount: e.target.value })}
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
            <b>Total fee: {feeQuote.totalFeeDot} DOT</b>
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
          {safetyMsg}
        </div>
      </div>

      <button
        disabled={!canSend}
        style={{
          marginTop: 14,
          width: "100%",
          padding: 12,
          borderRadius: 10,
          border: "none",
          cursor: canSend ? "pointer" : "not-allowed",
          opacity: canSend ? 1 : 0.5,
        }}
        onClick={() => alert("Coming soon: build XCM payload + submit")}
      >
        {canSend ? "Send (coming soon)" : "Fix fields / wallet safety to continue"}
      </button>
    </div>
  );
}

