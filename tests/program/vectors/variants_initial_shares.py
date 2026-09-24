"""INITIAL_SHARES variants of four model tests.

Spec 02 (ruling of 2026-09-25) fixes `bootstrap` at INITIAL_SHARES = 1_000_000_000 shares. Four tests in
spec/model/test_basket_model.py bootstrap with another share count (3 or 10**12), which the program cannot
reproduce. Each is re-stated here with 10**9 initial shares: token amounts and assertions are the originals,
share quantities are scaled by the same factor (10**12 -> 10**9), and the floor test uses a composition whose
exact per-share amount is fractional (3.333333334) so floor and ceil still differ. Both the originals (in the
model) and these variants (in the model and on chain) must pass.
"""
import unittest

import test_basket_model as tbm

N = tbm.N


class RoundingFavoursVault(unittest.TestCase):
    def test_redeem_pays_floor__initial_shares_1e9(self):
        b = tbm.Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 3_333_333_334 for i in range(N)}, initial_shares=10**9)
        paid, _ = b.redeem_in_kind("seed", 1)
        self.assertEqual(paid[0], 3)  # floor(1 * 3_333_333_334 / 10**9), not 4
        self.assertEqual(b.legs[0].balance, 3_333_333_331)


class Shortfall(unittest.TestCase):
    def test_open_ticket_bears_shortfall_pro_rata__initial_shares_1e9(self):
        b = tbm.Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 10**12 for i in range(N)}, initial_shares=10**9)
        t = b.open_ticket("u")
        for i in range(N):
            b.ticket_leg_lands(t, i, 10**12)
        b.external_seize(0, 10**12)
        m = b.finalize_ticket(t)
        self.assertEqual(m, 10**9)
        self.assertEqual(b.holder_claim("seed", 0), 5 * 10**11)
        self.assertEqual(b.holder_claim("u", 0), 5 * 10**11)
        self.assertEqual(b.holder_claim("u", 1), 10**12)


class PartialRedemption(unittest.TestCase):
    def test_claim_shares_a_later_seizure_pro_rata__initial_shares_1e9(self):
        b = tbm.Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 10**12 for i in range(N)}, initial_shares=10**9)
        b.mint_in_kind("u", {i: 10**12 for i in range(N)})
        b.legs[3].available = False
        _, [claim] = b.redeem_in_kind("u", 10**9)
        b.external_seize(3, 10**12)
        b.legs[3].available = True
        self.assertEqual(b.settle_claim(claim), 5 * 10**11)
        self.assertEqual(b.holder_claim("seed", 3), 5 * 10**11)


class IpoRule(unittest.TestCase):
    def test_redeem_during_conversion_gets_pro_rata_usdc__initial_shares_1e9(self):
        b = tbm.Basket(N, fee_bps=0)
        b.bootstrap("seed", {i: 10**12 for i in range(N)}, initial_shares=10**9)
        b.mint_in_kind("u", {i: 10**12 for i in range(N)})
        b.convert_listed_leg(0, 2 * 10**6)
        paid, _ = b.redeem_in_kind("u", 10**9)
        self.assertEqual(paid["usdc"], 2 * 10**12 * 2 // 2)
        self.assertNotIn(0, paid)
