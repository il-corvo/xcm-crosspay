# XCM CrossPay (Alpha)

**XCM CrossPay** is a non-custodial web dApp that allows users to move assets across
Polkadot chains using **XCM**, with a focus on **simplicity**, **defensive execution**
and **user safety**.

This project intentionally starts with a **limited scope** and grows only after
real-world usage and feedback.

---

## 🌐 Live dApp

👉 **Try the dApp:**  
https://il-corvo.github.io/xcm-crosspay/

> Public alpha. Non-custodial. Use small amounts.

---

## ⚠️ Alpha status

This software is in **public alpha**.

- All transactions are signed by the user (non-custodial)
- No funds are ever held by this application
- Failed executions and edge cases are possible
- **Use small amounts**

If you are not comfortable understanding on-chain transactions and fees,
do not use this dApp yet.

---

## Phase 0 scope

### Supported assets
- **DOT**
- **USDC (Asset Hub)**

### Supported chains
- **Polkadot Asset Hub**
- **HydraDX**

### Routing model
- Defensive routing
- Asset Hub used as safe intermediary when needed
- No advanced or optimized routing in Phase 0

---

## Fees

- **Network fees**: determined by the Polkadot network
- **Service fee**: 0.15% (clamped)
  - Minimum: 0.02 DOT
  - Maximum: 0.20 DOT

Fees are always shown **before** execution.

---

## Safety features (already implemented)

- Wallet connection (read-only)
- Live balance reading
- **Existential Deposit (ED) protection**
- Send action disabled if:
- Clear user feedback when an operation is unsafe

The goal is to **prevent common and costly user mistakes**.

---

## What this dApp does NOT do (yet)

- No automatic swaps
- No fee abstraction
- No advanced routing logic
- No smart contracts custody
- No governance token

These features may be evaluated only after proven usage.

---

## Tech stack

- Frontend: **Vite + React + TypeScript**
- Wallets: **polkadot{.js} extension** (desktop)
- Chain access: **@polkadot/api**
- Hosting: **GitHub Pages**
- CI/CD: **GitHub Actions**

---

## Roadmap (high level)

- **Phase 0**:  
Wallet connection, balance + ED safety, form validation, fee preview

- **Phase 1**:  
XCM dry-run (payload preview without submission)

- **Phase 2**:  
Real XCM submission with explicit user confirmation

- **Phase 3**:  
Additional chains, improved routing, mobile-friendly signing (Vault / QR)

---

## Development philosophy

> A limited dApp that people actually use  
> is better than a perfect one nobody touches.

- Ship early
- Observe real usage
- Iterate only where friction exists
- Keep everything non-custodial and transparent

> “Information wants to be free.”  
> — Stewart Brand


---

## License

MIT License.
