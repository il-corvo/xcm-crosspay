# XCM CrossPay (Alpha)

**XCM CrossPay** is a non-custodial web dApp that allows users to move assets across  
Polkadot chains using **XCM**, with a focus on **simplicity**, **defensive execution**,  
and **user safety**.

This project intentionally starts with a **limited scope** and grows only after  
real-world usage and real on-chain validation.

This is not a demo.  
This is built by observing what actually works on-chain.

---

## 🌐 Live dApp

👉 **Try the dApp:**  
https://il-corvo.github.io/xcm-crosspay/

> Public alpha · Non-custodial · Use small amounts

---

## ⚠️ Alpha status

This software is in **public alpha**.

- All transactions are signed by the user (non-custodial)
- No funds are ever held by this application
- Failed executions and edge cases are possible
- **Use small amounts**

If you are not comfortable understanding on-chain transactions, XCM routing,
and execution fees, do not use this dApp yet.

---

## What works today (real, on-chain)

### Stablecoins (safe-mode)
- **USDC** and **USDT**
- Routes:
  - Asset Hub ⇄ HydraDX
- Method:
  - `polkadotXcm.limitedReserveTransferAssets`
- Defensive defaults, ED-safe, production-grade

### DOT (advanced / experimental)
- **DOT Asset Hub → HydraDX**
- Method:
  - `polkadotXcm.execute`
- Explicit XCM message construction
- Guardrails enforced:
  - Amount range: **0.05 – 0.50 DOT**
  - Conservative execution fees
- Disabled by default (opt-in)

---

## Fees

- **Network fees**  
  Determined by the Polkadot runtime and destination chain.

- **Service fee (optional)**  
  - Default: enabled
  - Can be disabled by the user
  - Used to sustain development and infrastructure
  - Always shown before execution

No hidden fees. No custody. No magic.

---

## Safety features

- Read-only wallet connection
- Live on-chain balance reading
- **Existential Deposit (ED) protection**
- Amount guards and route validation
- Explicit warnings for experimental paths
- Real-time XCM execution logs

The goal is to **prevent irreversible mistakes**, not to maximize throughput.

---

## What this dApp intentionally does NOT do

- No automatic swaps
- No fee abstraction
- No routing optimization games
- No custody or smart contract vaults
- No governance token

If it is not strictly necessary, it is not included.

---

## Tech stack

- Frontend: **Vite + React + TypeScript**
- Wallets: **polkadot{.js} extension**
- Chain access: **@polkadot/api**
- Hosting: **GitHub Pages**
- CI/CD: **GitHub Actions**

Everything visible. Everything inspectable.

---

## Roadmap (honest)

- **Phase 0** ✅  
  Wallet connection, balances, ED safety, stablecoin transfers

- **Phase 1** ✅  
  XCM dry-run preview, execution logs, guarded real submission

- **Phase 2**  
  UI refinements, better raw XCM introspection

- **Phase 3**  
  Additional chains *only if* real usage justifies them

No hype-driven roadmap. Only earned complexity.

---

## Development philosophy

> A limited dApp that people actually use  
> is better than a perfect one nobody touches.

- Ship early
- Observe real behavior
- Reverse-engineer reality when needed
- Add complexity only when forced by facts
- Keep everything non-custodial and transparent

> “Information wants to be free.”  
> — **Stewart Brand**

---

## Dedication

This project was built by **reverse-engineering real on-chain behavior**,  
not by blindly trusting abstractions or assumptions.

> **If it doesn’t harm others, there’s no reason not to understand it.**  
> — *Old Crow*

To those who learned by opening chips, reading buses,  
and figuring things out the hard way.

---

## License

MIT License.

