import { useEffect, useMemo, useState } from "react";
import { web3Accounts, web3Enable } from "@polkadot/extension-dapp";
import { ApiPromise, WsProvider } from "@polkadot/api";

type ChainKey = "assethub" | "hydradx";

const RPCS: Record<ChainKey, string[]> = {
  assethub: [
    "wss://asset-hub-polkadot-rpc.dwellir.com",
    "wss://polkadot-asset-hub-rpc.polkadot.io",
    "wss://rpc-asset-hub-polkadot.luckyfriday.io",
  ],
  hydradx: [
    "wss://rpc.hydradx.cloud",
    "wss://hydradx-rpc.dwellir.com",
  ],
};


function fmtPlanckToDot(planck: bigint, decimals = 10): string {
  // Polkadot DOT has 10 decimals. This is a simple formatter.
  const s = planck.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function WalletPanel(props: { chain: ChainKey }) {
  const { chain } = props;

  const [extEnabled, setExtEnabled] = useState(false);
  const [accounts, setAccounts] = useState<{ address: string; name?: string }[]>(
    []
  );
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<string>("Not connected");
  const [balance, setBalance] = useState<string>("-");
  const [ed, setEd] = useState<string>("-");

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.address === selected),
    [accounts, selected]
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setStatus("Connecting to wallet extension...");
      try {
        const exts = await web3Enable("XCM CrossPay (Alpha)");
        if (cancelled) return;

        if (!exts || exts.length === 0) {
          setExtEnabled(false);
          setStatus("No wallet extension authorized (or none installed).");
          return;
        }
        setExtEnabled(true);

        setStatus("Loading accounts...");
        const accs = await web3Accounts();
        if (cancelled) return;

        type UiAccount = { address: string; name?: string };
        const mapped: UiAccount[] = accs.map((a: any) => ({
          address: a.address,
          name: a.meta?.name as string | undefined,
        }));
        setAccounts(mapped);
        setSelected(mapped[0]?.address ?? "");
        setStatus(mapped.length ? "Wallet ready" : "No accounts found");
      } catch (e: any) {
        setStatus(`Wallet error: ${e?.message ?? String(e)}`);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let api: ApiPromise | null = null;
    let cancelled = false;

    async function loadBalance() {
      setBalance("-");
      setEd("-");
      if (!selected) return;

      const rpcs = RPCS[chain];
      setStatus(`Connecting to ${chain} RPC...`);

      try {
        // pick first rpc (Phase 0). Later we add fallback.
        let connected = false;

        for (const url of rpcs) {
          try {
            setStatus(`Connecting to ${chain} RPC: ${url}`);
            const provider = new WsProvider(url);
            api = await ApiPromise.create({ provider });
            connected = true;
            break;
      } catch (e) {
        console.warn("RPC failed:", url, e);
      }
   }

if (!connected || !api) {
  setStatus("All RPC endpoints failed.");
  return;
}

        if (cancelled) return;

        setStatus(`Connected. Reading balance...`);

        // ED (existential deposit)
        const edConst = api.consts.balances?.existentialDeposit?.toString?.();
        if (edConst) {
          setEd(fmtPlanckToDot(BigInt(edConst)));
        }

        // Subscribe to account balance
        const unsubscribe = await api.query.system.account(
          selected,
          (info: any) => {
            const free = BigInt(info.data.free.toString());
            setBalance(fmtPlanckToDot(free));

         }
       );

        setStatus("Live balance (read-only)");
      } catch (e: any) {
        setStatus(`RPC error: ${e?.message ?? String(e)}`);
      }
    }

    loadBalance();

    return () => {
      cancelled = true;
      try {
        if (unsub) unsub();
      } catch {}
      try {
        api?.disconnect();
      } catch {}
    };
  }, [chain, selected]);

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
          Install/enable a Polkadot wallet extension (polkadot{".js"}, Talisman,
          SubWallet, etc.) and authorize this site.
        </div>
      )}

      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Status</div>
      <div style={{ marginBottom: 12 }}>{status}</div>

      {accounts.length > 0 && (
        <>
          <label>
            <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>
              Account
            </div>
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
              <b>Free balance (DOT):</b> {balance}
            </div>
            <div>
              <b>Existential Deposit (ED):</b> {ed}
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
            ED warning: sending too much may drop the remaining balance below ED
            and the account could be reaped on that chain.
          </div>

          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>
            Selected: {selectedAccount?.name ?? "Account"} ({selected.slice(0, 10)}
            …)
          </div>
        </>
      )}
    </div>
  );
}
