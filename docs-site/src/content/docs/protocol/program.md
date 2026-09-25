---
title: The program
description: The basket program's id, its devnet deploy, what its authority can and can't do, its constants, errors and events.
---

## Identity and deploy

| | |
|---|---|
| Program id | `GyiHodshTGFo7hXSXGQiHLTCzH9yF2QWWHy6s7sm6QQv` (devnet) |
| Name in code | `basket` (crate, accounts, PDA seeds and instructions keep the technical name) |
| Framework | Anchor 0.32.1 |
| Deploy transaction | [`3MGLsSPQ…BqEcpmUB`](https://explorer.solana.com/tx/3MGLsSPQtK7nU1pUvrQRRBvKXUuPsUMVSBKzYVZpunwDVhqTYhwiRtyucgjV82QtsZU5PoupQTyHPuAwBqEcpmUB?cluster=devnet "slot 503653050") |
| Program data account | `HhG93LQ79fa4anKsS17yzeJGuXYMwRtJCyqthxYUJ7Wf`, 374,704 bytes |
| Upgrade authority | `DBJ6FdxbtWEZsVjUsZ3PBMefpxvmtQX8pMp7sDULoFgb`, held by the deployer on devnet |
| sha256 of the deployed bytes | `80db3bace6b493dbc09513437db25455058447ba11fbb71ba47b90aa56817dcc` |

**The deployed bytes are the tested build.** The sha256 above is the same for `solana program dump` of the deployed program and for the `basket.so` that the tests ran against (`tests/program/devnet/deploy.json`).

**It can be upgraded.** The upgrade authority is a single key held by the deployer. On devnet that is disclosed rather than removed; a program upgrade is also the only path to supporting a reviewed transfer hook ([Claims](/protocol/claims/#transfer-hook-switched-on)).

The **canonical basket**, the one the app uses, is `GJueMRWMqH8AMRBD8JP1qXS3vBGAAsjeyNWrYBzeWwJV`, with share mint `HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj`. It was initialized over the seven fixture mints and bootstrapped on devnet:

- `initialize_basket`: [`3uzYeobJ…tcUg5NuU`](https://explorer.solana.com/tx/3uzYeobJBjDQQSTJhu8o3yHGBsrJ7bWEbFFZqVMDefP9Gxw5ijB5PeSiBhjcSZWcMDT8xcaqs2SAJFqetcUg5NuU?cluster=devnet "slot 503662441")
- `bootstrap`: [`ZhLs24Lt…pYqByD8U`](https://explorer.solana.com/tx/ZhLs24LtobytL6C9kXKBDkcFb5ZksxiBH8117jrwq9Q9nBNfBbsYuZH4ivsvLUBtHZSFdh7TJ8NS1XRpYqByD8U?cluster=devnet "slot 503662749")

## What the authority can and can't do

The basket authority for the canonical basket is `DBJ6FdxbtWEZsVjUsZ3PBMefpxvmtQX8pMp7sDULoFgb`.

| It can | It can't |
|---|---|
| Propose a router, which takes effect after a 48-hour time lock; remove one immediately | Move vault tokens |
| Stop new deposits | Stop, delay or alter redemptions and claims |
| Flag a listing, with at least 7 days' notice | Change shares, claims or loss indices |
| Make the one-time bootstrap deposit | Bootstrap twice |

There is no instruction through which the authority can move vault tokens or block a redemption: the authority-only instructions are `propose_router`, `activate_router`, `remove_router`, `set_deposits_enabled`, `flag_listing`, `cancel_listing` and `bootstrap` (`programs/basket/src/lib.rs`).

## Constants

| Name | Value |
|---|---|
| `MAX_LEGS` | 8 (v1 uses 7) |
| `SHARE_DECIMALS` | 9 |
| `INITIAL_SHARES` | 1,000,000,000 (1.0 share) |
| `INDEX_ONE` | 10¹⁸ (a loss index of 1.0) |
| `MIN_LISTING_NOTICE` | 7 days |
| `MIN_DEADLINE_MARGIN` | 7 days |
| `ROUTER_ALLOWLIST_MAX` | 4 |
| `ALLOWLIST_TIMELOCK` | 48 hours |
| `TICKET_MAX_AGE_SLOTS` | 1,500 (≈ 6.6 minutes at the measured 0.2657 s per slot) |

## Errors

Anchor custom error codes, with the program's own messages (`programs/basket/src/errors.rs`). 6000–6017 are spec 02 verbatim; 6018–6024 were added by the program and ratified in spec 02.

<div class="stack err">

| Code | Hex | Name | Message |
|---|---|---|---|
| 6000 | 0x1770 | `LegUnavailable` | Leg unavailable: mint paused, transfer hook set, or vault frozen |
| 6001 | 0x1771 | `SlippageExceeded` | Measured output below the caller's minimum |
| 6002 | 0x1772 | `InsufficientShares` | Insufficient shares |
| 6003 | 0x1773 | `TicketIncomplete` | Deposit ticket incomplete: not every active leg has landed |
| 6004 | 0x1774 | `TicketExpired` | Deposit ticket expired |
| 6005 | 0x1775 | `RouterNotAllowed` | Router not in allowlist |
| 6006 | 0x1776 | `NotBootstrapped` | Basket not bootstrapped |
| 6007 | 0x1777 | `AlreadyBootstrapped` | Basket already bootstrapped |
| 6008 | 0x1778 | `LegEmpty` | Leg empty |
| 6009 | 0x1779 | `ListingNoticeTooShort` | Listing notice or deadline margin too short |
| 6010 | 0x177a | `ConversionNotOpen` | Conversion not open |
| 6011 | 0x177b | `OutstandingClaims` | Outstanding claims on this leg |
| 6012 | 0x177c | `DepositsDisabled` | Deposits disabled |
| 6013 | 0x177d | `UnexpectedExtensionSet` | Mint does not carry the expected extension set |
| 6014 | 0x177e | `HookNotNull` | Transfer hook program is not null |
| 6015 | 0x177f | `VaultFrozen` | Vault account frozen |
| 6016 | 0x1780 | `MathOverflow` | Math overflow |
| 6017 | 0x1781 | `ChunkTooLarge` | Chunk larger than max_convert_chunk |
| 6018 | 0x1782 | `InvalidAccount` | Account does not match the basket's records |
| 6019 | 0x1783 | `Unauthorized` | Signer not authorised for this action |
| 6020 | 0x1784 | `NoClaim` | No claim on this leg |
| 6021 | 0x1785 | `RouteViolation` | Route spent more than allowed or touched a basket account it may not |
| 6022 | 0x1786 | `LegsStillLanded` | Deposit ticket still holds landed legs; unwind them first |
| 6023 | 0x1787 | `RouterNotPending` | Router allowlist full or router not pending |
| 6024 | 0x1788 | `InvalidArgument` | Invalid argument |

</div>

A wrong-length array argument fails with `MathOverflow` (6016), as spec 02 specifies.

Two Token-2022 errors matter here too: `MintPaused` (0x43), which a paused mint returns for any transfer, and `AccountFrozen` (0x11), for a frozen account.

## Events

Anchor events, written to the transaction log (`programs/basket/src/events.rs`). The SDK and the valuation service decode them.

| Event | Fields | Emitted by |
|---|---|---|
| `ShortfallObserved` | `leg`, `expected`, `actual`, `loss_index`, `slot` | any instruction that observes a leg whose balance fell |
| `SurplusObserved` | `leg`, `expected`, `actual`, `slot` | any instruction that observes a leg whose balance rose |
| `Minted` | `owner`, `shares`, `deltas` (per leg), `path` (`InKind`, `Ticket` or `Bootstrap`) | `bootstrap`, `deposit_in_kind`, `finalize_deposit` |
| `Redeemed` | `owner`, `ticket`, `shares`, `paid` (per leg, the measured amount received), `claims_mask` | `redeem` |
| `ClaimCreated` | `owner`, `ticket`, `leg`, `units`, `reason` | `redeem`, for each unavailable leg |
| `ClaimSettled` | `owner`, `ticket`, `leg`, `units`, `amount` (gross from the vault), `received` (the owner's measured receipt) | `settle_claim`, `settle_leg_usdc` |
| `LegListing` | `leg`, `convert_after`, `deadline` | `flag_listing` |
| `LegConverted` | `leg`, `amount`, `usdc` | `convert_listed_leg` |
| `LegRetired` | `leg` | `convert_listed_leg`, when the leg is empty |
| `RouterProposed` | `router`, `effective_ts` | `propose_router` |

In `settle_leg_usdc`, `ClaimSettled.amount` is the leg amount the sale debited from the vault and `received` is the owner's measured USDC.

<div class="sources">

Sources: `programs/basket/src/lib.rs`, `state.rs`, `errors.rs`, `events.rs`; `programs/basket/idl/basket.json`; `Anchor.toml`; `tests/program/devnet/deploy.json`, `canonical.json`; `docs/specs/02-onchain-interface.md` (*Constants*, *Errors*, *Authority*).

</div>
