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

// Parse decimal string to integer (BigInt) with given decimals, NO float.
// Examples: ("1.23", 6) => 1230000n
function parseDecimalToInt(amount: string, decimals: number): bigint {
  const s = (amount ?? "").trim();
  if (!s) return 0n;

  // allow "1", "1.", ".5", "0.5"
  const m = s.match(/^(\d*)\.?(\d*)$/);
  if (!m) return 0n;

  const wholeStr = m[1] || "0";
  const fracStrRaw = m[2] || "";

  const fracStr = fracStrRaw.slice(0, decimals).padEnd(decimals, "0");

  const whole = BigInt(wholeStr || "0");
  const frac = BigInt(fracStr || "0");

  const base = 10n ** BigInt(decimals);
  return whole * base + frac;
}

export default function App() {
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? "dev";

  const [req, setReq] = useState<TransferRequest>({
    from: "assethub",
    to: "hydradx",
    asset: "USDC_AH", // default to USDC for this phase
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

  // Placeholder fee estimate in DOT (later: real estimation)
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
    if (req.asset === "USDC_AH") {
      q.notes = [...q.notes, "USDC transfer: service fee is min-clamped (Phase 1)."];
    }
    return q;
  }, [req.asset, amountForServiceFeeDot]);

  // Wallet safety check (ED) - based on DOT balance on the FROM chain
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

  // ---- REAL SUBMIT SCOPE (now): USDC Asset Hub -> HydraDX ----
  const supportsRealSubmit =
    req.from === "assethub" &&
    req.to === "hydradx" &&
    req.asset === "USDC_AH" &&
    selectedAddress.length > 0 &&
    (req.amount ?? "").trim().length > 0;

  const canSubmitReal = canDryRun && supportsRealSubmit && !submitting;

  const handleDryRun = () => {
    setDryRun(buildXcmDryRun(req, feeQuote));
  };

  async function submitReal_AssethubToHydra_USDC() {
    setSubmitLog("");
    setSubmitting(true);

    try {
      if (!supportsRealSubmit) {
        throw new Error("Real submit currently supports: USDC (Asset Hub) → HydraDX.");
      }
      if (!canDryRun) {
        throw new Error("Form is not safe/valid yet.");
      }

      // 5 RPC endpoints + timeout + logs
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

      // signer injection
      const injector = await web3FromAddress(selectedAddress);
      api.setSigner(injector.signer);

      const HYDRADX_PARA = 2034;

      // dest: parachain HydraDX (parents: 1 from Asset Hub)
      const dest = {
        V3: {
          parents: 1,
          interior: { X1: { Parachain: HYDRADX_PARA } },
        },
      };

      // beneficiary: AccountId32 on destination
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

      // USDC on Asset Hub: PalletInstance 50 (Assets) + GeneralIndex 1337
      const USDC_ASSET_ID = 1337;

      // Read decimals from chain metadata to convert amount safely
      const md: any = await api.query.assets.metadata(USDC_ASSET_ID);
      const decimals: number = Number(md.decimals?.toString?.() ?? "6");
      const symbol: string = String(md.symbol?.toHuman?.() ?? "USDC");

      setSubmitLog((s) => s + `Asset: ${symbol} (id ${USDC_ASSET_ID}, decimals ${decimals})\n`);

      const amountInt = parseDecimalToInt(req.amount, decimals);
      if (amountInt <= 0n) throw new Error("Amount too small (after decimals).");

      // assets: VersionedAssets V3 with PalletInstance 50 / GeneralIndex 1337 (same as on-chain accepted tx)
const assets = {
  V3: [
    {
      fun: { Fungible: amountInt.toString() },
      id: {
        Concrete: {
          parents: 0,
          interior: {
            X2: [
              { PalletInstance: 50 },
              { GeneralIndex: String(USDC_ASSET_ID) },
            ],
          },
        },
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

      let dispatchLogged = false;

      const unsub = await tx.signAndSend(selectedAddress, (result) => {
        if (result.status.isInBlock) {
          setSubmitLog((s) => s + `✅ In block: ${result.status.asInBlock.toString()}\n`);
        } else if (result.status.isFinalized) {
          setSubmitLog((s) => s + `🎉 Finalized: ${result.status.asFinalized.toString()}\n`);
          try { unsub(); } catch {}
          api?.disconnect().catch(() => {});
          setSubmitting(false);
        } else {
          setSubmitLog((s) => s + `Status: ${result.status.type}\n`);
        }

        // --- EVENTS DEBUG (robust) ---
        try {
          const lines: string[] = [];

          for (const { event } of result.events) {
            const sec = event.section;
            const met = event.method;

            if (sec === "polkadotXcm" && met === "Attempted") {
              let payload = "";
              try {
                payload = JSON.stringify(event.toHuman(), null, 2);
              } catch {
                payload = event.toString();
              }
              lines.push(`*** polkadotXcm.Attempted ***\n${payload}`);
              continue;
            }

            if (
              sec === "polkadotXcm" ||
              sec === "xcmPallet" ||
              sec === "xcmpQueue" ||
              sec === "messageQueue" ||
              sec === "balances" ||
              sec === "assets" ||
              sec === "system"
            ) {
              let payload = "";
              try {
                payload = JSON.stringify(event.toHuman());
              } catch {
                payload = event.toString();
              }
              lines.push(`${sec}.${met}: ${payload}`);
            }
          }

          if (lines.length > 0) {
            setSubmitLog((s) => s + `\n--- EVENTS (debug) ---\n` + lines.join("\n") + `\n--- END EVENTS ---\n`);
          }
        } catch (e: any) {
          setSubmitLog((s) => s + `\n(event log error: ${e?.message ?? String(e)})\n`);
        }

        if (result.dispatchError && !dispatchLogged) {
          dispatchLogged = true;
          let errMsg = result.dispatchError.toString();
          if (result.dispatchError.isModule) {
            const decoded = api!.registry.findMetaError(result.dispatchError.asModule);
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
        onSubmitReal={submitReal_AssethubToHydra_USDC}
        submitHelp={
          supportsRealSubmit
            ? "Real submit enabled for USDC (Asset Hub) → HydraDX."
            : "Real submit supports only: USDC (Asset Hub) → HydraDX."
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

