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
  balanceDot?: string; // (legacy name) actually "native balance" for selected chain
  edDot?: string;      // (legacy name) actually "native ED" for selected chain
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

  // Native token info (DOT on Asset Hub, HDX on Hydra, etc.)
  const [nativeSymbol, setNativeSymbol] = useState<string>("NATIVE");
  const [nativeDecimals, setNativeDecimals] = useState<number>(10);
  const [nativeBal, setNativeBal] = useState<string>("-");
  const [nativeEd, setNativeEd] = useState<string>("-");

  // Asset Hub USDC (assetId 1337)
  const [usdcLabel, setUsdcLabel] = useState<string>("USDC (Asset Hub)");
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

  // 2) Connect RPC + subscribe balances
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
            api = await withTimeout(ApiPromise.create({ provider: new WsProvider(url) }), 8000);
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

        // Native chain token + decimals (truth source)
        const dec = (api.registry.chainDecimals?.[0] ?? 10) as number;
        const tok = (api.registry.chainTokens?.[0] ?? "NATIVE") as string;
        setNativeDecimals(dec);
        setNativeSymbol(tok);

        setStatusN("Connected. Reading balances...");

        // Native ED (balances pallet) formatted with chain decimals
        const edConst = api.consts.balances?.existentialDeposit?.toString?.();
        if (edConst) {
          const edInt = BigInt(edConst);
          const edFmt = fmtIntWithDecimals(edInt, dec);
          setNativeEd(edFmt);
          onChainData?.({ status: "Connected. Reading balances...", edDot: edFmt });
        }

        // Subscribe native free balance (balances pallet)
        unsubNative = (await api.query.system.account(selected, (info: any) => {
          const free = BigInt(info.data.free.toString());
          const balFmt = fmtIntWithDecimals(free, dec);
          setNativeBal(balFmt);
          onChainData?.({ status: "Live balance (read-only)", balanceDot: balFmt });
        })) as unknown as () => void;

        // Subscribe USDC only on Asset Hub (Assets pallet id 1337)
        if (chain === "assethub") {
          try {
            const USDC_ID = 1337;

            const md: any = await api.query.assets.metadata(USDC_ID);
            const usdcDecimals = Number(md.decimals?.toString?.() ?? "6");
            const symHuman = md.symbol?.toHuman?.();
            const sym = typeof symHuman === "string" ? symHuman : "USDC";
            setUsdcLabel(`${sym} (Asset Hub)`);

            // IMPORTANT: pass AccountId32 bytes (robust across runtimes)
            const who = decodeAddress(selected);

            unsubUsdc = (await api.query.assets.account(USDC_ID, who, (acc: any) => {
              const bal = BigInt(acc.balance.toString());
              setUsdcBal(fmtIntWithDecimals(bal, usdcDecimals));
            })) as unknown as () => void;
          } catch (e) {
            console.warn("USDC subscribe failed:", e);
            setUsdcLabel("USDC (Asset Hub)");
            setUsdcBal("-");
          }
        }

        setStatusN("Live balance (read-only)");
      } catch (e: any) {
        setStatusN(`RPC error: ${e?.message ?? String(e)}`);
      }
    }

    connectAndSubscribe();

    return () => {
      cancelled = true;

      try {
        if (unsubNative) unsubNative();
      } catch {}

      try {
        if (unsubUsdc) unsubUsdc();
      } catch {}

      try {
        api?.disconnect();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, selected]);

  const edHelp =
    chain === "assethub"
      ? "ED matters for keeping the account alive on this chain. Keep a DOT buffer."
      : "ED is chain-specific and refers to the chain native token (shown above).";

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
            <div>
              <b>Chain:</b> {chain}
            </div>

            <div>
              <b>{nativeSymbol} (free):</b> {nativeBal}
            </div>

            <div>
              <b>Existential Deposit (ED):</b> {nativeEd}{" "}
              <span style={{ opacity: 0.6 }}>(native)</span>
            </div>

            {chain === "assethub" && (
              <div>
                <b>{usdcLabel}:</b> {usdcBal}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
            {edHelp}
          </div>

          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>
            Selected: {selectedAccount?.name ?? "Account"} ({selected.slice(0, 10)}…)
          </div>
        </>
      )}
    </div>
  );
}

