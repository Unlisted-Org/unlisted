"""Shared test vectors for /v1/quote/redeem, generated from the reference model (spec/model).

Random sequences of mints, tickets, pauses, seizures, donations and fee changes on a 7-leg model basket.
Before every redeem (in kind, and USDC mode settled immediately) the full state is dumped together with
what the MODEL paid. services/valuation/test/sharemath.test.ts recomputes the quote from the dumped state
with the API's code and must match the model to the unit.

  python3 services/valuation/test/gen_redeem_vectors.py > services/valuation/test/redeem_vectors.json
"""
import json, os, random, sys, copy
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "spec", "model"))
import basket_model as bm  # noqa: E402

def dump(b):
    return {"supply": str(b.supply), "legs": [{"balance": str(l.balance), "accounted": str(l.accounted), "claim_units": str(l.claim_units),
            "pending_norm": str(l.pending_norm), "loss_index": str(l.loss_index), "available": l.available, "fee_bps": l.fee_bps,
            "retired": l.retired} for l in b.legs]}

def run(seed):
    r = random.Random(seed)
    b = bm.Basket(7, fee_bps=r.choice([0, 50, 100, 300]))
    b.bootstrap("boot", {i: r.randint(10**6, 10**12) for i in range(7)}, 1_000_000_000)
    vectors, tickets = [], []
    holders = ["boot"]
    for step in range(40):
        op = r.random()
        try:
            if op < 0.2:
                o = f"u{r.randint(0, 5)}"
                frac = r.uniform(0.001, 0.5)
                gross = {i: max(1, int(b.owned(i) * frac * 1.02) + 1) for i in b.active_legs()}
                b.mint_in_kind(o, gross); holders.append(o)
            elif op < 0.28:
                t = b.open_ticket(f"t{step}")
                for i in b.active_legs():
                    b.ticket_leg_lands(t, i, max(1, int(b.owned(i) * r.uniform(0.01, 0.2))))
                tickets.append(t)
            elif op < 0.33 and tickets:
                b.finalize_ticket(tickets.pop(r.randrange(len(tickets)))); holders.append("x")
            elif op < 0.43:
                i = r.randrange(7); b.legs[i].available = not b.legs[i].available
            elif op < 0.50:
                i = r.randrange(7); b.external_seize(i, int(b.legs[i].balance * r.uniform(0, 0.3)))
            elif op < 0.55:
                i = r.randrange(7); b.external_donate(i, r.randint(1, 10**6))
            elif op < 0.60:
                i = r.randrange(7); b.legs[i].fee_bps = r.choice([0, 50, 100, 300])
            else:
                owners = [o for o, s in b.shares.items() if s > 0]
                if not owners: continue
                o = r.choice(owners)
                s = r.randint(1, b.shares[o])
                mode = r.choice(["in_kind", "usdc"])
                before = dump(b)
                if mode == "in_kind":
                    bal = [l.balance for l in b.legs]
                    paid, claims = b.redeem_in_kind(o, s)
                    res = {"legs": [{"index": i, "action": "pay", "gross": str(bal[i] - b.legs[i].balance), "net": str(paid[i])} for i in paid if i != "usdc"]
                           + [{"index": c.leg, "action": "claim", "units": str(c.units)} for c in claims]}
                else:
                    # USDC mode: every leg becomes a PendingSale claim; settle the available ones immediately
                    # (what "gross_raw if settled now" promises), in leg order, as a cranker would.
                    claims = b.redeem_pending_sale(o, s)
                    legs = []
                    for c in claims:
                        if b.legs[c.leg].available:
                            bal = b.legs[c.leg].balance
                            net = b.settle_claim(c)
                            legs.append({"index": c.leg, "action": "pending_sale", "gross": str(bal - b.legs[c.leg].balance), "net": str(net), "units": str(s)})
                        else:
                            legs.append({"index": c.leg, "action": "claim", "units": str(s)})
                    res = {"legs": legs}
                vectors.append({"seed": seed, "step": step, "mode": mode, "shares": str(s), "state": before, "model": res})
        except bm.Refused:
            pass
    return vectors

out = []
for seed in range(150):
    out.extend(run(seed))
json.dump({"generator": "services/valuation/test/gen_redeem_vectors.py", "model": "spec/model/basket_model.py", "vectors": out}, sys.stdout)
