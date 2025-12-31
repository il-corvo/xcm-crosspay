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

const MIN_STABLE = 0.10;

// Advanced DOT execute (guardrails)
const DOT_EXEC_MIN = 0.05;
const DOT_EXEC_MAX = 0.50;
const DOT_DECIMALS = 10;
const DOT_BASE = 10n ** 10n;

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
  setLog: (fn: (s: string) => string) => void,
  cacheKey: string
): Promise<{ api: ApiPromise; rpc: string }> {
  const cached = sessionStorage.getItem(cacheKey);
  const ordered = cached ? [cached, ...rpcs.filter((x) => x !== cached)] : rpcs;

  setLog((s) => s + "Connecting RPC (fallback mode)\n");
  let lastErr: any = null;

  for (const rpc of ordered) {
    try {
      setLog((s) => s + `→ Trying: ${rpc}\n`);
      const api = await withTimeout(
        ApiPromise.create({ provider: new WsProvider(rpc) }),
        8000
      );
      setLog((s) => s + `✅ Connected: ${rpc}\n`);
      sessionStorage.setItem(cacheKey, rpc);
      return { api, rpc };
    } catch (e: any) {
      lastErr = e;
      setLog((s) => s + `✗ Failed: ${rpc} (${e?.message ?? String(e)})\n`);
    }
  }

  throw new Error(`All RPC endpoints failed. Last error: ${lastErr?.message ?? String(lastErr)}`);
}

function logFinalizedEvents(
  result: any,
  setLog: (fn: (s: string) => string) => void
) {
  if (!result.status?.isFinalized) return;

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
        sec === "tokens" ||
        sec === "system"
      ) {
        let payload = "";
        try { payload = JSON.stringify(event.toHuman()); } catch { payload = event.toString(); }
        lines.push(`${sec}.${met}: ${payload}`);
      }
    }

    if (lines.length) {
      setLog((s) => s + `\n--- EVENTS (finalized) ---\n${lines.join("\n")}\n--- END EVENTS ---\n`);
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

  // Advanced DOT execute toggle (OFF by default)
  const [dotExecuteEnabled, setDotExecuteEnabled] = useState(false);

  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(true);

  const [wallet, setWallet] = useState<WalletChainData>({ status: "Not connected" });
  const [selectedAddress, setSelectedAddress] = useState<string>("");

  const [dryRun, setDryRun] = useState<XcmDryRun | undefined>(undefined);
  const [submitLog, setSubmitLog] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const guardedReq = useMemo<TransferRequest>(() => {
    if (req.from !== req.to) return req;
    const nextTo: TransferRequest["to"] =
      req.from === "assethub" ? "hydradx" : "assethub";
    return { ...req, to: nextTo };
  }, [req]);

  const errors = useMemo(() => validateRequest(guardedReq), [guardedReq]);

  const networkFeeDotEst = 0.012;

  const feeQuote = useMemo(() => {
    if (!serviceFeeEnabled) return makeFeeQuoteNoService(networkFeeDotEst);
    const q = quoteFeesDot(0, networkFeeDotEst, DEFAULT_SERVICE_FEE);
    q.notes = [...q.notes, "Stablecoin transfer: service fee is min-clamped when enabled."];
    return q;
  }, [serviceFeeEnabled]);

  const amountNum = Number(guardedReq.amount || "0");
  const minOk = Number.isFinite(amountNum) && amountNum >= MIN_STABLE;

  const balNative = Number(wallet.balanceDot ?? "NaN");
  const edNative = Number(wallet.edDot ?? "NaN");
  const feeTotal = Number(feeQuote.totalFeeDot);

  const hasWalletNums = Number.isFinite(balNative) && Number.isFinite(edNative) && Number.isFinite(feeTotal);
  const remaining = hasWalletNums ? balNative - feeTotal : NaN;
  const safe = hasWalletNums ? remaining >= edNative : false;

  const safetyMsg = !hasWalletNums
    ? "Wallet data not ready yet."
    : safe
    ? `OK: remaining native ≈ ${remaining.toFixed(6)} (ED ${edNative}).`
    : `Too much: would leave ≈ ${remaining.toFixed(6)} (below ED ${edNative}).`;

  const canPreview = errors.length === 0 && safe && minOk;

  const modeLabel =
    guardedReq.from === "assethub"
      ? "Asset Hub → HydraDX (reserve transfer)"
      : "HydraDX → Asset Hub (reserve transfer)";

  // Stable routes
  const supportsAhToHydra =
    guardedReq.from === "assethub" &&
    guardedReq.to === "hydradx" &&
    (guardedReq.asset === "USDC_AH" || guardedReq.asset === "USDT_AH") &&
    selectedAddress.length > 0;

  const supportsHydraToAh =
    guardedReq.from === "hydradx" &&
    guardedReq.to === "assethub" &&
    (guardedReq.asset === "USDC_HYDRA" || guardedReq.asset === "USDT_HYDRA") &&
    selectedAddress.length > 0;

  // Advanced DOT execute route (separate, only AH -> Hydra)
  const dotExecAmountOk =
    Number.isFinite(amountNum) &&
    amountNum >= DOT_EXEC_MIN &&
    amountNum <= DOT_EXEC_MAX;

  const supportsDotExecute =
    dotExecuteEnabled &&
    guardedReq.from === "assethub" &&
    guardedReq.to === "hydradx" &&
    selectedAddress.length > 0 &&
    dotExecAmountOk;

  const canSubmitReal =
    !submitting && (
      (canPreview && (supportsAhToHydra || supportsHydraToAh)) ||
      supportsDotExecute
    );

  const submitHelp =
    supportsDotExecute
      ? "Real submit: DOT (advanced) via polkadotXcm.execute (experimental)."
      : supportsAhToHydra
      ? "Real submit enabled: stablecoin Asset Hub → HydraDX."
      : supportsHydraToAh
      ? "Real submit enabled: stablecoin HydraDX → Asset Hub."
      : "Unsupported route/asset (safe-mode).";

  const warning =
    dotExecuteEnabled
      ? `Advanced DOT execute enabled. Range: ${DOT_EXEC_MIN.toFixed(2)}–${DOT_EXEC_MAX.toFixed(2)} DOT. Use with caution.`
      : !minOk
      ? `Minimum stablecoin amount is ${MIN_STABLE.toFixed(2)}.`
      : undefined;

  const onDryRun = () => setDryRun(buildXcmDryRun(guardedReq, feeQuote));

  const ASSET_HUB_RPCS = [
    "wss://polkadot-asset-hub-rpc.polkadot.io",
    "wss://rpc-asset-hub-polkadot.luckyfriday.io",
    "wss://polkadot-asset-hub-rpc.polkadot.io/ws",
    "wss://asset-hub-polkadot-rpc.dwellir.com",
    "wss://asset-hub-polkadot-rpc.dwellir.com/ws",
  ];

  const HYDRA_RPCS = ["wss://rpc.hydradx.cloud", "wss://hydradx-rpc.dwellir.com"];

  async function makeTxAhToHydra(api: ApiPromise) {
    const injector = await web3FromAddress(selectedAddress);
    api.setSigner(injector.signer);

    const HYDRADX_PARA = 2034;
    const dest = { V3: { parents: 1, interior: { X1: { Parachain: HYDRADX_PARA } } } };

    const id = decodeAddress(selectedAddress);
    const beneficiary = { V3: { parents: 0, interior: { X1: { AccountId32: { network: null, id } } } } };

    const assetId = guardedReq.asset === "USDC_AH" ? 1337 : 1984;

    const md: any = await api.query.assets.metadata(assetId);
    const decimals: number = Number(md.decimals?.toString?.() ?? "6");
    const symbol: string = String(md.symbol?.toHuman?.() ?? "ASSET");

    setSubmitLog((s) => s + `Asset: ${symbol} (id ${assetId}, decimals ${decimals})\n`);

    const amountInt = parseDecimalToInt(guardedReq.amount, decimals);

    const assets = {
      V3: [
        {
          fun: { Fungible: amountInt.toString() },
          id: { Concrete: { parents: 0, interior: { X2: [{ PalletInstance: 50 }, { GeneralIndex: String(assetId) }] } } },
        },
      ],
    };

    return api.tx.polkadotXcm.limitedReserveTransferAssets(dest as any, beneficiary as any, assets as any, 0, { Unlimited: null } as any);
  }

  async function makeTxHydraToAh(api: ApiPromise) {
    const injector = await web3FromAddress(selectedAddress);
    api.setSigner(injector.signer);

    const ASSET_HUB_PARA = 1000;
    const dest = { V3: { parents: 1, interior: { X1: { Parachain: ASSET_HUB_PARA } } } };

    const id = decodeAddress(selectedAddress);
    const beneficiary = { V3: { parents: 0, interior: { X1: { AccountId32: { network: null, id } } } } };

    const generalIndex = guardedReq.asset === "USDC_HYDRA" ? "1337" : "1984";
    const hydraAssetId = guardedReq.asset === "USDC_HYDRA" ? 22 : 10;

    const a: any = await api.query.assetRegistry.assets(hydraAssetId);
    const human = a.toHuman() as any;
    const decimals: number = Number(human?.decimals ?? "6");
    const symbol: string = String(human?.symbol ?? "USDT");

    setSubmitLog((s) => s + `Asset (Hydra): ${symbol} (assetId ${hydraAssetId}, decimals ${decimals})\n`);
    setSubmitLog((s) => s + `Reserve location: parents=1, X3[Parachain 1000, PalletInstance 50, GeneralIndex ${generalIndex}]\n`);

    const amountInt = parseDecimalToInt(guardedReq.amount, decimals);

    const assets = {
      V3: [
        {
          fun: { Fungible: amountInt.toString() },
          id: {
            Concrete: {
              parents: 1,
              interior: {
                X3: [
                  { Parachain: ASSET_HUB_PARA },
                  { PalletInstance: 50 },
                  { GeneralIndex: generalIndex },
                ],
              },
            },
          },
        },
      ],
    };

    return api.tx.polkadotXcm.limitedReserveTransferAssets(dest as any, beneficiary as any, assets as any, 0, { Unlimited: null } as any);
  }

  async function makeTxDotExecute(api: ApiPromise) {
    // execute is only on Asset Hub
    const injector = await web3FromAddress(selectedAddress);
    api.setSigner(injector.signer);

    const amountPlanck = parseDecimalToInt(guardedReq.amount, DOT_DECIMALS);

    // fee prudente: 1% con min 0.01 DOT, max 0.02 DOT
    const feeMin = 1n * (DOT_BASE / 100n); // 0.01 DOT
    const feeMax = 2n * (DOT_BASE / 100n); // 0.02 DOT
    const feePct = amountPlanck / 100n; // 1%

    let feePlanck = feePct;
    if (feePlanck < feeMin) feePlanck = feeMin;
    if (feePlanck > feeMax) feePlanck = feeMax;
    if (feePlanck >= amountPlanck) feePlanck = amountPlanck / 2n;

    const HYDRADX_PARA = 2034;
    const beneficiaryId = decodeAddress(selectedAddress);

    // Message template derived from your successful Subscan execute example:
    // V4: WithdrawAsset(DOT parents:1 Here), BuyExecution(fees DOT), DepositReserveAsset(dest para 2034, xcm=[BuyExecution, DepositAsset])
    const message = {
      V4: [
        {
          WithdrawAsset: [
            {
              id: { parents: 1, interior: { Here: null } },
              fun: { Fungible: amountPlanck.toString() },
            },
          ],
        },
        {
          BuyExecution: {
            fees: {
              id: { parents: 1, interior: { Here: null } },
              fun: { Fungible: feePlanck.toString() },
            },
            weight_limit: { Limited: { proof_size: 1, ref_time: 1 } },
          },
        },
        {
          DepositReserveAsset: {
            assets: { Wild: { AllCounted: 1 } },
            dest: { parents: 1, interior: { X1: [{ Parachain: HYDRADX_PARA }] } },
            xcm: [
              {
                BuyExecution: {
                  fees: {
                    id: { parents: 1, interior: { Here: null } },
                    fun: { Fungible: feePlanck.toString() },
                  },
                  weight_limit: { Unlimited: "NULL" },
                },
              },
              {
                DepositAsset: {
                  assets: { Wild: { AllCounted: 1 } },
                  beneficiary: {
                    parents: 0,
                    interior: { X1: [{ AccountId32: { network: null, id: beneficiaryId } }] },
                  },
                },
              },
            ],
          },
        },
      ],
    };

    const maxWeight = { proof_size: 12638, ref_time: 1414876000 };

    setSubmitLog((s) => s + `Advanced DOT execute: amount=${amountPlanck.toString()} fee=${feePlanck.toString()}\n`);

    return api.tx.polkadotXcm.execute(message as any, maxWeight as any);
  }

  async function onSubmitReal() {
    setSubmitLog("");
    setSubmitting(true);

    try {
      // Advanced DOT execute has its own guardrails
      if (supportsDotExecute) {
        const { api } = await connectApiWithFallback(ASSET_HUB_RPCS, setSubmitLog, "rpc_assethub_last_ok");
        const tx = await makeTxDotExecute(api);

        setSubmitLog((s) => s + "Signing & submitting...\n");

        let dispatchLogged = false;
        const unsub = await tx.signAndSend(selectedAddress, (result) => {
          if (result.status.isFinalized) {
            setSubmitLog((s) => s + `🎉 Finalized: ${result.status.asFinalized.toString()}\n`);
            logFinalizedEvents(result, setSubmitLog);
            try { unsub(); } catch {}
            api.disconnect().catch(() => {});
            setSubmitting(false);
          } else {
            setSubmitLog((s) => s + `Status: ${result.status.type}\n`);
          }

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

        return;
      }

      if (!canPreview) throw new Error("Form is not safe/valid yet.");

      if (supportsAhToHydra) {
        const { api } = await connectApiWithFallback(ASSET_HUB_RPCS, setSubmitLog, "rpc_assethub_last_ok");
        const tx = await makeTxAhToHydra(api);

        setSubmitLog((s) => s + "Signing & submitting...\n");

        let dispatchLogged = false;
        const unsub = await tx.signAndSend(selectedAddress, (result) => {
          if (result.status.isFinalized) {
            setSubmitLog((s) => s + `🎉 Finalized: ${result.status.asFinalized.toString()}\n`);
            logFinalizedEvents(result, setSubmitLog);
            try { unsub(); } catch {}
            api.disconnect().catch(() => {});
            setSubmitting(false);
          } else {
            setSubmitLog((s) => s + `Status: ${result.status.type}\n`);
          }

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

        return;
      }

      if (supportsHydraToAh) {
        const { api } = await connectApiWithFallback(HYDRA_RPCS, setSubmitLog, "rpc_hydra_last_ok");
        const tx = await makeTxHydraToAh(api);

        setSubmitLog((s) => s + "Signing & submitting...\n");

        let dispatchLogged = false;
        const unsub = await tx.signAndSend(selectedAddress, (result) => {
          if (result.status.isFinalized) {
            setSubmitLog((s) => s + `🎉 Finalized: ${result.status.asFinalized.toString()}\n`);
            logFinalizedEvents(result, setSubmitLog);
            try { unsub(); } catch {}
            api.disconnect().catch(() => {});
            setSubmitting(false);
          } else {
            setSubmitLog((s) => s + `Status: ${result.status.type}\n`);
          }

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

        return;
      }

      throw new Error("Unsupported route/asset (safe-mode).");
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
        chain={guardedReq.from as ChainKey}
        onSelectedAddress={setSelectedAddress}
        onChainData={(d) => setWallet((prev) => ({ ...prev, ...d }))}
      />

      {/* Advanced DOT toggle */}
      <div style={{ marginTop: 14, border: "1px solid #eee", borderRadius: 12, padding: 12, background: "#fff" }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={dotExecuteEnabled}
            onChange={(e) => setDotExecuteEnabled(e.target.checked)}
          />
          <span><b>Advanced:</b> enable DOT Asset Hub → HydraDX via <code>polkadotXcm.execute</code></span>
        </label>
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>
          Experimental feature. Uses an explicit XCM message (execute). Range: {DOT_EXEC_MIN.toFixed(2)}–{DOT_EXEC_MAX.toFixed(2)} DOT.
        </div>
      </div>

      <SendForm
        value={guardedReq}
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
        warning={warning}
        modeLabel={modeLabel}
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

