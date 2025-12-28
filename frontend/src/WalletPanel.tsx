import { useEffect, useMemo, useState } from "react";
import { web3Accounts, web3Enable } from "@polkadot/extension-dapp";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { decodeAddress } from "@polkadot/util-crypto";

export type ChainKey = "assethub" | "hydradx";

const RPCS: Record<ChainKey, string[]> = {
  assethub: [
    "wss://asset-hub-polkadot-rpc.dwellir.com",
    "wss://polkadot-asset-hub-rpc.polkadot.io",
    "wss://rpc-asset-hub-polkadot.luckyfriday.io",
  ],
  hydradx: ["wss://rpc.hydradx.cloud", "wss://hydradx-rpc.dwellir.com"],
};

type UiAccount = { address: string; name?: string };

function fmtIntWithDecimals(v: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = (v / base).toString();
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

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

export type WalletChainData = {
  status: string;
  balanceDot?: string;
  edDot?: string;
};

export function WalletPanel(props: {
  chain: ChainKey;
  onChainData?: (d: WalletChainData) => void;
  onSelectedAddress?: (addr: string) => void;
}) {
  const { chain, onChainData, onSelectedAddress } = props;

  const [extEnabled, setExtEnabled] = useState(false);
  const [accounts, setAccounts] = useState<UiAccount[]>([]);
  const [selected, setSelected] = useState<string>("");

  const [status, setStatus] = useState<string>("Not connected");

  // Native token (DOT on Asset Hub, HDX on Hydra)
  const [nativeSymbol, setNativeSymbol] = useState<string>("NATIVE");
  const [nativeBal, setNativeBal] = useState<string>("-");
  const [nativeEd, setNativeEd] = useState<string>("-");

  // USDC display (chain-specific)
  const [usdcLabel, setUsdcLabel] = useState<string>("USDC");
  const [usdcBal, setUsdcBal] = useState<string>("-");

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.address === selected),
    [accounts, selected]
  );

  const setStatusN = (s: string) => {
    setStatus(s);
    onChainData?.({ status: s });
  };

  // 1) Enable wallet + load accounts
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setStatusN("Connecting to wallet extension...");
      try {
        const exts = await web3Enable("XCM CrossPay (Alpha)");
        if (cancelled) return;

        if (!exts || exts.length === 0) {
          setExtEnabled(false);
          setStatusN("No wallet extension authorized (or none installed).");
          return;
        }

        setExtEnabled(true);
        setStatusN("Loading accounts...");

        const accs = await web3Accounts();
        if (cancelled) return;

        const mapped: UiAccount[] = accs.map((a: any) => ({
          address: a.address,
          name: a.meta?.name as string | undefined,
        }));

        setAccounts(mapped);

        const first = mapped[0]?.address ?? "";
        setSelected(first);
        if (first) onSelectedAddress?.(first);

        setStatusN(mapped.length ? "Wallet ready" : "No accounts found");
      } catch (e: any) {
        setStatusN(`Wallet error: ${e?.message ?? String(e)}`);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep parent updated with selected address
  useEffect(() => {
    if (selected) onSelectedAddress?.(selected);
  }, [selected, onSelectedAddress]);

  // 2) Connect RPC + subscribe native + subscribe USDC
  useEffect(() => {
    let api: ApiPromise | null = null;

    let unsubNative: (() => void) | undefined;
    let unsubUsdc: (() => void) | undefined;

    let cancelled = false;

    async function connectAndSubscribe() {
      setNativeBal("-");
      setNativeEd("-");
      setUsdcBal("-");

      onChainData?.({ status: "Loading...", balanceDot: undefined, edDot: undefined });

      if (!selected) return;

      const rpcs = RPCS[chain];

      try {
        let connected = false;

        for (const url of rpcs) {
          try {
            setStatusN(`Connecting to ${chain} RPC: ${url}`);
            api = await withTimeout(
              ApiPromise.create({ provider: new WsProvider(url) }),
              8000
            );
            connected = true;
            break;
          } catch (e) {
            console.warn("RPC failed:", url, e);
          }
        }

        if (!connected || !api) {
          setStatusN("All RPC endpoints failed.");
          return;
        }

        if (cancelled) return;

        const decNative = (api.registry.chainDecimals?.[0] ?? 10) as number;
        const tokNative = (api.registry.chainTokens?.[0] ?? "NATIVE") as string;
        setNativeSymbol(tokNative);

        setStatusN("Connected. Reading balances...");

        // Native ED
        const edConst = api.consts.balances?.existentialDeposit?.toString?.();
        if (edConst) {
          const edInt = BigInt(edConst);
          const edFmt = fmtIntWithDecimals(edInt, decNative);
          setNativeEd(edFmt);
          onChainData?.({ status: "Connected. Reading balances...", edDot: edFmt });
        }

        // Native subscribe
        unsubNative = (await api.query.system.account(selected, (info: any) => {
          const free = BigInt(info.data.free.toString());
          const balFmt = fmtIntWithDecimals(free, decNative);
          setNativeBal(balFmt);
          onChainData?.({ status: "Live balance (read-only)", balanceDot: balFmt });
        })) as unknown as () => void;

        // USDC subscribe
        if (chain === "assethub") {
          // Asset Hub: pallet-assets USDC id 1337, SS58 works (proved)
          const USDC_ID_AH = 1337;

          const md: any = await api.query.assets.metadata(USDC_ID_AH);
          const dec = Number(md.decimals?.toString?.() ?? "6");
          const symHuman = md.symbol?.toHuman?.();
          const sym = typeof symHuman === "string" ? symHuman : "USDC";
          setUsdcLabel(`${sym} (Asset Hub)`);

          unsubUsdc = (await api.query.assets.account(USDC_ID_AH, selected, (accOpt: any) => {
            const h = accOpt.toHuman();
            if (h === null) {
              setUsdcBal("0");
              return;
            }
            const bal = BigInt(accOpt.unwrap().balance.toString());
            setUsdcBal(fmtIntWithDecimals(bal, dec));
          })) as unknown as () => void;
        } else {
          // Hydra/Hydration: ORML tokens + assetRegistry
          // We detected USDC assetId = 22 in assetRegistry.assets
          const USDC_ID_HYDRA = 22;

          const who = decodeAddress(selected);

          const a: any = await api.query.assetRegistry.assets(USDC_ID_HYDRA);
          const human = a.toHuman() as any;
          const dec = Number(human?.decimals ?? "6");
          const sym = String(human?.symbol ?? "USDC");
          setUsdcLabel(`${sym} (Hydra)`);

          unsubUsdc = (await api.query.tokens.accounts(who, USDC_ID_HYDRA, (acc: any) => {
            const free = BigInt(acc.free.toString());
            setUsdcBal(fmtIntWithDecimals(free, dec));
          })) as unknown as () => void;
        }

        setStatusN("Live balance (read-only)");
      } catch (e: any) {
        setStatusN(`RPC error: ${e?.message ?? String(e)}`);
      }
    }

    connectAndSubscribe();

    return () => {
      cancelled = true;
      try { if (unsubNative) unsubNative(); } catch {}
      try { if (unsubUsdc) unsubUsdc(); } catch {}
      try { api?.disconnect(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, selected]);

  const edHelp =
    chain === "assethub"
      ? "ED matters for keeping the account alive on Asset Hub. Keep a DOT buffer."
      : "ED is chain-specific and refers to the chain native token (shown above). Keep some for fees.";

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
      <h2 style={{ marginTop: 0 }}>Wallet (read-only)</h2>

      {!extEnabled && (
        <div style={{ marginBottom: 10, opacity: 0.8 }}>
          Install/enable a Polkadot wallet extension (polkadot{".js"}, Talisman, SubWallet, etc.) and
          authorize this site.
        </div>
      )}

      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Status</div>
      <div style={{ marginBottom: 12 }}>{status}</div>

      {accounts.length > 0 && (
        <>
          <label>
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Account</div>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8 }}
            >
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name ? `${a.name} — ${a.address}` : a.address}
                </option>
              ))}
            </select>
          </label>

          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            <div><b>Chain:</b> {chain}</div>
            <div><b>{nativeSymbol} (free):</b> {nativeBal}</div>
            <div><b>Existential Deposit (ED):</b> {nativeEd} <span style={{ opacity: 0.6 }}>(native)</span></div>
            <div><b>{usdcLabel}:</b> {usdcBal}</div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>{edHelp}</div>

          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>
            Selected: {selectedAccount?.name ?? "Account"} ({selected.slice(0, 10)}…)
          </div>
        </>
      )}
    </div>
  );
}

