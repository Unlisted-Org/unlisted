# Spec 01: Shares and pricing

Status: **agreed** (2026-09-25); agents A, B and C built against it. The product is **Unlisted**; `basket` remains the technical identifier for the program, its accounts, seeds and instructions (see the naming note in [spec 00](00-agent-split.md)).
Executable form: [`spec/model/basket_model.py`](../../spec/model/basket_model.py). Its property tests are in [`spec/model/test_basket_model.py`](../../spec/model/test_basket_model.py) (17 tests, all passing). Deliberately breaking the rounding, the loss index, or the claim path makes those tests fail. When this document and the model disagree, the model is right and this document gets fixed.

## What Unlisted promises

A basket that still pays out when the issuer acts. Three rules carry that promise:

1. **A pause in one name doesn't lock the whole basket.** Redemption pays every available leg immediately and turns each unavailable leg into a claim that pays out once the leg is available again.
2. **A seizure is detected and shared.** The vault's actual token balance is the truth. A drop the program didn't cause reduces every holder's claim on that leg pro rata. No one is made whole by later depositors, and the drop is emitted as an event that the UI shows.
3. **There is no oracle.** Mint and redeem are computed from the vault's holdings. No price enters the program.

We concede one point up front: existing protocols can handle the transfer fee. Symmetry does, and we say so (see the Symmetry check in `docs/phase0.md`). The three rules above are the difference.

## Constituents

The basket holds seven legs, one per PreStocks company not yet public: OpenAI, Anthropic, Neuralink, Anduril, Polymarket, Kalshi and FigureAI.

- **Excluded:** SpaceX (listed 2026-06-12; its PreStock expires 2027-03-12) and xAI (converted 2026-09-12). The reasons are recorded in `docs/phase0.md` under *Decisions*.
- **Devnet only.** Each leg is a fixture mint that mirrors the real mint extension for extension (spec 02, *Fixtures*).
- **Units.** Every amount in this spec is a **raw token amount** (u64, 9 decimals for all seven). The scaled-UI multiplier is display only and never enters the maths.

## State per leg `i`

| Symbol | Meaning |
|---|---|
| `B_i` | Actual balance of the vault token account for leg `i`, read from the account on every instruction. Excludes withheld fees, as Token-2022 does. |
| `A_i` | Accounted balance: what the program expects `B_i` to be after its own transfers. |
| `C_i` | Claim units: shares that were burned but are still owed leg `i` (see *Partial redemption*). |
| `P_i` | Pending norm: open deposit-ticket deltas, stored divided by `L_i` (see *Deposit tickets*). |
| `L_i` | Loss index: fixed point, `1.0 = 10^18`. Moves down with every observed shortfall. |
| `S` | Share supply (the share mint's supply). |

Derived values:
- `pending_i = P_i × L_i / 10^18`: open tickets' current entitlement to leg `i`.
- `owned_i = B_i − pending_i`: what belongs to shares and claims.
- `denom_i = S + C_i`.
- **Per-share amount of leg `i` = `owned_i / denom_i`.** This is kept as an exact ratio and never stored as a rounded number.

## Observation: the balance is the truth

Every instruction that touches leg `i` first runs `observe(i)`:

- If `B_i < A_i`, the difference is a **shortfall**: a permanent-delegate burn or transfer, or anything else the program didn't do.
  - Set `L_i ← floor(L_i × B_i / A_i)`.
  - Emit `ShortfallObserved { leg, expected: A_i, actual: B_i }`.
  - Holders and claimants bear the loss through `owned_i / denom_i`; open tickets bear it through `L_i`. Everyone loses the same fraction.
- If `B_i > A_i`, the difference is a **surplus** (a donation or an airdropped distribution). Emit `SurplusObserved`. It accrues to holders and claimants, not to open tickets.
- Then set `A_i ← B_i`.

A permissionless `observe` instruction exists so the UI can surface a drop before anyone transacts.

**Model tests:** `Shortfall.test_seizure_is_shared_pro_rata_and_observed` (every holder's claim scales by the same factor ± 1 unit) and `Shortfall.test_later_depositors_do_not_make_holders_whole`.

## Mint

### In kind (core path; also the arbitrage path)

The depositor transfers some gross amount of every active leg into the vault in one instruction. The program measures each net delta `Δ_i` (gross minus the Token-2022 fee at the current epoch; **nothing about the fee is stored**) and mints:

```
m = min over active legs of  floor( Δ_i × denom_i / (owned_i − Δ_i) )
```

- The result must satisfy `m ≥ max(min_shares, 1)`, or the instruction fails with `SlippageExceeded`.
- **Refused** (`LegUnavailable`) if any active leg is unavailable (see *Availability*).
- Delivering more of a leg than the binding minimum leaves the excess in the vault, where it accrues to all holders. Clients size deposits to the current per-share composition, so this residual stays within the slippage tolerance. The UI discloses it.

### USDC (deposit ticket; the user-facing path)

1. `open_deposit_ticket` escrows the user's USDC in a ticket PDA. Refused if any leg is unavailable.
2. `ticket_swap_leg(i)` swaps part of the escrow through an allowlisted router, with output **straight into the vault account for leg `i`**. That avoids an extra fee hop.
   - The program measures `Δ_i` around the CPI and checks it against the caller's `min_out`.
   - It credits the ticket `floor(Δ_i × 10^18 / L_i)` and adds the same amount to `P_i`.
3. `finalize_deposit` requires every active leg to have landed. It computes each ticket delta as `norm × L_i / 10^18`, so a shortfall during the ticket is shared. It then applies the mint formula, removes the ticket's norms from `P_i` and mints.
4. If a leg can't land before `expiry_slot`, `abort_deposit` refunds the unused USDC. Legs that did land are sold back through the router into the escrow (`unwind_leg`) and refunded. If a landed leg becomes unavailable, it stays in the ticket until it is available.

**Model tests:** `TransferFee.test_mint_credits_measured_net_not_gross` and `Shortfall.test_open_ticket_bears_shortfall_pro_rata`.

### Bootstrap

The first deposit into an empty vault sets the composition.
- The deployer deposits every leg in kind, and exactly `initial_shares = 1_000_000_000` shares (1.0 share at 9 decimals) are minted.
- Composition is **equal weight by value** at inception: an equal USDC amount per leg, priced from the three published sources in spec 03 at a recorded slot and timestamp.
- Those source figures are committed with the deploy.
- After bootstrap the program never uses a price again.

## Redeem: partial on unavailable legs (core instruction, headline differentiator)

`redeem(s, mode)` burns `s` shares. For each active leg `i`:

- **Leg available:** pay `floor(s × owned_i / (S + C_i))`, where `S` is the supply *before* the burn.
  - `mode = InKind`: transfer to the user in the same instruction. The recipient gets the amount minus the transfer fee.
  - `mode = Usdc`: the leg is **not** fixed as an amount. It becomes a claim of `s` units with reason `PendingSale`, sold by `settle_leg_usdc` for `floor(units × owned_i / (S + C_i))`, with the user's `min_out` checked against the measured USDC change. If no route works, it settles in kind. Every leg in a USDC redemption therefore obeys the same pro-rata rule as a paused-leg claim.
- **Leg unavailable:** set `C_i ← C_i + s` and record a **claim** `{ owner, leg: i, units: s }` in the redemption ticket. Emit `ClaimCreated`.

This conserves value for everyone:
- For a leg paid now, the remaining holders' per-share amount can only rise, because of the floor.
- For a claimed leg, the per-share amount is `owned_i / (S − s + C_i + s)`, which is unchanged.

`settle_claim(ticket, i)` is permissionless once leg `i` is available. It:
- runs `observe(i)`;
- pays `floor(units × owned_i / (S + C_i))` in kind to the claim owner, or through the router if the owner opted for USDC;
- sets `C_i ← C_i − units`.

A claim therefore shares any shortfall that happens while it is open, pro rata, exactly like a share.

Multiple legs can be unavailable at once, and each becomes its own claim. A claim is not a share: it is owed one leg only, and it can't be transferred in v1.

**Model tests (the largest group):**
- `PartialRedemption.test_available_legs_pay_immediately_and_claim_pays_after_resume`: 200 seeds. Legs paid now match an unpaused control to the unit; the claim settles within 1 unit of the control.
- `test_other_holders_unaffected_while_claim_open`
- `test_claim_shares_a_later_seizure_pro_rata`
- `test_multiple_paused_legs_and_deposit_refused`

## Availability

A leg is **unavailable** when any of these holds, read live on every instruction:

| Condition | Why it matters |
|---|---|
| The mint's `PausableConfig.paused` is true | Token-2022 rejects every transfer (`MintPaused`, 0x43). Proven on devnet. |
| The mint's `TransferHook.program_id` is not null | The program would have to forward accounts for a hook it hasn't reviewed. It refuses rather than guessing. |
| The vault token account's state is `Frozen` | The issuer's freeze authority froze it (`AccountFrozen`, 0x11). |

- **While any leg is unavailable:** deposits of any kind are refused; redemptions proceed and pay what they can; claims wait.
- **If a hook is switched on permanently:** claims on that leg can't settle until a program upgrade adds reviewed hook support. That is a governance action, disclosed in the UI.

## Rounding: always in the vault's favour

Stated once and applied everywhere:

- Shares minted, amounts redeemed, claim payouts and ticket deltas are **floored**.
- The loss index is **floored**, so an open ticket never escapes a shortfall.
- Division is done in u128 after multiplication. Any leftover unit stays in the vault and accrues to all holders.

**Model tests:** `RoundingFavoursVault.*`. Across 300 random sequences of mints, redeems, pauses, seizures, donations, tickets and fee changes, the total everyone is owed never exceeds `B_i` for any leg. Mints and redeems never lower remaining holders' per-share amount.

## Transfer fee

The fee is never stored. Every inflow is credited at its **measured** net delta. Every outflow's fee is borne by the recipient: the redeemer in kind, or the pool in a sale, which reprices the sale.

A fee change mid-position changes nothing in the accounting (`TransferFee.test_fee_change_mid_position_needs_no_stored_fee`).

Before any account close, the program runs `harvest_withheld_tokens_to_mint` (permissionless). Vault accounts are never closed while the basket exists.

## Scaled-UI multiplier

It never enters the program. Raw balances and raw per-share amounts are the only quantities. The valuation API (spec 03) applies the **effective** multiplier for display:

- `newMultiplier` once `newMultiplierEffectiveTimestamp` has passed, otherwise `multiplier`.
- Reading the stored `multiplier` field alone is the bug that values OpenAI 1.486× wrong today and SpaceX 5×.

A multiplier change mid-position changes no share maths. It only changes what the UI prints.

## IPO rule: general, applied first to SpaceX as the worked case

When a constituent company lists, its PreStock stops being "not yet public" and typically gets a conversion deadline. The rule, written once:

1. **Listing notice (authority, on-chain, timelocked).**
   - The basket authority calls `flag_listing(i, convert_after, deadline)`.
   - This emits `LegListing` and starts a **notice period of at least 7 days** (`convert_after ≥ now + 7 d`).
   - `convert_after` must be at least 7 days before `deadline`.
   - This is the one step that needs an off-chain fact (the company listed), so it's an authority action. It is public and can't take effect early.
2. **Holder choice during notice.** Any holder can redeem in kind and receive the listed leg's PreStock directly, then convert it themselves on the issuer's path. Nothing is forced on anyone who acts.
3. **Conversion (permissionless after `convert_after`).**
   - Anyone can call `convert_listed_leg(i, amount, min_out, route)` in chunks bounded by `max_convert_chunk`, which caps price impact.
   - Each call sells part of the leg through the router into the basket's **USDC reserve**, checked against a measured `min_out`.
   - Outstanding claims on the leg must settle first.
   - Redemptions during conversion receive a pro-rata share of the reserve.
4. **Reinvestment (permissionless).** `reinvest_reserve` buys the remaining legs with the reserve in **equal USDC amounts per leg**. No price is needed, and every holder's fraction is unchanged. Each leg's output is measured.
5. **Retirement.** When the leg's `owned_i` is zero, it is marked `Retired`. The basket stays a basket of companies not yet public.

If nobody converts before the deadline, the leg goes to zero for everyone who didn't redeem it in kind during notice. The UI counts down from `LegListing`.

**Worked case: SpaceX.** Under this rule SpaceX would have been flagged after its listing on 2026-06-12. Conversion would have run no later than 2027-03-05 (7 days before the 2027-03-12 deadline) and reinvested into the other seven. Because v1 launches after the listing, SpaceX is simply not a constituent: that is the rule applied at inception.

**Model tests:** `IpoRule.*` (holder fractions preserved exactly; per-share amounts of remaining legs never fall on reinvest; conversion waits for open claims; redemptions during conversion receive pro-rata USDC).

## Weights over time: fixed quantities, no rebalancing

After bootstrap the vault holds fixed raw quantities per share, and value weights drift with performance. A year in, the basket is overweight whatever rose. The UI shows the current value weights next to the inception weights. Only the IPO rule changes composition.

## What the product states about price

The program has no price. The app shows three labelled values (spec 03) and never a single "true price":

1. **If you redeemed now:** live fee-inclusive sell quotes for *your* share at *your* size.
2. **Last trade:** each leg's last traded price, with its age.
3. **PreStocks reference:** the issuer's off-chain secondary-market estimate, marked *not tradable*.

The gaps between them are shown, not hidden. That honesty about which value is which is part of the product.
