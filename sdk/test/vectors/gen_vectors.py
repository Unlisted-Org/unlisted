"""Shared test vectors for the SDK's share maths, produced by the reference model.

Runs random operation sequences on spec/model/basket_model.py (the spec's executable
form) and records, for every operation, the state before it, its arguments and the
model's result. test/math.test.ts recomputes each result from the recorded state with
the SDK's pure functions and requires equality to the unit.

Run from sdk/: python3 test/vectors/gen_vectors.py > test/vectors/vectors.json
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "spec", "model"))
from basket_model import Basket, Refused, transfer_fee  # noqa: E402

N = 7


def snap(b):
    return {
        "supply": str(b.supply),
        "legs": [
            {
                "balance": str(l.balance),
                "accounted": str(l.accounted),
                "claimUnits": str(l.claim_units),
                "pendingNorm": str(l.pending_norm),
                "lossIndex": str(l.loss_index),
                "available": l.available,
                "feeBps": l.fee_bps,
            }
            for l in b.legs
        ],
    }


def s(d):
    return {str(k): str(v) for k, v in d.items()}


def main():
    vectors = []
    for seed in range(120):
        rng = random.Random(1000 + seed)
        b = Basket(N, fee_bps=rng.choice([0, 100, 300]))
        b.bootstrap("seed", {i: rng.randint(10**9, 10**12) for i in range(N)}, initial_shares=10**9)
        claims = []
        tickets = []
        for _ in range(30):
            op = rng.choice(["mint", "redeem", "redeem", "pause", "resume", "settle", "settle", "seize", "donate", "ticket", "fee", "observe"])
            pre = snap(b)
            try:
                if op == "mint":
                    pct = rng.randint(1, 30)
                    gross = {i: b.owned(i) * pct // 100 + rng.randint(0, 10**5) for i in range(N)}
                    try:
                        m = b.mint_in_kind(rng.choice(list(b.shares)), gross)
                        vectors.append({"op": "mint_in_kind", "pre": pre, "gross": [str(gross[i]) for i in range(N)], "shares": str(m)})
                    except Refused as e:
                        vectors.append({"op": "mint_in_kind", "pre": pre, "gross": [str(gross[i]) for i in range(N)], "refused": str(e)})
                elif op == "redeem":
                    holders = [o for o in b.shares if b.shares[o] > 1]
                    if not holders:
                        continue
                    o = rng.choice(holders)
                    amt = rng.randint(1, b.shares[o] // 2 + 1)
                    fees = [l.fee_bps for l in b.legs]
                    gross_before = [l.balance for l in b.legs]
                    paid, cl = b.redeem_in_kind(o, amt)
                    claims += cl
                    out = []
                    for i in range(N):
                        if i in paid:
                            g = gross_before[i] - b.legs[i].balance
                            out.append({"action": "pay", "gross": str(g), "net": str(paid[i]), "fee": str(transfer_fee(g, fees[i]))})
                        else:
                            out.append({"action": "claim", "units": str(amt)})
                    vectors.append({"op": "redeem_in_kind", "pre": pre, "shares": str(amt), "legs": out})
                elif op == "pause":
                    b.legs[rng.randrange(N)].available = False
                elif op == "resume":
                    b.legs[rng.randrange(N)].available = True
                elif op == "settle" and claims:
                    c = rng.choice(claims)
                    if not c.units:
                        continue
                    if rng.random() < 0.6:
                        b.legs[c.leg].available = True  # resume, so settlements are exercised
                        pre = snap(b)
                    units = c.units
                    before = b.legs[c.leg].balance
                    try:
                        net = b.settle_claim(c)
                        vectors.append({"op": "settle_claim", "pre": pre, "leg": c.leg, "units": str(units),
                                        "gross": str(before - b.legs[c.leg].balance), "net": str(net)})
                    except Refused as e:
                        vectors.append({"op": "settle_claim", "pre": pre, "leg": c.leg, "units": str(units), "refused": str(e)})
                elif op == "seize":
                    i = rng.randrange(N)
                    b.external_seize(i, b.legs[i].balance * rng.randint(1, 60) // 100)
                    if rng.random() < 0.7:  # the permissionless observe instruction, right after a seizure
                        pre = snap(b)
                        b.observe(i)
                        vectors.append({"op": "observe", "pre": pre, "leg": i, "post": snap(b)["legs"][i]})
                elif op == "donate":
                    b.external_donate(rng.randrange(N), rng.randint(1, 10**8))
                elif op == "observe":
                    i = rng.randrange(N)
                    b.observe(i)
                    vectors.append({"op": "observe", "pre": pre, "leg": i, "post": snap(b)["legs"][i]})
                elif op == "ticket":
                    try:
                        t = b.open_ticket("tk")
                    except Refused:
                        continue
                    lands = []
                    for i in range(N):
                        g = b.owned(i) * rng.randint(1, 10) // 100 + 10**6
                        lpre = snap(b)["legs"][i]
                        delta = b.ticket_leg_lands(t, i, g)
                        lands.append({"leg": i, "legPre": lpre, "gross": str(g), "delta": str(delta), "norm": str(t.norm[i])})
                    if rng.random() < 0.4:
                        i = rng.randrange(N)
                        b.external_seize(i, b.legs[i].balance * rng.randint(1, 30) // 100)
                    pre_fin = snap(b)
                    norms = [str(t.norm[i]) for i in range(N)]
                    try:
                        m = b.finalize_ticket(t)
                        vectors.append({"op": "ticket", "lands": lands, "preFinalize": pre_fin, "norms": norms, "shares": str(m)})
                    except Refused as e:
                        vectors.append({"op": "ticket", "lands": lands, "preFinalize": pre_fin, "norms": norms, "refused": str(e)})
                elif op == "fee":
                    b.legs[rng.randrange(N)].fee_bps = rng.choice([0, 20, 50, 100, 300])
            except Refused:
                pass
    json.dump({"generator": "sdk/test/vectors/gen_vectors.py over spec/model/basket_model.py", "count": len(vectors), "vectors": vectors}, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
