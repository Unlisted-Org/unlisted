# Spec 03: the multiplier rule and Acceptance 3 conflict

Agent C (ops), 2026-09-25. Needs a decision from the spec owner.

## The two statements

- *Effective multiplier rule*: "read from the mint account's `scaledUiAmountConfig`: the fixture mint for fixture display, and the mainnet mint for mainnet prices."
- *Acceptance 3*: "A multiplier change on a fixture ... changes `reference.usd` and display fields only after the effective timestamp."

`reference.usd` is built from PreStocks' `markPrice`, a mainnet price per mainnet UI token. Under the rule it converts to per-raw with the **mainnet** multiplier: `usd_per_raw = markPrice x effective_multiplier(mainnet mint) / 10^9`. A multiplier change on a devnet fixture doesn't touch the mainnet mint or `markPrice`, so under the rule `reference.usd` can't change. Both statements can't hold.

## What is implemented (branch `ops`)

The rule, as written:

- **Fixture multiplier:** drives `legs[].multiplier` (stored, effective, effective_since, pending) and `legs[].per_share_ui`.
- **Mainnet multiplier:** drives `values.reference` (each leg reports `effective_multiplier` and its `multiplier_source`).
- **Raw fields never use a multiplier.**

Acceptance 3 is proven in this form:

1. A fixture multiplier change leaves every raw field unchanged.
2. Display fields change only after the effective timestamp.
3. Token-2022's own `AmountToUiAmount` (simulated) agrees before and after.

## The alternative, if you prefer it

Convert `reference` with the fixture's effective multiplier. This treats the fixture change as if it had happened on mainnet with `markPrice` per UI token held fixed. It is a one-line change in `services/valuation/src/valuation.ts` (`values()`, reference legs). Today it gives identical numbers, because every fixture mirrors the mainnet multiplier.
