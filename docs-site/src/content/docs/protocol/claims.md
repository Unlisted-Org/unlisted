---
title: Claims and settlement
description: How a claim is created, what it is owed, who can settle it and when, and the devnet runs for each unavailable-leg case.
---

A **claim** is what a redemption leaves behind for a leg it couldn't pay. This is the mechanism that lets a redemption go through while the issuer has one company paused.

## How a claim is created

`redeem(shares, mode)` looks at every active leg. For each leg that is **unavailable**, it:

1. adds `shares` to the leg's claim units, `C_i`;
2. records `Claim { units: shares, reason }` in the redemption ticket, where the reason is `Paused`, `Hook` or `Frozen`;
3. emits `ClaimCreated { owner, ticket, leg, units, reason }`.

In a USDC-mode redemption, every **available** leg also becomes a claim, with reason `PendingSale`, settled by a sale ([below](#settling-a-pending-sale)). `ClaimCreated` is emitted only for the unavailable legs.

## What a claim is owed

A claim stores **units, not an amount**. At settlement it pays:

```
gross = floor( units × owned_i / (S + C_i) )
```

read at that moment. Because the units sit in the denominator next to the share supply, a claim has exactly the fraction of the leg that the burned shares had. It gains and loses with the leg, including through a seizure, until it settles. Other holders are unaffected while it's open: for a claimed leg, the per-share amount is `owned_i / (S − s + C_i + s)`, unchanged.

A claim is owed **one leg only**. It isn't a share and can't be transferred in v1.

## Settling a claim

**`settle_claim(leg)` is permissionless** for `Paused`, `Hook` and `Frozen` claims. Anyone can call it once the leg is available again. It:

1. checks the leg is available (`LegUnavailable` otherwise) and that the destination is the claim owner's token account for that leg;
2. runs `observe` on the leg;
3. pays `gross` in kind from the vault to the owner; the owner receives `gross` minus the transfer fee;
4. subtracts the units from `C_i`, rewrites the ticket leg as `Paid { amount: gross, received }`, and emits `ClaimSettled { owner, ticket, leg, units, amount, received }`.

When every claim on a ticket is settled, the owner can close it with `close_redemption` and recover its rent.

### Settling a pending sale

A `PendingSale` claim is settled by its owner with `settle_leg_usdc(leg, min_usdc_out, route_data)`, which sells the claim's `gross` through an allowlisted router and pays the owner in USDC, checked against `min_usdc_out`. `settle_leg_usdc` also works on a `Paused`, `Hook` or `Frozen` claim once its leg is available, for an owner who would rather have USDC.

If no route works, the owner can settle a `PendingSale` claim in kind with `settle_claim`; only the owner may do that. On a mainnet fork, a USDC-mode redemption created seven pending sales and all seven were settled over live Jupiter routes (`tests/program/fork/transcript-final7.json`).

## Every unavailable-leg case, signed on devnet

Each scenario ran against the real program on devnet, on fixture mints, with the fixture issuer taking the issuer's action. Settling while the leg was still unavailable was refused with `LegUnavailable` in every case; those attempts were simulated, so they have no signature.

### Paused

`tests/program/devnet/pause-mid-redemption.json`. A holder redeems 0.125 share with ANTHROPIC paused.

| Step | Transaction |
|---|---|
| <span class="issuer">Issuer pauses ANTHROPIC</span> | [`5v24J1Km…mcHBMzsm`](https://explorer.solana.com/tx/5v24J1KmennZW6GQNUj2iWGNLG7TqccwqQTZW7MeLZHro4JuvRfQzRcKNjw2FpQTBTT96qkQCVLCiPGcmcHBMzsm?cluster=devnet "slot 503654748") |
| Redeem: six legs paid, <span class="claim">claim of 125,000,000 units on ANTHROPIC</span> | [`2jShDvn4…MXd1dQd7`](https://explorer.solana.com/tx/2jShDvn43AK1ReyA8LJF74DDXBgiUfwagPhFRRKy3uQqji7VLFBXEADW5Fhn3rETj7kkQKJLdeKDaf66MXd1dQd7?cluster=devnet "slot 503655019") |
| Issuer resumes ANTHROPIC | [`2WYsJ97X…UrPQa3H3`](https://explorer.solana.com/tx/2WYsJ97XLasHnN6VzspzMG8kYZtH6VxKmvjNdSwPZDRAFiSn6wbeAURPR4Sjz7MPvTJcbxKs5EsxRkxUrPQa3H3?cluster=devnet "slot 503655230") |
| A third party settles: <span class="paid">123,750,000,000 gross, 122,512,500,000 received</span>, the same as every leg paid at redemption | [`4pois1iL…BKQ29cbs`](https://explorer.solana.com/tx/4pois1iLUcfHM5NQr8uotgMRGyqF6pSBWEnHC4MvcMrNss6BMAh6whjYKwC12zj7KHvaFH5tyZcSHxupBKQ29cbs?cluster=devnet "slot 503655256") |

### Two legs paused at once

Same record. With ANDURIL and KALSHI paused, a deposit is refused (`LegUnavailable`), and a redemption of 0.125 share pays five legs and creates two claims:

| Step | Transaction |
|---|---|
| <span class="issuer">Issuer pauses ANDURIL</span> | [`51mJLnop…h1Wn9vZZ`](https://explorer.solana.com/tx/51mJLnopRncY9W4fxoCPdaddJwz57PkHNDe6aXCkpxAxFUMUYPmfdYELfxN5nYC8ZHGEkrHKhX3o6SWmh1Wn9vZZ?cluster=devnet "slot 503655444") |
| <span class="issuer">Issuer pauses KALSHI</span> | [`KhphbjNd…UHaUD5pT`](https://explorer.solana.com/tx/KhphbjNd6eJctss7rLmB9KojYi8SyBBaLjr5S24UGt5TJzsTehZ2jXR1xoNvRu3D1vD4kkS4LMLBeL8UHaUD5pT?cluster=devnet "slot 503655544") |
| Redeem: five paid, <span class="claim">two claims</span> | [`2KNKJ6Q7…pxBp4EKy`](https://explorer.solana.com/tx/2KNKJ6Q7P4qCNEH6k5dPeKuxriYJybtUgoK3Nh2uvycKLsbmFX8EGjSwXXWpJHBRijnnxc1yTmeJ1k7PpxBp4EKy?cluster=devnet "slot 503655596") |

### A seizure while a claim is open

Same record, continuing. While the ANDURIL claim is open, the issuer seizes 20% of the vault's ANDURIL, and the claim bears exactly that 20%:

| Step | Transaction |
|---|---|
| <span class="issuer">Issuer burns 272,250,000,000 raw ANDURIL from the vault</span>, without the vault signing | [`3kqJ8dwV…YBEBKiat`](https://explorer.solana.com/tx/3kqJ8dwVDsbH2XngHfD5AAAu39rrGsJceonx5CdbLHv8sj54AD522scViETCVv76MixJk9SkVVyvvexiYBEBKiat?cluster=devnet "slot 503655807") |
| `observe` records it: expected 1,361,250,000,000, actual 1,089,000,000,000, loss index 0.8 | [`3b31Gkrx…mZhEBxDy`](https://explorer.solana.com/tx/3b31GkrxJZHmCCzLPb5iGZqbCQVCfFHfvogCU4RarppdQFSYj1vguPMfjWtro27SqcbzqZ76fjoNUPgmmZhEBxDy?cluster=devnet "slot 503655825") |
| After resume, the ANDURIL claim settles for **99,000,000,000 gross** (98,010,000,000 received): 80% of the 123,750,000,000 an unseized leg paid | [`665w2eBo…P9MxQbpS`](https://explorer.solana.com/tx/665w2eBorbu9xD5cfhCd84zBPHqLBBFTCFhHW1ErVtgeBiSniihzP64biFBroEr2xk4UxmdX8DtmShXTP9MxQbpS?cluster=devnet "slot 503655948") |
| The KALSHI claim, untouched by the seizure, settles for 123,750,000,000 gross | [`5HjMh1Kv…6tPwAr74`](https://explorer.solana.com/tx/5HjMh1KvgcePyhHsruS8KKgjGtWGc6yvSfZkqEcbUR3UHb554DVHHzmgTZuM3NC45rooJviHCzowAU1Z6tPwAr74?cluster=devnet "slot 503655999") |

### Frozen vault

`tests/program/devnet/frozen-vault.json`. The issuer freezes the basket's FIGUREAI vault account.

| Step | Transaction |
|---|---|
| <span class="issuer">Issuer freezes the FIGUREAI vault</span>; a deposit is then refused (`LegUnavailable`) | [`4rmpzqjT…qh3BsSXE`](https://explorer.solana.com/tx/4rmpzqjTtvEE6dnRrhdmGG28dndBH655qtdrLBkCvXVKh7c73ipigbLMmSm3pgKQKZyvpZCKLKiAp9gqqh3BsSXE?cluster=devnet "slot 503660456") |
| Redeem: six paid, <span class="claim">FIGUREAI becomes a claim</span> (reason `Frozen`) | [`5bb3tt6t…Wv9DvqGL`](https://explorer.solana.com/tx/5bb3tt6tBtskqRMd5ixAZnm4CQDcPoweHqNXLNZ7GsNRzrKmdxGjQjxbj5fL42DYvjPaJtoKeo9FPbQQWv9DvqGL?cluster=devnet "slot 503660553") |
| Issuer thaws the vault | [`5x4N3oEY…ZpyrUe94`](https://explorer.solana.com/tx/5x4N3oEYbLHJhj7yRXRvcjQxVoqvZfqLHBzSx8TMq6trPHsnBPRjnJkkFNezEgboWFFZcsNmFSj8WhjMZpyrUe94?cluster=devnet "slot 503660588") |
| The claim settles | [`3DjmwAdY…BD4gstjy`](https://explorer.solana.com/tx/3DjmwAdYYbnKwPunSjEPaARmBXELrpZBXw1NReTW1mxtQAmJuWPMMzzw9eCyDMzBCtFcgEwS8sDeN5BbBD4gstjy?cluster=devnet "slot 503660621") |

### Transfer hook switched on

`tests/program/devnet/hook-switched-on.json`. The issuer points POLYMARKET's transfer hook at the Memo program.

| Step | Transaction |
|---|---|
| <span class="issuer">Issuer sets a POLYMARKET transfer hook</span>; a deposit is then refused (`LegUnavailable`) | [`35FoPcCi…pHjXYNoo`](https://explorer.solana.com/tx/35FoPcCiBEv5JsJRiecxmKyEECqyBEExehfL8AX4pvsSNSkG9DtsS3X6KoX3xdw8c8mfGYoU13UmZXFUpHjXYNoo?cluster=devnet "slot 503660088") |
| Redeem: six paid, <span class="claim">POLYMARKET becomes a claim</span> (reason `Hook`) | [`2YDjBJSB…B4EU9fNe`](https://explorer.solana.com/tx/2YDjBJSBUubZhdJ5GjKvLsLC6XKF5cEPCLNKvSHPX4Kp2mbs2K6HUpSJRJoYKAK84u6gptuHX2QecK5KB4EU9fNe?cluster=devnet "slot 503660196") |
| Issuer sets the hook back to null | [`479Sgzoz…6qx99Tk7`](https://explorer.solana.com/tx/479Sgzoz7c68hkwQmUVeSQpNg9232G1DHv4fQLXAUfVNL27BWwi1yT9rkhiFivDoeLr2AmjPJxV8QcX66qx99Tk7?cluster=devnet "slot 503660313") |
| The claim settles | [`4G1DVR6c…o1NDXKui`](https://explorer.solana.com/tx/4G1DVR6c9LJGzkzBFDFAH9829JS17EHiQx92gUGCtGytrNgaN77Y5L2qSZGHKG8KrjTWMLmGu3rXea97o1NDXKui?cluster=devnet "slot 503660332") |

**If a hook stayed on permanently,** claims on that leg couldn't settle until a program upgrade adds reviewed hook support. That would be a governance action; it isn't built.

### Checked against the valuation API

On the canonical basket, with KALSHI paused by the fixture issuer, a redemption paid every available leg exactly as `/v1/quote/redeem` had quoted it, to the unit. After the resume, the KALSHI claim settled for exactly the API's valuation of it, **558,478 raw** (`services/valuation/verify/out/redeem-payout-devnet-2026-09-24T22-25-36-664Z.json`):

- redemption: [`at9q4HaD…LEPntmxT`](https://explorer.solana.com/tx/at9q4HaDD3SoomXPoYmXcymbNQtkyst5JRAcquHmKEEDrad3ZUhjztm15wwm3PD7oAq5XACTJYP3nCcLEPntmxT?cluster=devnet "slot 503682859");
- claim settlement: [`3eeuqYAy…fCPMgH9Y`](https://explorer.solana.com/tx/3eeuqYAyX1rwkg1cNQS8QqdnPbGVrBimBJ8kP533HVEMee5zmM8uJpyTQSH9VohA9WnPMXJxFbCeE1LkfCPMgH9Y?cluster=devnet "slot 503683092").

<div class="sources">

Sources: `docs/specs/01-shares-and-pricing.md` (*Redeem*); `docs/specs/02-onchain-interface.md`; `programs/basket/src/lib.rs` (`redeem`, `settle_claim`, `settle_leg_usdc`, `close_redemption`); `tests/program/devnet/pause-mid-redemption.json`, `frozen-vault.json`, `hook-switched-on.json`; `tests/program/fork/transcript-final7.json`; `services/valuation/verify/out/redeem-payout-devnet-2026-09-24T22-25-36-664Z.json`.

</div>
