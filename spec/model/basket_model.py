"""Reference model of the basket's share accounting (spec 01).

This is the executable form of docs/specs/01-shares-and-pricing.md. The on-chain
program must produce the same integer results for the same inputs; agent A ports the
tests in test_basket_model.py to the program's test suite.

All amounts are raw token units (integers). No prices appear anywhere.
Every division rounds toward the vault (floor on anything paid out or credited).
"""

from dataclasses import dataclass, field

BPS = 10_000
INDEX_ONE = 10**18  # fixed-point 1.0 for the per-leg loss index


def transfer_fee(amount: int, fee_bps: int) -> int:
    """Token-2022 fee: ceil(amount * bps / 10_000), uncapped (PreStocks maximumFee = u64::MAX)."""
    if fee_bps == 0 or amount == 0:
        return 0
    return (amount * fee_bps + BPS - 1) // BPS


class Refused(Exception):
    """The program refuses the instruction (maps to an error code in spec 02)."""


@dataclass
class Leg:
    fee_bps: int = 100
    balance: int = 0          # actual vault token-account amount (the truth)
    accounted: int = 0        # what the program expects the balance to be
    claim_units: int = 0      # C_i: burned shares still owed leg i
    pending_norm: int = 0     # open deposit-ticket deltas, normalised by the loss index
    loss_index: int = INDEX_ONE  # L_i: multiplied down by every observed shortfall
    available: bool = True    # False when paused, hook set, or vault account frozen
    retired: bool = False     # leg converted after its company listed


@dataclass
class Ticket:
    """Open USDC deposit ticket: per-leg deltas already in the vault, not yet shares."""
    owner: str
    norm: dict = field(default_factory=dict)  # leg -> normalised delta


@dataclass
class Claim:
    """Redemption leg that could not be paid (leg unavailable): burned shares owed on that leg."""
    owner: str
    leg: int
    units: int


class Basket:
    def __init__(self, n_legs: int, fee_bps: int = 100):
        self.legs = [Leg(fee_bps=fee_bps) for _ in range(n_legs)]
        self.shares: dict[str, int] = {}
        self.supply = 0
        self.usdc_reserve = 0  # only non-zero during an IPO conversion
        self.events: list[tuple] = []

    # ---------- observation: the balance is the truth ----------

    def observe(self, i: int) -> None:
        """Reconcile leg i against its actual balance. Called first by every instruction touching leg i."""
        leg = self.legs[i]
        if leg.balance < leg.accounted:
            shortfall = leg.accounted - leg.balance
            # Everyone with a claim on the leg (holders, claimants, open tickets) bears it pro rata:
            # holders and claimants through balance/(supply+claims); tickets through the index.
            leg.loss_index = leg.loss_index * leg.balance // leg.accounted
            self.events.append(("ShortfallObserved", i, leg.accounted, leg.balance, shortfall))
        elif leg.balance > leg.accounted:
            self.events.append(("SurplusObserved", i, leg.accounted, leg.balance, leg.balance - leg.accounted))
        leg.accounted = leg.balance

    def pending_actual(self, i: int) -> int:
        leg = self.legs[i]
        return leg.pending_norm * leg.loss_index // INDEX_ONE

    def owned(self, i: int) -> int:
        """Leg i balance that belongs to shares and claims (excludes open tickets)."""
        return self.legs[i].balance - self.pending_actual(i)

    def denominator(self, i: int) -> int:
        return self.supply + self.legs[i].claim_units

    def active_legs(self):
        return [i for i, l in enumerate(self.legs) if not l.retired]

    # ---------- vault token movements (what Token-2022 does) ----------

    def _vault_receives(self, i: int, gross: int) -> int:
        leg = self.legs[i]
        net = gross - transfer_fee(gross, leg.fee_bps)
        leg.balance += net
        leg.accounted += net
        return net  # the measured delta

    def _vault_sends(self, i: int, amount: int) -> int:
        leg = self.legs[i]
        assert amount <= leg.balance
        leg.balance -= amount
        leg.accounted -= amount
        return amount - transfer_fee(amount, leg.fee_bps)  # what the recipient receives

    def external_seize(self, i: int, amount: int) -> None:
        """Permanent-delegate burn: balance drops, the program is not told."""
        self.legs[i].balance -= min(amount, self.legs[i].balance)

    def external_donate(self, i: int, amount: int) -> None:
        self.legs[i].balance += amount

    # ---------- mint ----------

    def _shares_for(self, deltas: dict[int, int]) -> int:
        """m = min over active legs of floor(delta_i * (S + C_i) / owned_i)."""
        m = None
        for i in self.active_legs():
            own = self.owned(i) - deltas[i]  # owned before this deposit landed
            if own <= 0:
                raise Refused("LegEmpty")
            cand = deltas[i] * self.denominator(i) // own
            m = cand if m is None else min(m, cand)
        return m

    def bootstrap(self, owner: str, gross: dict[int, int], initial_shares: int) -> int:
        if self.supply != 0:
            raise Refused("AlreadyBootstrapped")
        for i in self.active_legs():
            self.observe(i)
            self._vault_receives(i, gross[i])
        self.supply = initial_shares
        self.shares[owner] = self.shares.get(owner, 0) + initial_shares
        return initial_shares

    def mint_in_kind(self, owner: str, gross: dict[int, int], min_shares: int = 0) -> int:
        for i in self.active_legs():
            self.observe(i)
            if not self.legs[i].available:
                raise Refused("LegUnavailable")
        deltas = {i: self._vault_receives(i, gross[i]) for i in self.active_legs()}
        m = self._shares_for(deltas)
        if m < max(min_shares, 1):
            raise Refused("SlippageExceeded")
        self.supply += m
        self.shares[owner] = self.shares.get(owner, 0) + m
        return m

    def open_ticket(self, owner: str) -> Ticket:
        for i in self.active_legs():
            self.observe(i)
            if not self.legs[i].available:
                raise Refused("LegUnavailable")
        return Ticket(owner=owner)

    def ticket_leg_lands(self, t: Ticket, i: int, gross_from_pool: int) -> int:
        """A swap leg's output arrives straight in the vault; the measured delta is credited to the ticket."""
        self.observe(i)
        if not self.legs[i].available:
            raise Refused("LegUnavailable")
        delta = self._vault_receives(i, gross_from_pool)
        norm = delta * INDEX_ONE // self.legs[i].loss_index
        t.norm[i] = t.norm.get(i, 0) + norm
        self.legs[i].pending_norm += norm
        return delta

    def finalize_ticket(self, t: Ticket, min_shares: int = 0) -> int:
        for i in self.active_legs():
            self.observe(i)
            if i not in t.norm:
                raise Refused("TicketIncomplete")
        deltas = {}
        for i in self.active_legs():
            leg = self.legs[i]
            deltas[i] = t.norm[i] * leg.loss_index // INDEX_ONE  # ticket bears any shortfall pro rata
            leg.pending_norm -= t.norm[i]
        m = None
        for i in self.active_legs():
            own = self.owned(i) - deltas[i]
            if own <= 0:
                raise Refused("LegEmpty")
            cand = deltas[i] * self.denominator(i) // own
            m = cand if m is None else min(m, cand)
        if m < max(min_shares, 1):
            raise Refused("SlippageExceeded")
        self.supply += m
        self.shares[t.owner] = self.shares.get(t.owner, 0) + m
        t.norm = {}
        return m

    # ---------- redeem (partial on unavailable legs) ----------

    def redeem_in_kind(self, owner: str, s: int) -> tuple[dict[int, int], list[Claim]]:
        """Burn s shares. Available legs pay now; each unavailable leg becomes a claim on that leg."""
        if s <= 0 or self.shares.get(owner, 0) < s:
            raise Refused("InsufficientShares")
        for i in self.active_legs():
            self.observe(i)
        paid, claims = {}, []
        supply_before = self.supply
        for i in self.active_legs():
            leg = self.legs[i]
            if leg.available:
                out = s * self.owned(i) // (supply_before + leg.claim_units)
                paid[i] = self._vault_sends(i, out)
            else:
                leg.claim_units += s
                claims.append(Claim(owner=owner, leg=i, units=s))
                self.events.append(("ClaimCreated", owner, i, s))
        self.shares[owner] -= s
        self.supply -= s
        if self.usdc_reserve:
            usdc = s * self.usdc_reserve // supply_before
            self.usdc_reserve -= usdc
            paid["usdc"] = usdc
        return paid, claims

    def redeem_pending_sale(self, owner: str, s: int) -> list[Claim]:
        """USDC-mode redemption: every leg becomes a claim of s units, settled later by a sale (or in kind)."""
        if s <= 0 or self.shares.get(owner, 0) < s:
            raise Refused("InsufficientShares")
        claims = []
        for i in self.active_legs():
            self.observe(i)
            self.legs[i].claim_units += s
            claims.append(Claim(owner=owner, leg=i, units=s))
        self.shares[owner] -= s
        self.supply -= s
        return claims

    def settle_claim(self, c: Claim) -> int:
        """Permissionless once the leg is available again. Pays the claim's pro-rata share of the leg as it is now."""
        self.observe(c.leg)
        leg = self.legs[c.leg]
        if not leg.available:
            raise Refused("LegUnavailable")
        out = c.units * self.owned(c.leg) // self.denominator(c.leg)
        leg.claim_units -= c.units
        received = self._vault_sends(c.leg, out)
        c.units = 0
        return received

    # ---------- IPO rule: sell the listed leg, reinvest equally across the rest ----------

    def convert_listed_leg(self, i: int, usdc_per_raw_unit_micro: int) -> int:
        """Permissionless after the notice period. Sells the whole leg (the pool receives amount - fee)."""
        self.observe(i)
        leg = self.legs[i]
        if leg.claim_units:
            raise Refused("OutstandingClaims")  # claims on the leg settle first
        amount = self.owned(i)
        pool_receives = self._vault_sends(i, amount)
        usdc = pool_receives * usdc_per_raw_unit_micro // 10**6
        self.usdc_reserve += usdc
        leg.retired = True
        self.events.append(("LegConverted", i, amount, usdc))
        return usdc

    def reinvest_reserve(self, gross_out_per_leg: dict[int, int]) -> None:
        """Equal-USDC split across remaining legs; caller supplies each leg's swap output (measured)."""
        for i in self.active_legs():
            self.observe(i)
            self._vault_receives(i, gross_out_per_leg[i])
        self.usdc_reserve = 0

    # ---------- views ----------

    def per_share(self, i: int) -> tuple[int, int]:
        """Exact rational (numerator, denominator) for leg i per share."""
        return self.owned(i), self.denominator(i)

    def holder_claim(self, owner: str, i: int) -> int:
        return self.shares.get(owner, 0) * self.owned(i) // self.denominator(i)
