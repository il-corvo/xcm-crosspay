import { useEffect, useMemo, useState } from "react";
import { web3Accounts, web3Enable } from "@polkadot/extension-dapp";

import type { ChainBalanceSnapshot } from "./engine/balances";
export type WalletChainData = {
  status: string;
};

type UiAccount = { address: string; name?: string };

function fmt6(s?: string): string {
  if (!s) return "-";
  // s is already formatted to 6 decimals by the probe engine, keep it stable
  return s;
}

function statusBadge(ok: boolean, error?: string) {
  if (ok) return { text: "OK", style: { color: "#0a7d2c" } };
  if (error) return { text: "ERR", style: { color: "#b00020" } };
  return { text: "…", style: { color: "#666" } };
}

function chainLabel(chain: string): string {
  if (chain === "assethub") return "Asset Hub";
  if (chain === "hydradx") return "HydraDX";
  if (chain === "relay") return "Relay";
  if (chain === "people") return "People";
  return chain;
}

export function WalletPanel(props: {
  snapshots: ChainBalanceSnapshot[];
  lastUpdatedMs?: number;
  onRefresh?: () => void;

  onSelectedAddress: (addr: string) => void;
  onChainData: (d: WalletChainData) => void;
}) {
  const { snapshots, lastUpdatedMs, onRefresh, onSelectedAddress, onChainData } =
    props;

  const [extEnabled, setExtEnabled] = useState(false);
  const [accounts, setAccounts] = useState<UiAccount[]>([]);
  const [selected, setSelected] = useState<string>("");
const [userSelected, setUserSelected] = useState(false);  
const [status, setStatus] = useState<string>("Not connected");

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
          onChainData({ status: "No extension" });
          return;
        }
        setExtEnabled(true);

        setStatus("Loading accounts...");
        const accs = await web3Accounts();
        if (cancelled) return;

        const mapped: UiAccount[] = accs.map((a: any) => ({
          address: a.address,
          name: a.meta?.name as string | undefined,
        }));

setAccounts(mapped);

setSelected((prev) => {
  // se l'utente ha scelto manualmente, non toccare la selezione
  if (userSelected && prev) return prev;

  // se la selezione precedente esiste ancora, tienila
  if (prev && mapped.some((a) => a.address === prev)) return prev;

  // fallback: primo account
  return mapped[0]?.address ?? "";
});

setStatus(mapped.length ? "Wallet ready" : "No accounts found");
onChainData({ status: mapped.length ? "Wallet ready" : "No accounts" });
      } catch (e: any) {
        setStatus(`Wallet error: ${e?.message ?? String(e)}`);
        onChainData({ status: "Wallet error" });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [onSelectedAddress, onChainData]);

  // Whenever selected changes, notify parent (App.tsx) so it can refresh probes
  useEffect(() => {
    if (selected) onSelectedAddress(selected);
  }, [selected, onSelectedAddress]);

  const updatedLabel = useMemo(() => {
    if (!lastUpdatedMs) return "—";
    const d = new Date(lastUpdatedMs);
    return d.toLocaleString();
  }, [lastUpdatedMs]);

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
onChange={(e) => {
  setUserSelected(true);
  setSelected(e.target.value);
}}
              style={{ width: "100%", padding: 10, borderRadius: 8 }}
            >
              {accounts.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.name ? `${a.name} — ${a.address}` : a.address}
                </option>
              ))}
            </select>
          </label>

          <div style={{ marginTop: 12, fontSize: 13, opacity: 0.75 }}>
            Selected: {selectedAccount?.name ?? "Account"} ({selected.slice(0, 10)}
            …)
          </div>
        </>
      )}

      {/* Portfolio snapshot */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Multi-chain snapshot</h3>
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Last update: {updatedLabel}
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              style={{
                marginLeft: "auto",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Refresh
            </button>
          )}
        </div>

        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #eee" }}>
                  Chain
                </th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #eee" }}>
                  Native
                </th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #eee" }}>
                  Free
                </th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #eee" }}>
                  ED
                </th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #eee" }}>
                  USDC
                </th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #eee" }}>
                  USDT
                </th>
                <th style={{ padding: "8px 6px", borderBottom: "1px solid #eee" }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => {
                const usdc = s.tokens?.USDC;
                const usdt = s.tokens?.USDT;
                const badge = statusBadge(s.ok, s.error);

                return (
                  <tr key={s.chain}>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      {chainLabel(s.chain)}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      {s.nativeSymbol}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      {fmt6(s.nativeFree)}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      {fmt6(s.ed)}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      {usdc ? fmt6(usdc) : "—"}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      {usdt ? fmt6(usdt) : "—"}
                    </td>
                    <td style={{ padding: "8px 6px", borderBottom: "1px solid #f4f4f4" }}>
                      <span style={badge.style}>{badge.text}</span>
                      {!s.ok && s.error && (
                        <span style={{ marginLeft: 8, opacity: 0.7 }}>
                          {s.error}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Snapshot is best-effort: balances may change between refresh and signing.
        </div>
      </div>
    </div>
  );
}

