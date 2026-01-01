import { useEffect, useMemo, useState } from "react";
import "./App.css";

import { guardRoute } from "../../xcm-engine/guard";

import { WalletPanel } from "./WalletPanel";
import type { WalletChainData } from "./WalletPanel";
import { SendForm } from "./SendForm";

import type { TransferRequest, FeeQuote } from "../../xcm-engine/types";
import { validateRequest } from "../../xcm-engine/validate";
import { quoteFeesDot, DEFAULT_SERVICE_FEE } from "../../xcm-engine/fees";
import { buildXcmDryRun } from "../../xcm-engine/dryRun";
import type { XcmDryRun } from "../../xcm-engine/dryRun";

import { ApiPromise, WsProvider } from "@polkadot/api";
import { web3FromAddress } from "@polkadot/extension-dapp";
import { decodeAddress } from "@polkadot/util-crypto";

const DOT_DECIMALS = 10;

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

function fmtPlanckToDot(planck: bigint): string {
  const s = planck.toString().padStart(DOT_DECIMALS + 1, "0");
  const whole = s.slice(0, -DOT_DECIMALS);
  const frac = s.slice(-DOT_DECIMALS).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
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

  throw new Error(
    `All RPC endpoints failed. Last error: ${lastErr?.message ?? String(lastErr)}`
  );
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
        try {
          payload = JSON.stringify(event.toHuman(), null, 2);
        } catch {
          payload = event.toString();
        }
        lines.push(`*** polkadotXcm.Attempted ***\n${payload}`);
      } else if (
        sec === "polkadotXcm" ||
        sec === "xcmpQueue" ||
        sec === "messageQueue" ||
        sec === "dmpQueue" ||
        sec === "balances" ||
        sec === "assets" ||
        sec === "tokens" ||
        sec === "system" ||
        sec === "xcmPallet"
      ) {
        let payload = "";
        try {
          payload = JSON.stringify(event.toHuman());
        } catch {
          payload = event.toString();
        }
        if (sec === "system" && met !== "ExtrinsicSuccess" && met !== "ExtrinsicFailed") continue;
        lines.push(`${sec}.${met}: ${payload}`);
      }
    }

    if (lines.length) {
      setLog(
        (s) =>
          s +
          `\n--- EVENTS (finalized) ---\n${lines.join("\n")}\n--- END EVENTS ---\n`
      );
    }
  } catch {}
}

type RelayProbe = {
  free: bigint;
  ed: bigint;
  ok: boolean;
  lastUpdatedMs: number;
};

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

  const [relayProbe, setRelayProbe] = useState<RelayProbe | null>(null);

  const guardedReq = useMemo<TransferRequest>(() => {
    if (req.from !== req.to) return req;
    const nextTo: TransferRequest["to"] =
      req.from === "assethub" ? "hydradx" : "assethub";
    return { ...req, to: nextTo };
  }, [req]);

  const errors = useMemo(() => validateRequest(guardedReq), [guardedReq]);

  const isRelayMode = guardedReq.from === "relay" || guardedReq.to === "relay";
  const isAhToRelayDot =
    guardedReq.from === "assethub" &&
    guardedReq.to === "relay" &&
    guardedReq.asset === "DOT";

  // Fee quote: relay mode is on-chain, hide service fee and fake estimates
  const networkFeeDotEst = 0.012;
  const feeQuote = useMemo<FeeQuote>(() => {
    if (isRelayMode) {
      return {
        networkFeeDotEst: "-",
        serviceFeeDot: "-",
        totalFeeDot: "-",
        notes: [
          "Relay mode: fees are paid on-chain.",
          "Small teleports may be largely consumed by execution costs.",
        ],
      };
    }
    if (!serviceFeeEnabled) return makeFeeQuoteNoService(networkFeeDotEst);
    const q = quoteFeesDot(0, networkFeeDotEst, DEFAULT_SERVICE_FEE);
    q.notes = [...q.notes, "Service fee toggle is informational (not collected on-chain)."];
    return q;
  }, [isRelayMode, serviceFeeEnabled]);

  // ---- AssetKey -> Guard Asset mapping ----
  const guardAsset =
    guardedReq.asset === "USDC_AH" || guardedReq.asset === "USDC_HYDRA"
      ? "USDC"
      : guardedReq.asset === "USDT_AH" || guardedReq.asset === "USDT_HYDRA"
      ? "USDT"
      : "DOT";

  const guard = guardRoute({
    from: guardedReq.from as any,
    to: guardedReq.to as any,
    asset: guardAsset as any,
    amount: Number(guardedReq.amount || "0"),

    // Relay bootstrap inputs (dynamic)
    relayFreeDot: relayProbe ? Number(fmtPlanckToDot(relayProbe.free)) : undefined,
    relayEDDot: relayProbe ? Number(fmtPlanckToDot(relayProbe.ed)) : undefined,
  });

  // Safety message (walletPanel is AH/Hydra only; relay is special)
  const safetyMsg = isRelayMode
    ? "Relay note: fees are on-chain. If your Relay account is below ED, small teleports may result in near-zero net received."
    : !Number.isFinite(Number(wallet.balanceDot ?? "NaN")) ||
      !Number.isFinite(Number(wallet.edDot ?? "NaN"))
    ? "Wallet data not ready yet."
    : `OK: keep a native buffer above ED (${wallet.edDot}).`;

  // Relay note for UI (shows free/ED and minRequired from guard, if any)
  const relayNote = useMemo(() => {
    if (!isAhToRelayDot) return undefined;

    if (!relayProbe) return "Reading Relay balance/ED…";

    const free = fmtPlanckToDot(relayProbe.free);
    const ed = fmtPlanckToDot(relayProbe.ed);

    if (typeof guard.minRequired === "number") {
      return `Relay free ≈ ${free} DOT (ED ≈ ${ed}). Relay is below ED: minimum required now ≈ ${guard.minRequired.toFixed(
        4
      )} DOT.`;
    }

    return `Relay free ≈ ${free} DOT (ED ≈ ${ed}). Account is above ED.`;
  }, [isAhToRelayDot, relayProbe, guard.minRequired]);

  const warning = !guard.ok ? guard.reason : undefined;
  const canPreview = errors.length === 0 && guard.ok;

  // Supported routes
  const supportsAhToHydraStable =
    guardedReq.from === "assethub" &&
    guardedReq.to === "hydradx" &&
    (guardedReq.asset === "USDC_AH" || guardedReq.asset === "USDT_AH") &&
    selectedAddress.length > 0;

  const supportsHydraToAhStable =
    guardedReq.from === "hydradx" &&
    guardedReq.to === "assethub" &&
    (guardedReq.asset === "USDC_HYDRA" || guardedReq.asset === "USDT_HYDRA") &&
    selectedAddress.length > 0;

  const supportsAhToRelayDot =
    guardedReq.from === "assethub" &&
    guardedReq.to === "relay" &&
    guardedReq.asset === "DOT" &&
    selectedAddress.length > 0;

  const supportsRelayToAhDot =
    guardedReq.from === "relay" &&
    guardedReq.to === "assethub" &&
    guardedReq.asset === "DOT" &&
    selectedAddress.length > 0;

  const canSubmitReal =
    !submitting &&
    errors.length === 0 &&
    guard.ok &&
    (supportsAhToHydraStable ||
      supportsHydraToAhStable ||
      supportsAhToRelayDot ||
      supportsRelayToAhDot);

  const modeLabel =
    supportsAhToRelayDot
      ? "Asset Hub → Relay (DOT teleport)"
      : supportsRelayToAhDot
      ? "Relay → Asset Hub (DOT teleport)"
      : guardedReq.from === "assethub"
      ? "Asset Hub → HydraDX (reserve transfer)"
      : guardedReq.from === "hydradx"
      ? "HydraDX → Asset Hub (reserve transfer)"
      : "Mode";

  const submitHelp =
    supportsAhToHydraStable
      ? "Real submit: stablecoin Asset Hub → HydraDX."
      : supportsHydraToAhStable
      ? "Real submit: stablecoin HydraDX → Asset Hub."
      : supportsAhToRelayDot
      ? "Real submit: DOT teleport Asset Hub → Relay."
      : supportsRelayToAhDot
      ? "Real submit: DOT teleport Relay → Asset Hub (requires DOT spendable on Relay for fees)."
      : "Unsupported route/asset.";

  const onDryRun = () => setDryRun(buildXcmDryRun(guardedReq, feeQuote));

  // RPC lists
  const ASSET_HUB_RPCS = [
    "wss://polkadot-asset-hub-rpc.polkadot.io",
    "wss://rpc-asset-hub-polkadot.luckyfriday.io",
    "wss://polkadot-asset-hub-rpc.polkadot.io/ws",
    "wss://asset-hub-polkadot-rpc.dwellir.com",
    "wss://asset-hub-polkadot-rpc.dwellir.com/ws",
  ];

  const HYDRA_RPCS = ["wss://rpc.hydradx.cloud", "wss://hydradx-rpc.dwellir.com"];

  const RELAY_RPCS = ["wss://rpc.polkadot.io", "wss://polkadot-rpc.dwellir.com"];

  // Relay probe: read relay free + ED when needed
  useEffect(() => {
    let cancelled = false;
    let api: ApiPromise | null = null;

    async function run() {
      if (!selectedAddress) return;

      const needRelayProbe = isAhToRelayDot || guardedReq.from === "relay";
      if (!needRelayProbe) return;

      try {
        const { api: relayApi } = await connectApiWithFallback(
          RELAY_RPCS,
          () => {},
          "rpc_relay_last_ok"
        );
        api = relayApi;

        const edStr =
          api.consts.balances?.existentialDeposit?.toString?.() ?? "0";
        const ed = BigInt(edStr);

        const info: any = await api.query.system.account(selectedAddress);
        const free = BigInt(info.data.free.toString());

        if (cancelled) return;

        setRelayProbe({
          free,
          ed,
          ok: true,
          lastUpdatedMs: Date.now(),
        });
      } catch {
        if (cancelled) return;
        setRelayProbe(null);
      } finally {
        try {
          api?.disconnect();
        } catch {}
      }
    }

    run();
    return () => {
      cancelled = true;
      try {
        api?.disconnect();
      } catch {}
    };
  }, [selectedAddress, isAhToRelayDot, guardedReq.from]);

  async function makeTxAhToHydra(api: ApiPromise) {
    const injector = await web3FromAddress(selectedAddress);
    api.setSigner(injector.signer);

    const HYDRADX_PARA = 2034;
    const dest = {
      V3: { parents: 1, interior: { X1: { Parachain: HYDRADX_PARA } } },
    };

    const id = decodeAddress(selectedAddress);
    const beneficiary = {
      V3: { parents: 0, interior: { X1: { AccountId32: { network: null, id } } } },
    };

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
          id: {
            Concrete: {
              parents: 0,
              interior: { X2: [{ PalletInstance: 50 }, { GeneralIndex: String(assetId) }] },
            },
          },
        },
      ],
    };

    return api.tx.polkadotXcm.limitedReserveTransferAssets(
      dest as any,
      beneficiary as any,
      assets as any,
      0,
      { Unlimited: null } as any
    );
  }

  async function makeTxHydraToAh(api: ApiPromise) {
    const injector = await web3FromAddress(selectedAddress);
    api.setSigner(injector.signer);

    const ASSET_HUB_PARA = 1000;
    const dest = {
      V3: { parents: 1, interior: { X1: { Parachain: ASSET_HUB_PARA } } },
    };

    const id = decodeAddress(selectedAddress);
    const beneficiary = {
      V3: { parents: 0, interior: { X1: { AccountId32: { network: null, id } } } },
    };

    const generalIndex = guardedReq.asset === "USDC_HYDRA" ? "1337" : "1984";
    const hydraAssetId = guardedReq.asset === "USDC_HYDRA" ? 22 : 10;

    const a: any = await api.query.assetRegistry.assets(hydraAssetId);
    const human = a.toHuman() as any;
    const decimals: number = Number(human?.decimals ?? "6");
    const symbol: string = String(human?.symbol ?? "USDT");

    setSubmitLog((s) => s + `Asset (Hydra): ${symbol} (assetId ${hydraAssetId}, decimals ${decimals})\n`);
    setSubmitLog((s) => s + `Reserve: parents=1, X3[Parachain 1000, PalletInstance 50, GeneralIndex ${generalIndex}]\n`);

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

    return api.tx.polkadotXcm.limitedReserveTransferAssets(
      dest as any,
      beneficiary as any,
      assets as any,
      0,
      { Unlimited: null } as any
    );
  }

  async function makeTxAhToRelayTeleport(api: ApiPromise) {
    const injector = await web3FromAddress(selectedAddress);
    api.setSigner(injector.signer);

    const dest = { V4: { parents: "1", interior: "Here" } }; // Relay

    const id = decodeAddress(selectedAddress);
    const beneficiary = {
      V4: {
        parents: "0",
        interior: { X1: [{ AccountId32: { network: null, id } }] },
      },
    };

    const amountInt = parseDecimalToInt(guardedReq.amount, DOT_DECIMALS);

    const assets = {
      V4: [
        {
          id: { parents: "1", interior: "Here" },
          fun: { Fungible: amountInt.toString() },
        },
      ],
    };

    return api.tx.polkadotXcm.limitedTeleportAssets(
      dest as any,
      beneficiary as any,
      assets as any,
      "0" as any,
      "Unlimited" as any
    );
  }

  async function makeTxRelayToAhTeleport(api: ApiPromise) {
    const injector = await web3FromAddress(selectedAddress);
    api.setSigner(injector.signer);

    const pallet =
      (api.tx as any).xcmPallet?.limitedTeleportAssets
        ? "xcmPallet"
        : (api.tx as any).polkadotXcm?.limitedTeleportAssets
        ? "polkadotXcm"
        : null;

    if (!pallet) {
      throw new Error("Relay runtime does not expose limitedTeleportAssets (xcmPallet/polkadotXcm).");
    }

    const dest = {
      V4: { parents: 0, interior: { X1: [{ Parachain: 1000 }] } }, // Asset Hub
    };

    const id = decodeAddress(selectedAddress);
    const beneficiary = {
      V4: { parents: 0, interior: { X1: [{ AccountId32: { network: null, id } }] } },
    };

    const amountInt = parseDecimalToInt(guardedReq.amount, DOT_DECIMALS);

    const assets = {
      V4: [
        {
          id: { parents: 0, interior: "Here" }, // DOT on relay
          fun: { Fungible: amountInt.toString() },
        },
      ],
    };

    const feeAssetItem = 0;
    const weightLimit = "Unlimited";

    if (pallet === "xcmPallet") {
      return (api.tx as any).xcmPallet.limitedTeleportAssets(
        dest as any,
        beneficiary as any,
        assets as any,
        feeAssetItem,
        weightLimit as any
      );
    }
    return (api.tx as any).polkadotXcm.limitedTeleportAssets(
      dest as any,
      beneficiary as any,
      assets as any,
      feeAssetItem,
      weightLimit as any
    );
  }

  async function onSubmitReal() {
    setSubmitLog("");
    setSubmitting(true);

    try {
      if (!canPreview) throw new Error("Form is not safe/valid yet.");

      if (supportsAhToHydraStable) {
        const { api } = await connectApiWithFallback(ASSET_HUB_RPCS, setSubmitLog, "rpc_assethub_last_ok");
        const tx = await makeTxAhToHydra(api);
        setSubmitLog((s) => s + "Signing & submitting...\n");

        let dispatchLogged = false;
        const unsub = await tx.signAndSend(selectedAddress, (result: any) => {
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

      if (supportsHydraToAhStable) {
        const { api } = await connectApiWithFallback(HYDRA_RPCS, setSubmitLog, "rpc_hydra_last_ok");
        const tx = await makeTxHydraToAh(api);
        setSubmitLog((s) => s + "Signing & submitting...\n");

        let dispatchLogged = false;
        const unsub = await tx.signAndSend(selectedAddress, (result: any) => {
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

      if (supportsAhToRelayDot) {
        const { api } = await connectApiWithFallback(ASSET_HUB_RPCS, setSubmitLog, "rpc_assethub_last_ok");
        const tx = await makeTxAhToRelayTeleport(api);
        setSubmitLog((s) => s + "Signing & submitting...\n");

        let dispatchLogged = false;
        const unsub = await tx.signAndSend(selectedAddress, (result: any) => {
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

      if (supportsRelayToAhDot) {
        const { api } = await connectApiWithFallback(RELAY_RPCS, setSubmitLog, "rpc_relay_last_ok");
        const tx = await makeTxRelayToAhTeleport(api);
        setSubmitLog((s) => s + "Signing & submitting...\n");

        let dispatchLogged = false;
        const unsub = await tx.signAndSend(selectedAddress, (result: any) => {
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

      throw new Error("Unsupported route/asset.");
    } catch (e: any) {
      setSubmitLog((s) => s + `❌ Error: ${e?.message ?? String(e)}\n`);
      setSubmitting(false);
    }
  }

  // WalletPanel doesn't support relay yet: show AssetHub panel when relay selected (temporary)
  const walletChainForPanel = (guardedReq.from === "relay" ? "assethub" : guardedReq.from) as any;

  return (
    <div style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>XCM CrossPay</h1>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Non-custodial XCM transfers across Polkadot chains — simple, defensive flows.
        </p>
      </header>

      <WalletPanel
        chain={walletChainForPanel}
        onSelectedAddress={setSelectedAddress}
        onChainData={(d) => setWallet((prev) => ({ ...prev, ...d }))}
      />

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
        advancedDotEnabled={false}
        relayNote={relayNote}
        hideServiceFee={isRelayMode}
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


