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

  const [selectedAddress, setSelectedAddress] = useState<string>("");

  const [dryRun, setDryRun] = useState<XcmDryRun | undefined>(undefined);
  const [submitLog, setSubmitLog] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const errors = useMemo(() => validateRequest(req), [req]);

  // Phase 1: fixed network fee estimate (placeholder)
  const networkFeeDotEst = 0.012;

  const amt = Number(req.amount || "0");
  const amtNum = Number.isFinite(amt) ? amt : 0;

  const amountForServiceFeeDot = req.asset === "DOT" ? amtNum : 0;

  const feeQuote = useMemo(() => {
    const q = quoteFeesDot(
      amountForServiceFeeDot,
      networkFeeDotEst,
      DEFAULT_SERVICE_FEE
    );
    if (req.asset !== "DOT") {
      q.notes = [...q.notes, "USDC transfer: service fee is min-clamped (Phase 1)."];
    }
    return q;
  }, [req.asset, amountForServiceFeeDot]);

  const bal = Number(wallet.balanceDot ?? "NaN");
  const ed = Number(wallet.edDot ?? "NaN");
  const feeTotal = Number(feeQuote.totalFeeDot);

  const hasWalletNums =
    Number.isFinite(bal) && Number.isFinite(ed) && Number.isFinite(feeTotal);

  const requiredDot = req.asset === "DOT" ? amtNum + feeTotal : feeTotal;
  const remaining = hasWalletNums ? bal - requiredDot : NaN;
  const safe = hasWalletNums ? remaining >= ed : false;

  const safetyMsg = !hasWalletNums
    ? "Wallet data not ready yet."
    : safe
    ? `OK: remaining ≈ ${remaining.toFixed(6)} DOT (ED ${ed}).`
    : `Too much: would leave ≈ ${remaining.toFixed(6)} DOT (below ED ${ed}).`;

  const canDryRun = errors.length === 0 && safe;

  const supportsRealSubmit =
    req.from === "assethub" &&
    req.to === "hydradx" &&
    req.asset === "DOT" &&
    selectedAddress.length > 0 &&
    amtNum > 0;

  const canSubmitReal = canDryRun && supportsRealSubmit && !submitting;

  const handleDryRun = () => {
    setDryRun(buildXcmDryRun(req, feeQuote));
  };

  // =========================
  // REAL SUBMIT (XCM V3)
  // =========================
  async function submitReal_AssethubToHydraDot() {
    setSubmitLog("");
    setSubmitting(true);

    try {
      if (!supportsRealSubmit) {
        throw new Error("Real submit supports only: DOT Asset Hub → HydraDX.");
      }
      if (!canDryRun) {
        throw new Error("Form is not safe/valid yet.");
      }

      const RPCS = [
        "wss://asset-hub-polkadot-rpc.dwellir.com",
        "wss://polkadot-asset-hub-rpc.polkadot.io",
        "wss://rpc-asset-hub-polkadot.luckyfriday.io",
        "wss://asset-hub-polkadot-rpc.dwellir.com/ws",
        "wss://polkadot-asset-hub-rpc.polkadot.io/ws",
      ];

      setSubmitLog((s) => s + "Connecting to Asset Hub RPC (fallback mode)\n");

      let api: ApiPromise | null = null;
      let lastErr: any = null;

      for (const rpc of RPCS) {
        try {
          setSubmitLog((s) => s + `→ Trying: ${rpc}\n`);
          api = await withTimeout(
            ApiPromise.create({ provider: new WsProvider(rpc) }),
            8000
          );
          setSubmitLog((s) => s + `✅ Connected: ${rpc}\n`);
          break;
        } catch (e: any) {
          lastErr = e;
          setSubmitLog((s) => s + `✗ Failed: ${rpc} (${e?.message ?? String(e)})\n`);
        }
      }

      if (!api) {
        throw new Error(
          `All Asset Hub RPC endpoints failed. Last error: ${lastErr?.message ?? String(lastErr)}`
        );
      }

      const injector = await web3FromAddress(selectedAddress);
      api.setSigner(injector.signer);

      const HYDRADX_PARA = 2034;

      const dest = {
        V3: {
          parents: 1,
          interior: { X1: { Parachain: HYDRADX_PARA } },
        },
      };

      const id = decodeAddress(selectedAddress);
      const beneficiary = {
        V3: {
          parents: 0,
          interior: {
            X1: {
              AccountId32: { network: null, id },
            },
          },
        },
      };

      const amountPlanck = BigInt(Math.floor(amtNum * 10 ** 10));
      if (amountPlanck <= 0n) throw new Error("Amount too small.");

      const assets = {
        V3: [
          {
            id: {
              Concrete: {
                parents: 0,
                interior: "Here",
              },
            },
            fun: {
              Fungible: amountPlanck.toString(),
            },
          },
        ],
      };

      const feeAssetItem = 0;
      const weightLimit = { Unlimited: null };

      const tx = api.tx.polkadotXcm.limitedReserveTransferAssets(
        dest as any,
        beneficiary as any,
        assets as any,
        feeAssetItem,
        weightLimit as any
      );

      setSubmitLog((s) => s + "Signing & submitting...\n");

      const unsub = await tx.signAndSend(selectedAddress, (result) => {
        if (result.status.isInBlock) {
          setSubmitLog((s) => s + `✅ In block: ${result.status.asInBlock.toString()}\n`);
        } else if (result.status.isFinalized) {
          setSubmitLog((s) => s + `🎉 Finalized: ${result.status.asFinalized.toString()}\n`);
          unsub();
          api?.disconnect().catch(() => {});
          setSubmitting(false);
        } else {
          setSubmitLog((s) => s + `Status: ${result.status.type}\n`);
        }

        if (result.dispatchError) {
          let errMsg = result.dispatchError.toString();
          if (result.dispatchError.isModule) {
            const decoded = api!.registry.findMetaError(
              result.dispatchError.asModule
            );
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
        canSend={canDryRun}
        onDryRun={handleDryRun}
        dryRun={dryRun}
        canSubmitReal={canSubmitReal}
        onSubmitReal={submitReal_AssethubToHydraDot}
        submitHelp={
          supportsRealSubmit
            ? "Real submit enabled for DOT Asset Hub → HydraDX."
            : "Real submit supports only: DOT Asset Hub → HydraDX."
        }
      />

      {submitLog && (
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

