import "./App.css";

export default function App() {
  return (
    <div style={{ maxWidth: 840, margin: "40px auto", padding: "0 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>XCM CrossPay</h1>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          Non-custodial XCM transfers across Polkadot chains — simple, defensive flows.
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
          <li><b>Use small amounts</b>.</li>
        </ul>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ marginBottom: 8 }}>Phase 0 scope</h2>
        <ul>
          <li><b>Assets</b>: DOT, USDC (Asset Hub)</li>
          <li><b>Chains</b>: Asset Hub ↔ HydraDX</li>
          <li><b>Routing</b>: defensive (via Asset Hub when needed)</li>
          <li><b>Fees</b>: network fees + service fee (0.15%, clamped)</li>
        </ul>
      </section>

      <section style={{ marginTop: 28, opacity: 0.7 }}>
        <h2 style={{ marginBottom: 8 }}>Status</h2>
        <p style={{ margin: 0 }}>
          UI is live. XCM transfer UI and chain configs are in progress.
        </p>
      </section>

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
      </footer>
    </div>
  );
}

