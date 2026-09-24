"""Property tests for the share-accounting reference model (spec 01).

Run: python3 -m unittest spec/model/test_basket_model.py -v
Deterministic: every randomised test uses fixed seeds.
"""

import random
import unittest
from fractions import Fraction

from basket_model import Basket, Claim, Refused, transfer_fee

N = 7  # seven names


def rand_amounts(rng, lo=10**6, hi=10**12):
    return {i: rng.randint(lo, hi) for i in range(N)}


def entitlements(b: Basket, claims, tickets, i):
    holders = sum(b.holder_claim(o, i) for o in b.shares)
    cl = sum(c.units * b.owned(i) // b.denominator(i) for c in claims if c.leg == i and c.units)
    return holders + cl + b.pending_actual(i)


def per_share(b, i):
    own, den = b.per_share(i)
    return Fraction(own, den) if den else None


def seeded_basket(rng, holders=3):
    b = Basket(N)
    b.bootstrap("seed", rand_amounts(rng, 10**9, 10**12), initial_shares=10**9)
    for h in range(holders):
        ratio = rng.randint(1, 50)
        b.mint_in_kind(f"h{h}", {i: b.legs[i].balance * ratio // 100 + 10**6 for i in range(N)})
    return b


class RoundingFavoursVault(unittest.TestCase):
    def test_entitlements_never_exceed_balance(self):
        """Across random operation sequences, what everyone is owed never exceeds what the vault holds."""
        for seed in range(300):
            rng = random.Random(seed)
            b = seeded_basket(rng)
            claims, tickets = [], []
            for _ in range(40):
                op = rng.choice(["mint", "redeem", "pause", "resume", "settle", "seize", "donate", "ticket", "fee"])
                try:
                    if op == "mint":
                        base = {i: b.owned(i) for i in range(N)}
                        pct = rng.randint(1, 30)
                        b.mint_in_kind(rng.choice(list(b.shares)), {i: base[i] * pct // 100 + rng.randint(0, 10**5) for i in range(N)})
                    elif op == "redeem":
                        o = rng.choice([o for o in b.shares if b.shares[o] > 0] or ["seed"])
                        if b.shares.get(o, 0) > 1:
                            _, cl = b.redeem_in_kind(o, rng.randint(1, b.shares[o] // 2 + 1))
                            claims += cl
                    elif op == "pause":
                        b.legs[rng.randrange(N)].available = False
                    elif op == "resume":
                        b.legs[rng.randrange(N)].available = True
                    elif op == "settle" and claims:
                        c = rng.choice(claims)
                        if c.units:
                            b.settle_claim(c)
                    elif op == "seize":
                        i = rng.randrange(N)
                        b.external_seize(i, b.legs[i].balance * rng.randint(1, 60) // 100)
                    elif op == "donate":
                        b.external_donate(rng.randrange(N), rng.randint(1, 10**8))
                    elif op == "ticket":
                        t = b.open_ticket("tk")
                        for i in range(N):
                            b.ticket_leg_lands(t, i, b.owned(i) * rng.randint(1, 10) // 100 + 10**6)
                        tickets.append(t)
                        if rng.random() < 0.7:
                            b.finalize_ticket(t)
                    elif op == "fee":
                        b.legs[rng.randrange(N)].fee_bps = rng.choice([0, 20, 50, 100, 300])
                except Refused:
                    pass
                for i in range(N):
                    b.observe(i)
                    self.assertLessEqual(entitlements(b, claims, tickets, i), b.legs[i].balance,
                                         f"seed {seed} leg {i} after {op}")

    def test_mint_never_dilutes_existing_holders(self):
        for seed in range(300):
            rng = random.Random(1000 + seed)
            b = seeded_basket(rng)
            before = [per_share(b, i) for i in range(N)]
            skew = {i: b.owned(i) * rng.randint(1, 40) // 100 + rng.randint(0, 10**7) for i in range(N)}
            b.mint_in_kind("new", skew)
            for i in range(N):
                self.assertGreaterEqual(per_share(b, i), before[i], f"seed {seed} leg {i}")

    def test_redeem_never_dilutes_remaining_holders(self):
        for seed in range(300):
            rng = random.Random(2000 + seed)
            b = seeded_basket(rng)
            before = [per_share(b, i) for i in range(N)]
            o = rng.choice(list(b.shares))
            b.redeem_in_kind(o, rng.randint(1, b.shares[o]))
            for i in range(N):
                if b.denominator(i):
                    self.assertGreaterEqual(per_share(b, i), before[i], f"seed {seed} leg {i}")

    def test_redeem_pays_floor(self):
        b = Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 10 for i in range(N)}, initial_shares=3)
        paid, _ = b.redeem_in_kind("seed", 1)
        self.assertEqual(paid[0], 3)  # floor(1 * 10 / 3), not 4
        self.assertEqual(b.legs[0].balance, 7)


class TransferFee(unittest.TestCase):
    def test_mint_credits_measured_net_not_gross(self):
        b = Basket(N, fee_bps=100)
        b.bootstrap("seed", {i: 1_000_000_000 for i in range(N)}, initial_shares=1_000_000_000)
        self.assertEqual(b.legs[0].balance, 990_000_000)  # vault holds net of the 1% fee
        m = b.mint_in_kind("u", {i: 1_000_000_000 for i in range(N)})
        # The new depositor's net delta equals the existing per-share composition, so shares match 1:1.
        self.assertEqual(m, 1_000_000_000)

    def test_fee_change_mid_position_needs_no_stored_fee(self):
        """Nothing about the fee is stored; a rate change between mint and redeem changes only the recipient's net."""
        b = Basket(N, fee_bps=50)
        b.bootstrap("seed", {i: 10**12 for i in range(N)}, initial_shares=10**9)
        b.mint_in_kind("u", {i: 10**11 for i in range(N)})
        owed = b.holder_claim("u", 0)
        for l in b.legs:
            l.fee_bps = 100  # issuer raises the fee mid-position
        paid, _ = b.redeem_in_kind("u", b.shares["u"])
        self.assertEqual(paid[0], owed - transfer_fee(owed, 100))


class Shortfall(unittest.TestCase):
    def test_seizure_is_shared_pro_rata_and_observed(self):
        for seed in range(200):
            rng = random.Random(3000 + seed)
            b = seeded_basket(rng)
            i = rng.randrange(N)
            claims_before = {o: b.holder_claim(o, i) for o in b.shares}
            bal = b.legs[i].balance
            seized = bal * rng.randint(1, 90) // 100
            b.external_seize(i, seized)
            b.observe(i)
            self.assertEqual(b.events[-1][0], "ShortfallObserved")
            f = Fraction(bal - seized, bal)
            for o, before in claims_before.items():
                after = b.holder_claim(o, i)
                self.assertLessEqual(abs(after - before * f), 1, f"seed {seed} holder {o}")

    def test_later_depositors_do_not_make_holders_whole(self):
        for seed in range(200):
            rng = random.Random(4000 + seed)
            b = seeded_basket(rng)
            i = rng.randrange(N)
            b.external_seize(i, b.legs[i].balance // 2)
            b.observe(i)
            after_seizure = per_share(b, i)
            gross = {j: b.owned(j) // 5 for j in range(N)}
            b.mint_in_kind("late", gross)
            # Old holders gain at most rounding dust (two shares' worth) from the late deposit, never a
            # top-up; a top-up would be of the order of the seized half.
            self.assertLessEqual(per_share(b, i) - after_seizure, 2 * after_seizure / b.denominator(i))
            # The late depositor's claim on the seized leg is what they put in (net), minus rounding.
            net = gross[i] - transfer_fee(gross[i], 100)
            self.assertLessEqual(b.holder_claim("late", i), net)
            self.assertGreaterEqual(b.holder_claim("late", i), net * 99 // 100)

    def test_open_ticket_bears_shortfall_pro_rata(self):
        b = Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 10**12 for i in range(N)}, initial_shares=10**12)
        t = b.open_ticket("u")
        for i in range(N):
            b.ticket_leg_lands(t, i, 10**12)  # ticket doubles every leg
        b.external_seize(0, 10**12)  # half of leg 0 disappears
        m = b.finalize_ticket(t)
        # Holders and the open ticket each lose half of their leg-0 amount, so the ticket's shares are
        # unchanged (1e12) and each side ends up owning exactly half of what is left of leg 0.
        self.assertEqual(m, 10**12)
        self.assertEqual(b.holder_claim("seed", 0), 5 * 10**11)
        self.assertEqual(b.holder_claim("u", 0), 5 * 10**11)
        self.assertEqual(b.holder_claim("u", 1), 10**12)


class PartialRedemption(unittest.TestCase):
    """The headline differentiator: a paused leg does not lock the rest of the basket."""

    def _pair(self, seed):
        rng = random.Random(seed)
        a, c = seeded_basket(random.Random(seed)), seeded_basket(random.Random(seed))
        o = rng.choice(list(a.shares))
        return rng, a, c, o

    def test_available_legs_pay_immediately_and_claim_pays_after_resume(self):
        for seed in range(200):
            rng, paused, control, o = self._pair(5000 + seed)
            s = rng.randint(1, paused.shares[o])
            k = rng.randrange(N)
            paused.legs[k].available = False
            paid_p, claims = paused.redeem_in_kind(o, s)
            paid_c, _ = control.redeem_in_kind(o, s)
            self.assertEqual(len(claims), 1)
            for i in range(N):
                if i != k:
                    self.assertEqual(paid_p[i], paid_c[i], f"seed {seed} leg {i} paid immediately")
            self.assertNotIn(k, paid_p)
            paused.legs[k].available = True
            got = paused.settle_claim(claims[0])
            self.assertLessEqual(abs(got - paid_c[k]), 1, f"seed {seed} claim settles to the unpaused amount")

    def test_other_holders_unaffected_while_claim_open(self):
        for seed in range(200):
            rng, b, _, o = self._pair(6000 + seed)
            k = rng.randrange(N)
            others = [h for h in b.shares if h != o]
            before = {h: [b.holder_claim(h, i) for i in range(N)] for h in others}
            b.legs[k].available = False
            b.redeem_in_kind(o, b.shares[o])
            for h in others:
                for i in range(N):
                    self.assertGreaterEqual(b.holder_claim(h, i), before[h][i])

    def test_claim_shares_a_later_seizure_pro_rata(self):
        b = Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 10**12 for i in range(N)}, initial_shares=10**12)
        b.mint_in_kind("u", {i: 10**12 for i in range(N)})
        b.legs[3].available = False
        _, [claim] = b.redeem_in_kind("u", 10**12)
        b.external_seize(3, 10**12)  # half of leg 3 seized while the claim is open
        b.legs[3].available = True
        self.assertEqual(b.settle_claim(claim), 5 * 10**11)  # claimant takes half the loss, like the holder
        self.assertEqual(b.holder_claim("seed", 3), 5 * 10**11)

    def test_usdc_mode_claims_settle_to_the_in_kind_amounts(self):
        for seed in range(200):
            rng, a, control, o = self._pair(7000 + seed)
            s = rng.randint(1, a.shares[o])
            claims = a.redeem_pending_sale(o, s)
            paid_c, _ = control.redeem_in_kind(o, s)
            for c in claims:  # settled one by one, in any order
                got = a.settle_claim(c)
                self.assertLessEqual(abs(got - paid_c[c.leg]), 1, f"seed {seed} leg {c.leg}")

    def test_multiple_paused_legs_and_deposit_refused(self):
        b = seeded_basket(random.Random(7))
        b.legs[1].available = False
        b.legs[4].available = False
        paid, claims = b.redeem_in_kind("seed", b.shares["seed"] // 3)
        self.assertEqual(sorted(c.leg for c in claims), [1, 4])
        self.assertEqual(len([k for k in paid if isinstance(k, int)]), N - 2)
        with self.assertRaises(Refused):
            b.mint_in_kind("x", {i: 10**9 for i in range(N)})


class IpoRule(unittest.TestCase):
    def test_conversion_preserves_every_holders_fraction(self):
        for seed in range(100):
            rng = random.Random(8000 + seed)
            b = seeded_basket(rng)
            frac = {o: Fraction(s, b.supply) for o, s in b.shares.items()}
            k = rng.randrange(N)
            usdc = b.convert_listed_leg(k, usdc_per_raw_unit_micro=rng.randint(10, 10**6))
            self.assertTrue(b.legs[k].retired)
            self.assertEqual(b.owned(k), 0)
            for o, s in b.shares.items():
                self.assertEqual(Fraction(s, b.supply), frac[o])
            before = [per_share(b, i) for i in b.active_legs()]
            b.reinvest_reserve({i: usdc // len(b.active_legs()) * 1000 for i in b.active_legs()})
            for i, p in zip(b.active_legs(), before):
                self.assertGreaterEqual(per_share(b, i), p)

    def test_conversion_waits_for_open_claims(self):
        b = seeded_basket(random.Random(9))
        b.legs[2].available = False
        _, [c] = b.redeem_in_kind("seed", 10)
        b.legs[2].available = True
        with self.assertRaises(Refused):
            b.convert_listed_leg(2, 1000)
        b.settle_claim(c)
        b.convert_listed_leg(2, 1000)

    def test_redeem_during_conversion_gets_pro_rata_usdc(self):
        b = Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 10**12 for i in range(N)}, initial_shares=10**12)
        b.mint_in_kind("u", {i: 10**12 for i in range(N)})
        b.convert_listed_leg(0, 2 * 10**6)  # 2 USDC-micro per raw unit
        paid, _ = b.redeem_in_kind("u", 10**12)
        self.assertEqual(paid["usdc"], 2 * 10**12 * 2 // 2)
        self.assertNotIn(0, paid)


if __name__ == "__main__":
    unittest.main()
