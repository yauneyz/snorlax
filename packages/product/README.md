# Shared product rules

`@talysman/product` is the product contract shared by the desktop app and web backend.
Import from the package entry point; `src/index.ts` re-exports the public API.

| Module | Responsibility |
| --- | --- |
| `src/pricing.ts` | Checkout options, trial length, display prices, and price formatting |
| `src/entitlements.ts` | Plan and entitlement schemas, device allowance, and offline grace policy |
| `src/limits.ts` | Free/Pro feature limits, validation, and profile/policy constraints |
| `src/messages.ts` | Desktop message and receipt schemas |
| `src/features.ts` | Shared rollout flags and AI judge request cap |

These modules contain no Electron or server dependencies. Internal imports point directly to the
owning module to avoid cycles through the entry point. Stripe remains authoritative for charges;
the pricing constants here drive display and checkout configuration.

For limits, `null` means unrestricted. Validation reports violations; constraint helpers return
the configuration that the plan permits. Profile constraints keep the active/default profile so
a downgrade does not silently switch the enforced policy. Entitlement schemas also describe
cached and signed data; preserve those contracts when changing their implementation.

Existing coverage lives in `tests/electron/unit/productLimits.test.ts`, desktop entitlement tests,
and the web unit suite (including pricing, billing, and trial eligibility).
