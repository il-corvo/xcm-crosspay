import { useMemo, useState } from "react";
import "./App.css";

import { WalletPanel } from "./WalletPanel";
import type { ChainKey, WalletChainData } from "./WalletPanel";
import { SendForm } from "./SendForm";

import type { TransferRequest, FeeQuote } from "../../xcm-engine/types";
import { validateRequest } from "../../xcm-engine/validate";
import { quoteFeesDot, DEFAULT_SERVICE_FEE } from "../../xcm-engine/fees";

import { buildXcmDryRun } from "../../xcm-engine/dryRun";
import type { XcmDryRun } from "../../xcm-engine/dryRun";

import { ApiPromise, WsProvider } from "@polkadot/api";
import { web3FromAddress } from "@polkadot/extension-dapp";
import { decodeAddress } from "@polkadot/util-crypto";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("RPC timeout")), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function parseDecimalToInt(amount: string, decimals: number): bigint {
  const s = (amount ?? "").trim();
  if (!s) return 0n;
  const m = s.match(/^(\d*)\.?(\d*)$/);
  if (!m) return 0n;

  const wholeStr = m[1] || "0";
  const fracRaw = m[2] || "";
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");

  const whole = BigInt(wholeStr || "0");
  const fracInt = BigInt(frac || "0");
  const base = 10n ** BigInt(decimals);

  return whole * base + fracInt;
}

function makeFeeQuoteNoService(networkFeeDotEst: number): FeeQuote {
  return {
    networkFeeDotEst: networkFeeDotEst.toFixed(6),
    serviceFeeDot: (0).toFixed(6),
    totalFeeDot: networkFeeDotEst.toFixed(6),
    notes: ["Service fee disabled (opt-out)."],
  };
}

async function connectApiWithFallback(
  rpcs: string[],
  setLog: (fn: (s: string) => string) => void
): Promise<ApiPromise> {
  setLog((s) => s + "Connecting RPC (fallback mode)\n");
  let lastErr: any = null;

  for (const rpc of rpcs) {
    try {
      setLog((s) => s + `→ Trying: ${rpc}\n`);
      const api = await withTimeout(
        ApiPromise.create({ provider: new WsProvider(rpc) }),
        8000
      );
      setLog((s) => s + `✅ Connected: ${rpc}\n`);
      return api;
    } catch (e: any) {
      lastErr = e;
      setLog((s) => s + `✗ Failed: ${rpc} (${e?.message ?? String(e)})\n`);
    }
  }

  throw new Error(
    `All RPC endpoints failed. Last error: ${lastErr?.message ?? String(lastErr)}`
  );
}

function logAttemptedAndSomeEvents(
  result: any,
  setLog: (fn: (s: string) => string) => void
) {
  try {
    const lines: string[] = [];
    for (const { event } of result.events) {
      const sec = event.section;
      const met = event.method;

      if (sec === "polkadotXcm" && met === "Attempted") {
        let payload = "";
        try { payload = JSON.stringify(event.toHuman(), null, 2); } catch { payload = event.toString(); }
        lines.push(`*** polkadotXcm.Attempted ***\n${payload}`);
      } else if (
        sec === "polkadotXcm" ||
        sec === "xcmpQueue" ||
        sec === "messageQueue" ||
        sec === "balances" ||
        sec === "assets" ||
        sec === "system"
      ) {
        let payload = "";
        try { payload = JSON.stringify(event.toHuman()); } catch { payload = event.toString(); }
        lines.push(`${sec}.${met}: ${payload}`);
      }
    }

    if (lines.length) {
      setLog((s) => s + `\n--- EVENTS (debug) ---\n${lines.join("\n")}\n--- END EVENTS ---\n`);
    }
  } catch {}
}

export default function App() {
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? "dev";

  const [req, setReq] = useState<TransferRequest>({
    from: "assethub",
    to: "hydradx",
    asset: "USDC_AH",
    amount: "",
  });

  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(true);

  const [wallet, setWallet] = useState<WalletChainData>({ status: "Not connected" });
  const [selectedAddress, setSelectedAddress] = useState<string>("");

  const [dryRun, setDryRun] = useState<XcmDryRun | undefined>(undefined);
  const [submitLog, setSubmitLog] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const errors = useMemo(() => validateRequest(req), [req]);

  const networkFeeDotEst = 0.012;

  const amt = Number(req.amount || "0");
  const amtNum = Number.isFinite(amt) ? amt : 0;

  const feeQuote = useMemo(() => {
    if (!serviceFeeEnabled) return makeFeeQuoteNoService(networkFeeDotEst);
    // For USDC we keep service fee min-clamped (when enabled)
    const q = quoteFeesDot(0, networkFeeDotEst, DEFAULT_SERVICE_FEE);
    q.notes = [...q.notes, "USDC transfer: service fee is min-clamped when enabled."];
    return q;
  }, [serviceFeeEnabled]);

  const balNative = Number(wallet.balanceDot ?? "NaN"); // DOT on Asset Hub
  const edNative = Number(wallet.edDot ?? "NaN");
  const feeTotal = Number(feeQuote.totalFeeDot);

  const hasWalletNums = Number.isFinite(balNative) && Number.isFinite(edNative) && Number.isFinite(feeTotal);
  const remaining = hasWalletNums ? balNative - feeTotal : NaN;
  const safe = hasWalletNums ? remaining >= edNative : false;

  const safetyMsg = !hasWalletNums
    ? "Wallet data not ready yet."
    : safe
    ? `OK: remaining DOT ≈ ${remaining.toFixed(6)} (ED ${edNative}).`
    : `Too much: would leave ≈ ${remaining.toFixed(6)} (below ED ${edNative}).`;

  const canPreview = errors.length === 0 && safe;

  const supportsRealSubmit =
    req.from === "assethub" &&
    req.to === "hydradx" &&
    req.asset === "USDC_AH" &&
    selectedAddress.length > 0 &&
    (req.amount ?? "").trim().length > 0;

  const canSubmitReal = canPreview && supportsRealSubmit && !submitting;

  const submitHelp =
    supportsRealSubmit
      ? "Real submit enabled: USDC (Asset Hub) → HydraDX."
      : "Real submit currently supports only: USDC (Asset Hub) → HydraDX.";

  const ASSET_HUB_RPCS = [
    "wss://polkadot-asset-hub-rpc.polkadot.io",
    "wss://rpc-asset-hub-polkadot.luckyfriday.io",
    "wss://polkadot-asset-hub-rpc.polkadot.io/ws",
    "wss://asset-hub-polkadot-rpc.dwellir.com", // last
    "wss://asset-hub-polkadot-rpc.dwellir.com/ws",
  ];

  const onDryRun = () => setDryRun(buildXcmDryRun(req, feeQuote));

  async function onSubmitReal() {
    setSubmitLog("");
    setSubmitting(true);

    try {
      if (!supportsRealSubmit) throw new Error("Unsupported route/asset for real submit (Phase safe-mode).");
      if (!canPreview) throw new Error("Form is not safe/valid yet.");

      const api = await connectApiWithFallback(ASSET_HUB_RPCS, setSubmitLog);

      const injector = await web3FromAddress(selectedAddress);
      api.setSigner(injector.signer);

      const HYDRADX_PARA = 2034;

      const dest = { V3: { parents: 1, interior: { X1: { Parachain: HYDRADX_PARA } } } };

      const id = decodeAddress(selectedAddress);
      const beneficiary = { V3: { parents: 0, interior: { X1: { AccountId32: { network: null, id } } } } };

      const USDC_ID_AH = 1337;
      const md: any = await api.query.assets.metadata(USDC_ID_AH);
      const decimals: number = Number(md.decimals?.toString?.() ?? "6");
      const symbol: string = String(md.symbol?.toHuman?.() ?? "USDC");

      setSubmitLog((s) => s + `Asset: ${symbol} (id ${USDC_ID_AH}, decimals ${decimals})\n`);

      const amountInt = parseDecimalToInt(req.amount, decimals);
      if (amountInt <= 0n) throw new Error("Amount too small (after decimals).");

      const assets = {
        V3: [
          {
            fun: { Fungible: amountInt.toString() },
            id: {
              Concrete: {
                parents: 0,
                interior: { X2: [{ PalletInstance: 50 }, { GeneralIndex: String(USDC_ID_AH) }] },
              },
            },
          },
        ],
      };

      const feeAssetItem = 0;
      const weightLimit = { Unlimited: null };

      const tx = api.tx.polkadotXcm.limitedReserveTransferAssets(dest as any, beneficiary as any, assets as any, feeAssetItem, weightLimit as any);

      setSubmitLog((s) => s + "Signing & submitting...\n");

      let dispatchLogged = false;

      const unsub = await tx.signAndSend(selectedAddress, (result) => {
        if (result.status.isInBlock) {
          setSubmitLog((s) => s + `✅ In block: ${result.status.asInBlock.toString()}\n`);
        } else if (result.status.isFinalized) {
          setSubmitLog((s) => s + `🎉 Finalized: ${result.status.asFinalized.toString()}\n`);
          try { unsub(); } catch {}
          api.disconnect().catch(() => {});
          setSubmitting(false);
        } else {
          setSubmitLog((s) => s + `Status: ${result.status.type}\n`);
        }

        logAttemptedAndSomeEvents(result, setSubmitLog);

        if (result.dispatchError && !dispatchLogged) {
          dispatchLogged = true;
          let errMsg = result.dispatchError.toString();
          if (result.dispatchError.isModule) {
            const decoded = api.registry.findMetaError(result.dispatchError.asModule);
            errMsg = `${decoded.section}.${decoded.name}: ${decoded.docs.join(" ")}`;
          }
          setSubmitLog((s) => s + `❌ DispatchError: ${errMsg}\n`);
        }
      });
    } catch (e: any) {
      setSubmitLog((s) => s + `❌ Error: ${e?.message ?? String(e)}\n`);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>XCM CrossPay</h1>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Non-custodial XCM transfers across Polkadot chains — simple, defensive flows.
        </p>
      </header>

      <WalletPanel
        chain={req.from as ChainKey}
        onSelectedAddress={setSelectedAddress}
        onChainData={(d) => setWallet((prev) => ({ ...prev, ...d }))}
      />

      <SendForm
        value={req}
        onChange={(next) => {
          setReq(next);
          setDryRun(undefined);
          setSubmitLog("");
        }}
        feeQuote={feeQuote}
        safetyMsg={safetyMsg}
        serviceFeeEnabled={serviceFeeEnabled}
        onToggleServiceFee={setServiceFeeEnabled}
        canPreview={canPreview}
        onDryRun={onDryRun}
        dryRun={dryRun}
        canSubmitReal={canSubmitReal}
        onSubmitReal={onSubmitReal}
        submitHelp={submitHelp}
        warning={undefined}
      />

      {submitLog && (
        <div style={{ marginTop: 20, padding: 12, borderRadius: 10, background: "#0b0b0b", color: "#e6e6e6", fontSize: 13, overflowX: "auto" }}>
          <strong>Submit log</strong>
          <pre style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>{submitLog}</pre>
        </div>
      )}

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

