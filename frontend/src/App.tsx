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
  const [submitting, setSubmitting] = useState<boolean>(false);

  const errors = useMemo(() => validateRequest(req), [req]);

  // Placeholder Phase 1: network fee estimate fixed (later: real estimation)
  const networkFeeDotEst = 0.012;

  const amt = Number(req.amount || "0");
  const amtNum = Number.isFinite(amt) ? amt : 0;

  // Service fee base:
  // - DOT send: proportional
  // - USDC send: min clamp (Phase 1 simplification)
  const amountForServiceFeeDot = req.asset === "DOT" ? amtNum : 0;

  const feeQuote = useMemo(() => {
    const q = quoteFeesDot(
      amountForServiceFeeDot,
      networkFeeDotEst,
      DEFAULT_SERVICE_FEE
    );
    if (req.asset !== "DOT") {
      q.notes = [
        ...q.notes,
        "USDC transfer: service fee is currently min-clamped (Phase 1).",
      ];
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
  // - DOT: amount + fees
  // - USDC: fees only (still must keep ED)
  const requiredDot = req.asset === "DOT" ? amtNum + feeTotal : feeTotal;

  const remaining = hasWalletNums ? bal - requiredDot : NaN;
  const safe = hasWalletNums ? remaining >= ed : false;

  const safetyMsg = !hasWalletNums
    ? "Wallet data not ready yet."
    : safe
    ? `OK: remaining ≈ ${remaining.toFixed(6)} DOT (ED ${ed}).`
    : `Too much: would leave ≈ ${remaining.toFixed(6)} DOT (below ED ${ed}).`;

  const canDryRun = errors.length === 0 && safe;

  // Only support first real submit case:
  const supportsRealSubmit =
    req.from === "assethub" &&
    req.to === "hydradx" &&
    req.asset === "DOT" &&
    selectedAddress.length > 0 &&
    amtNum > 0;

  const canSubmitReal = canDryRun && supportsRealSubmit && !submitting;

  const handleDryRun = () => {
    const preview = buildXcmDryRun(req, feeQuote);
    setDryRun(preview);
  };

  // --- REAL SUBMIT (Asset Hub -> HydraDX, DOT) ---
  async function submitReal_AssethubToHydraDot() {
    setSubmitLog("");
    setSubmitting(true);

    try {
      // Defensive re-check
      if (!supportsRealSubmit) {
        throw new Error(
          "Real submit currently supports only: from=assethub, to=hydradx, asset=DOT."
        );
      }
      if (!canDryRun) {
        throw new Error("Form is not safe/valid yet.");
      }

      // Connect to Asset Hub RPC (same as WalletPanel list; keep it simple here)
      const rpc = "wss://asset-hub-polkadot-rpc.dwellir.com";
      setSubmitLog(`Connecting RPC: ${rpc}\n`);

      const api = await ApiPromise.create({ provider: new WsProvider(rpc) });

      // Inject signer from extension
      const injector = await web3FromAddress(selectedAddress);
      api.setSigner(injector.signer);

      // HydraDX paraId on Polkadot
      const HYDRADX_PARA = 2034;

      // Build destination multilocation:
      // From Asset Hub (parachain) to another parachain -> parents: 1, X1 Parachain
      const dest = api.createType("XcmVersionedMultiLocation", {
        V3: { parents: 1, interior: { X1: { Parachain: HYDRADX_PARA } } },
      });

      // Beneficiary: AccountId32 on destination
      const id = decodeAddress(selectedAddress); // Uint8Array(32)
      const beneficiary = api.createType("XcmVersionedMultiLocation", {
        V3: {
          parents: 0,
          interior: {
            X1: { AccountId32: { network: null, id } },
          },
        },
      });

      // Assets: DOT is relay-chain native asset, represented as parents:1, interior:Here
      // Amount must be in plancks (DOT has 10 decimals)
      const amountPlanck = BigInt(Math.floor(amtNum * 10 ** 10));
      if (amountPlanck <= 0n) throw new Error("Amount too small.");

      const assets = api.createType("XcmVersionedMultiAssets", {
        V3: [
          {
            id: { Concrete: { parents: 1, interior: "Here" } },
            fun: { Fungible: amountPlanck.toString() },
          },
        ],
      });

      const feeAssetItem = 0;
      const weightLimit = api.createType("XcmV3WeightLimit", "Unlimited");

      // Build call
      const tx = api.tx.polkadotXcm.limitedReserveTransferAssets(
        dest,
        beneficiary,
        assets,
        feeAssetItem,
        weightLimit
      );

      setSubmitLog((s) => s + `Signing & submitting...\n`);

      const unsub = await tx.signAndSend(selectedAddress, (result) => {
        if (result.status.isInBlock) {
          setSubmitLog(
            (s) =>
              s +
              `✅ In block: ${result.status.asInBlock.toString()}\n` +
              `Events: ${result.events.length}\n`
          );
        } else if (result.status.isFinalized) {
          setSubmitLog(
            (s) =>
              s +
              `🎉 Finalized: ${result.status.asFinalized.toString()}\n`
          );
          unsub();
          api.disconnect().catch(() => {});
          setSubmitting(false);
        } else {
          setSubmitLog((s) => s + `Status: ${result.status.type}\n`);
        }

        if (result.dispatchError) {
          let errMsg = result.dispatchError.toString();
          // If it's a module error, decode it
          if (result.dispatchError.isModule) {
            const decoded = api.registry.findMetaError(
              result.dispatchError.asModule
            );
            errMsg = `${decoded.section}.${decoded.name}: ${decoded.docs.join(
              " "
            )}`;
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
          Non-custodial XCM transfers across Polkadot chains — simple, defensive
          flows.
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
        // Real submit controls
        canSubmitReal={canSubmitReal}
        onSubmitReal={submitReal_AssethubToHydraDot}
        submitHelp={
          supportsRealSubmit
            ? "Real submit enabled for DOT Asset Hub → HydraDX."
            : "Real submit currently supports only: DOT Asset Hub → HydraDX."
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

