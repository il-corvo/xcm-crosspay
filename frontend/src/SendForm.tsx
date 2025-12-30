import type { TransferRequest, FeeQuote } from "../../xcm-engine/types";
import type { XcmDryRun } from "../../xcm-engine/dryRun";
import { validateRequest } from "../../xcm-engine/validate";

const CHAINS = [
  { key: "assethub", name: "Polkadot Asset Hub" },
  { key: "hydradx", name: "HydraDX" },
] as const;

export function SendForm(props: {
  value: TransferRequest;
  onChange: (next: TransferRequest) => void;

  feeQuote: FeeQuote;
  safetyMsg: string;

  serviceFeeEnabled: boolean;
  onToggleServiceFee: (enabled: boolean) => void;

  canPreview: boolean;
  onDryRun: () => void;
  dryRun?: XcmDryRun;

  canSubmitReal: boolean;
  onSubmitReal: () => void;
  submitHelp: string;

  warning?: string;
}) {
  const {
    value,
    onChange,
    feeQuote,
    safetyMsg,
    serviceFeeEnabled,
    onToggleServiceFee,
    canPreview,
    onDryRun,
    dryRun,
    canSubmitReal,
    onSubmitReal,
    submitHelp,
    warning,
  } = props;

  const errors = validateRequest(value);

  // Safe-mode routing:
  // - Asset Hub -> Hydra: allow USDC_AH + USDT_AH
  // - Hydra -> Asset Hub: show as "coming soon", allow selecting Hydra assets
  const toOptions =
    value.from === "assethub"
      ? [{ key: "hydradx", name: "HydraDX" }]
      : [{ key: "assethub", name: "Polkadot Asset Hub" }];

  const assetOptions =
    value.from === "assethub"
      ? [
          { key: "USDC_AH", label: "USDC (Asset Hub)" },
          { key: "USDT_AH", label: "USDT (Asset Hub)" },
        ]
      : [
          { key: "USDC_HYDRA", label: "USDC (Hydra)" },
          { key: "USDT_HYDRA", label: "USDT (Hydra)" },
        ];

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
      <h2 style={{ marginTop: 0 }}>Send</h2>

      {warning && (
        <div
          style={{
            marginTop: 10,
            border: "1px solid #ffe2a8",
            background: "#fff8e6",
            padding: 12,
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          <b>Note:</b> {warning}
        </div>
      )}

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <label>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>From</div>
          <select
            value={value.from}
            onChange={(e) => {
              const nextFrom = e.target.value as TransferRequest["from"];
              const nextTo: TransferRequest["to"] =
                nextFrom === "assethub" ? "hydradx" : "assethub";

              // default asset per chain
              const nextAsset: TransferRequest["asset"] =
                nextFrom === "assethub" ? "USDC_AH" : "USDC_HYDRA";

              onChange({ ...value, from: nextFrom, to: nextTo, asset: nextAsset });
            }}
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
            onChange={(e) => onChange({ ...value, to: e.target.value as any })}
            style={{ width: "100%", padding: 10, borderRadius: 8 }}
          >
            {toOptions.map((c) => (
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
            onChange={(e) =>
              onChange({ ...value, asset: e.target.value as any })
            }
            style={{ width: "100%", padding: 10, borderRadius: 8 }}
          >
            {assetOptions.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
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
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              border: "1px solid #ddd",
            }}
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

        <div style={{ marginTop: 12 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={serviceFeeEnabled}
              onChange={(e) => onToggleServiceFee(e.target.checked)}
            />
            <span>Include service fee (default on)</span>
          </label>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
            Service fees help fund development and maintenance of this non-custodial dApp.
            You can disable them if you prefer.
          </div>
          {!serviceFeeEnabled && (
            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
              Service fee disabled. Consider enabling it to support the project.
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>{safetyMsg}</div>
      </div>

      <button
        disabled={!canPreview}
        style={{
          marginTop: 14,
          width: "100%",
          padding: 12,
          borderRadius: 10,
          border: "none",
          cursor: canPreview ? "pointer" : "not-allowed",
          opacity: canPreview ? 1 : 0.5,
        }}
        onClick={onDryRun}
      >
        {canPreview ? "Preview XCM (dry-run)" : "Fix fields / wallet safety to continue"}
      </button>

      <button
        disabled={!canSubmitReal}
        style={{
          marginTop: 10,
          width: "100%",
          padding: 12,
          borderRadius: 10,
          border: "1px solid #111",
          background: canSubmitReal ? "#111" : "#777",
          color: "#fff",
          cursor: canSubmitReal ? "pointer" : "not-allowed",
          opacity: canSubmitReal ? 1 : 0.7,
        }}
        onClick={onSubmitReal}
      >
        Submit (REAL)
      </button>

      <div style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>{submitHelp}</div>

      {dryRun && (
        <div
          style={{
            marginTop: 20,
            padding: 12,
            borderRadius: 10,
            background: "#0b0b0b",
            color: "#e6e6e6",
            fontSize: 13,
            overflowX: "auto",
          }}
        >
          <strong>XCM dry-run preview</strong>
          <pre style={{ marginTop: 10 }}>{JSON.stringify(dryRun, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

