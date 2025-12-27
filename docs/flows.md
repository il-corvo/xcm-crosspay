
# Phase 0 XCM Flows

## Scope
- Chains: Asset Hub ↔ HydraDX
- Assets: DOT, USDC (Asset Hub)
- Philosophy: defensive, minimal, predictable

## Happy paths
1) HydraDX → Asset Hub (DOT / USDC_AH)
2) Asset Hub → HydraDX (DOT / USDC_AH)

## Fallback policy
If direct path fails, we prefer routing via Asset Hub (when applicable) to maximize predictability.
(Phase 0: no advanced routing)
