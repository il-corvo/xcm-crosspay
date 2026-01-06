// xcm-engine/balances.ts
import { ApiPromise, WsProvider } from "@polkadot/api";

// -------- Types --------

export type ChainId = "assethub" | "hydradx" | "relay" | "people";

export type ChainBalanceSnapshot = {
  chain: ChainId;

  nativeSymbol: string;      // DOT / HDX
  nativeDecimals: number;    // 10 / 12
  nativeFree?: string;       // formatted to 6 decimals
  ed?: string;               // formatted to 6 decimals

  tokens?: Record<string, string>; // e.g. { USDC: "26.080030", USDT: "1.490022" }

  ok: boolean;
  error?: string;
  rpc?: string;
  ts: number;                // Date.now()
};

export type ProbeConfig = {
  timeoutMs?: number; // default 8000
  rpcs: Record<ChainId, string[]>;
  // Asset Hub asset IDs
  assetHub: {
    usdcAssetId: number; // 1337
    usdtAssetId: number; // 1984
  };
  // Hydra asset IDs (tokens pallet CurrencyId)
  hydra: {
    usdcAssetId: number; // 22
    usdtAssetId: number; // 10
    hdxSymbol?: string;  // default "HDX"
  };
  // People para uses native DOT; no extra config needed
};

// -------- Helpers --------

function nowTs() {
  return Date.now();
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

function fmtBigintFixed6(value: bigint, decimals: number): string {
  // value is in smallest units; return string with 6 decimals (rounded DOWN)
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;

  const fracStr = frac.toString().padStart(decimals, "0");
  const frac6 = fracStr.slice(0, 6).padEnd(6, "0");

  return `${whole.toString()}.${frac6}`;
}

async function connectWithFallback(
  urls: string[],
  timeoutMs: number
): Promise<{ api: ApiPromise; rpc: string }> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const api = await withTimeout(ApiPromise.create({ provider: new WsProvider(url) }), timeoutMs);
      return { api, rpc: url };
    } catch (e: any) {
      lastErr = e;
    }
  }
  throw new Error(lastErr?.message ?? String(lastErr ?? "All RPC endpoints failed"));
}

// -------- AssetHub probe --------

async function probeAssetHub(address: string, cfg: ProbeConfig): Promise<ChainBalanceSnapshot> {
  const timeoutMs = cfg.timeoutMs ?? 8000;
  const rpcs = cfg.rpcs.assethub;

  const snapBase = (): ChainBalanceSnapshot => ({
    chain: "assethub",
    nativeSymbol: "DOT",
    nativeDecimals: 10,
    ok: false,
    ts: nowTs(),
  });

  let api: ApiPromise | null = null;
  try {
    const conn = await connectWithFallback(rpcs, timeoutMs);
    api = conn.api;

    // Native DOT free
    const sys: any = await api.query.system.account(address);
    const free = BigInt(sys.data.free.toString());

    // ED
    const edStr = api.consts.balances?.existentialDeposit?.toString?.() ?? "0";
    const ed = BigInt(edStr);

    // USDC/USDT assets pallet
    const usdcId = cfg.assetHub.usdcAssetId;
    const usdtId = cfg.assetHub.usdtAssetId;

    const usdcAcc: any = await api.query.assets.account(usdcId, address);
    const usdtAcc: any = await api.query.assets.account(usdtId, address);

    // decimals for each asset
    const usdcMeta: any = await api.query.assets.metadata(usdcId);
    const usdtMeta: any = await api.query.assets.metadata(usdtId);
    const usdcDec = Number(usdcMeta.decimals?.toString?.() ?? "6");
    const usdtDec = Number(usdtMeta.decimals?.toString?.() ?? "6");

    const usdcBal = BigInt(usdcAcc.balance?.toString?.() ?? "0");
    const usdtBal = BigInt(usdtAcc.balance?.toString?.() ?? "0");

    const snap: ChainBalanceSnapshot = {
      chain: "assethub",
      nativeSymbol: "DOT",
      nativeDecimals: 10,
      nativeFree: fmtBigintFixed6(free, 10),
      ed: fmtBigintFixed6(ed, 10),
      tokens: {
        USDC: fmtBigintFixed6(usdcBal, usdcDec),
        USDT: fmtBigintFixed6(usdtBal, usdtDec),
      },
      ok: true,
      rpc: conn.rpc,
      ts: nowTs(),
    };

    return snap;
  } catch (e: any) {
    return { ...snapBase(), error: e?.message ?? String(e) };
  } finally {
    try {
      await api?.disconnect();
    } catch {}
  }
}

// -------- Relay probe --------

async function probeRelay(address: string, cfg: ProbeConfig): Promise<ChainBalanceSnapshot> {
  const timeoutMs = cfg.timeoutMs ?? 8000;
  const rpcs = cfg.rpcs.relay;

  const snapBase = (): ChainBalanceSnapshot => ({
    chain: "relay",
    nativeSymbol: "DOT",
    nativeDecimals: 10,
    ok: false,
    ts: nowTs(),
  });

  let api: ApiPromise | null = null;
  try {
    const conn = await connectWithFallback(rpcs, timeoutMs);
    api = conn.api;

    const sys: any = await api.query.system.account(address);
    const free = BigInt(sys.data.free.toString());

    const edStr = api.consts.balances?.existentialDeposit?.toString?.() ?? "0";
    const ed = BigInt(edStr);

    return {
      chain: "relay",
      nativeSymbol: "DOT",
      nativeDecimals: 10,
      nativeFree: fmtBigintFixed6(free, 10),
      ed: fmtBigintFixed6(ed, 10),
      tokens: {},
      ok: true,
      rpc: conn.rpc,
      ts: nowTs(),
    };
  } catch (e: any) {
    return { ...snapBase(), error: e?.message ?? String(e) };
  } finally {
    try { await api?.disconnect(); } catch {}
  }
}

// -------- People probe --------

async function probePeople(address: string, cfg: ProbeConfig): Promise<ChainBalanceSnapshot> {
  const timeoutMs = cfg.timeoutMs ?? 8000;
  const rpcs = cfg.rpcs.people;

  const snapBase = (): ChainBalanceSnapshot => ({
    chain: "people",
    nativeSymbol: "DOT",
    nativeDecimals: 10,
    ok: false,
    ts: nowTs(),
  });

  let api: ApiPromise | null = null;
  try {
    const conn = await connectWithFallback(rpcs, timeoutMs);
    api = conn.api;

    const sys: any = await api.query.system.account(address);
    const free = BigInt(sys.data.free.toString());

    const edStr = api.consts.balances?.existentialDeposit?.toString?.() ?? "0";
    const ed = BigInt(edStr);

    return {
      chain: "people",
      nativeSymbol: "DOT",
      nativeDecimals: 10,
      nativeFree: fmtBigintFixed6(free, 10),
      ed: fmtBigintFixed6(ed, 10),
      tokens: {},
      ok: true,
      rpc: conn.rpc,
      ts: nowTs(),
    };
  } catch (e: any) {
    return { ...snapBase(), error: e?.message ?? String(e) };
  } finally {
    try { await api?.disconnect(); } catch {}
  }
}

// -------- Hydra probe --------

async function probeHydra(address: string, cfg: ProbeConfig): Promise<ChainBalanceSnapshot> {
  const timeoutMs = cfg.timeoutMs ?? 8000;
  const rpcs = cfg.rpcs.hydradx;

  const snapBase = (): ChainBalanceSnapshot => ({
    chain: "hydradx",
    nativeSymbol: cfg.hydra.hdxSymbol ?? "HDX",
    nativeDecimals: 12,
    ok: false,
    ts: nowTs(),
  });

  let api: ApiPromise | null = null;
  try {
    const conn = await connectWithFallback(rpcs, timeoutMs);
    api = conn.api;

    const hdxSymbol = cfg.hydra.hdxSymbol ?? "HDX";

    // Native (balances) = HDX on Hydra
    const sys: any = await api.query.system.account(address);
    const free = BigInt(sys.data.free.toString());

    const edStr = api.consts.balances?.existentialDeposit?.toString?.() ?? "0";
    const ed = BigInt(edStr);

    // Hydra tokens pallet: tokens.accounts(who, currencyId)
    // We already discovered USDC=22, USDT=10 in your debug.
    const usdcId = cfg.hydra.usdcAssetId;
    const usdtId = cfg.hydra.usdtAssetId;

    // Some runtimes expose tokens.accounts, others tokens.accounts might be under different pallet;
    // Hydra has query.tokens.
    if (!(api.query as any).tokens?.accounts) {
      // fallback: still return native/ed
      return {
        chain: "hydradx",
        nativeSymbol: hdxSymbol,
        nativeDecimals: 12,
        nativeFree: fmtBigintFixed6(free, 12),
        ed: fmtBigintFixed6(ed, 12),
        tokens: {},
        ok: true,
        rpc: conn.rpc,
        ts: nowTs(),
      };
    }

    const usdcAcc: any = await (api.query as any).tokens.accounts(address, usdcId);
    const usdtAcc: any = await (api.query as any).tokens.accounts(address, usdtId);

    const usdcFree = BigInt(usdcAcc.free?.toString?.() ?? "0");
    const usdtFree = BigInt(usdtAcc.free?.toString?.() ?? "0");

    // Hydra stablecoins are 6 decimals (per your registry scan)
    const stableDec = 6;

    return {
      chain: "hydradx",
      nativeSymbol: hdxSymbol,
      nativeDecimals: 12,
      nativeFree: fmtBigintFixed6(free, 12),
      ed: fmtBigintFixed6(ed, 12),
      tokens: {
        USDC: fmtBigintFixed6(usdcFree, stableDec),
        USDT: fmtBigintFixed6(usdtFree, stableDec),
      },
      ok: true,
      rpc: conn.rpc,
      ts: nowTs(),
    };
  } catch (e: any) {
    return { ...snapBase(), error: e?.message ?? String(e) };
  } finally {
    try { await api?.disconnect(); } catch {}
  }
}

// -------- Public API --------

export async function probeAllChains(address: string, cfg: ProbeConfig): Promise<ChainBalanceSnapshot[]> {
  // Run probes in parallel; each handles its own errors/timeouts.
  const [ah, hy, re, pe] = await Promise.all([
    probeAssetHub(address, cfg),
    probeHydra(address, cfg),
    probeRelay(address, cfg),
    probePeople(address, cfg),
  ]);

  return [ah, hy, re, pe];
}
