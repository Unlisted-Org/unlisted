"""Generate shared test vectors from the reference model (spec/model/basket_model.py).

Runs every test in spec/model/test_basket_model.py *unchanged*, with the model's Basket swapped for a
recording subclass. Every top-level operation a test performs on a basket (and every direct change of a
leg's `available` / `fee_bps`) is written out with the model's result and full post-state, so the
on-chain program can replay the same operations and be compared to the unit.

Output: tests/program/vectors/out/<TestClass>.<test_name>.json  (one file per model test, plus the four
        INITIAL_SHARES variants from variants_initial_shares.py, named ...__initial_shares_1e9)
        tests/program/vectors/out/summary.json                   (test -> scenarios, ops, and pass/fail)
Run:    python3 tests/program/vectors/gen_vectors.py
"""

import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "spec", "model"))

import basket_model as bm  # noqa: E402
import test_basket_model as tbm  # noqa: E402

OUT = os.path.join(HERE, "out")

_current = None  # the scenario list of the running test


class RecLeg(bm.Leg):
    def __setattr__(self, name, value):
        rec = self.__dict__.get("_rec")
        if rec is not None and name in ("available", "fee_bps") and rec._depth == 0:
            old = getattr(self, name)
            object.__setattr__(self, name, value)
            if old != value:
                rec._log({"op": "set_available" if name == "available" else "set_fee",
                      "args": {"leg": self.__dict__["_idx"], "value": value}})
            return
        object.__setattr__(self, name, value)


def _top(fn):
    """Record a top-level call (calls made from inside other model methods are not recorded)."""
    def wrapper(self, *args, **kwargs):
        if self._depth > 0:
            return fn(self, *args, **kwargs)
        self._depth += 1
        n_events = len(self.events)
        entry = {"op": fn.__name__, "args": self._enc_args(fn.__name__, args, kwargs)}
        saved = self._save()
        try:
            result = fn(self, *args, **kwargs)
        except bm.Refused as e:
            # A refused instruction reverts on chain, so the recorded model reverts too (in place).
            self._restore(saved, n_events)
            self._depth -= 1
            entry["refused"] = str(e)
            self._log(entry)
            raise
        self._depth -= 1
        entry["result"] = self._enc_result(fn.__name__, result)
        entry["events"] = [list(ev) for ev in self.events[n_events:]]
        self._log(entry)
        return result
    wrapper.__name__ = fn.__name__
    return wrapper


class RecBasket(bm.Basket):
    def __init__(self, n_legs, fee_bps=100):
        self._depth = 1
        super().__init__(n_legs, fee_bps)
        self.legs = []
        for i in range(n_legs):
            leg = RecLeg(fee_bps=fee_bps)
            leg.__dict__["_idx"] = i
            self.legs.append(leg)
        self._ops = []
        self._ids = {}
        for leg in self.legs:
            leg.__dict__["_rec"] = self
        self._depth = 0
        _current.append({"n_legs": n_legs, "fee_bps": fee_bps, "ops": self._ops})

    _FIELDS = ("balance", "accounted", "claim_units", "pending_norm", "loss_index", "available", "retired", "fee_bps")

    def _save(self):
        return ([{f: getattr(l, f) for f in self._FIELDS} for l in self.legs],
                dict(self.shares), self.supply, self.usdc_reserve)

    def _restore(self, saved, n_events):
        legs, shares, supply, reserve = saved
        for l, v in zip(self.legs, legs):
            for f, x in v.items():
                object.__setattr__(l, f, x)
        self.shares.clear()
        self.shares.update(shares)
        self.supply, self.usdc_reserve = supply, reserve
        del self.events[n_events:]

    # ids for tickets and claims, by object identity
    def _id(self, obj, prefix):
        k = id(obj)
        if k not in self._ids:
            self._ids[k] = (f"{prefix}{len(self._ids)}", obj)
        return self._ids[k][0]

    def _enc_args(self, name, args, kwargs):
        a = list(args)
        if name in ("bootstrap", "mint_in_kind"):
            owner, gross = a[0], a[1]
            d = {"owner": owner, "gross": [str(gross[i]) for i in range(len(self.legs))]}
            if name == "bootstrap":
                d["initial_shares"] = str(kwargs.get("initial_shares", a[2] if len(a) > 2 else None))
            else:
                d["min_shares"] = str(kwargs.get("min_shares", a[2] if len(a) > 2 else 0))
            return d
        if name == "open_ticket":
            return {"owner": a[0]}
        if name == "ticket_leg_lands":
            return {"ticket": self._id(a[0], "t"), "leg": a[1], "gross": str(a[2])}
        if name == "finalize_ticket":
            return {"ticket": self._id(a[0], "t"), "min_shares": str(kwargs.get("min_shares", a[1] if len(a) > 1 else 0))}
        if name in ("redeem_in_kind", "redeem_pending_sale"):
            return {"owner": a[0], "shares": str(a[1])}
        if name == "settle_claim":
            return {"claim": self._id(a[0], "c"), "leg": a[0].leg, "owner": a[0].owner, "units": str(a[0].units)}
        if name in ("external_seize", "external_donate"):
            return {"leg": a[0], "amount": str(a[1])}
        if name == "observe":
            return {"leg": a[0]}
        if name == "convert_listed_leg":
            return {"leg": a[0], "price_micro": str(kwargs.get("usdc_per_raw_unit_micro", a[1] if len(a) > 1 else None))}
        if name == "reinvest_reserve":
            return {"gross_out": {str(k): str(v) for k, v in a[0].items()}}
        raise ValueError(name)

    def _enc_result(self, name, r):
        if name in ("bootstrap", "mint_in_kind", "finalize_ticket", "ticket_leg_lands", "settle_claim",
                    "convert_listed_leg"):
            return str(r)
        if name == "open_ticket":
            return self._id(r, "t")
        if name == "redeem_in_kind":
            paid, claims = r
            return {"paid": {str(k): str(v) for k, v in paid.items()},
                    "claims": [{"id": self._id(c, "c"), "leg": c.leg, "units": str(c.units)} for c in claims]}
        if name == "redeem_pending_sale":
            return {"claims": [{"id": self._id(c, "c"), "leg": c.leg, "units": str(c.units)} for c in r]}
        return None

    def _snapshot(self):
        return {
            "legs": [{"balance": str(l.balance), "accounted": str(l.accounted), "claim_units": str(l.claim_units),
                      "pending_norm": str(l.pending_norm), "loss_index": str(l.loss_index),
                      "available": l.available, "retired": l.retired, "fee_bps": l.fee_bps} for l in self.legs],
            "supply": str(self.supply),
            "shares": {o: str(s) for o, s in self.shares.items()},
            "usdc_reserve": str(self.usdc_reserve),
        }

    def _log(self, entry):
        # consecutive observes collapse into one on-chain `observe` with a leg mask
        if entry.get("op") == "observe" and self._ops and self._ops[-1]["op"] == "observe" \
                and entry["args"]["leg"] not in self._ops[-1]["args"]["legs"]:
            prev = self._ops[-1]
            prev["args"]["legs"].append(entry["args"]["leg"])
            prev["events"] += entry.get("events", [])
            prev["state"] = self._snapshot()
            return
        if entry.get("op") == "observe":
            entry["args"] = {"legs": [entry["args"]["leg"]]}
        entry["state"] = self._snapshot()
        self._ops.append(entry)


for _name in ("bootstrap", "mint_in_kind", "open_ticket", "ticket_leg_lands", "finalize_ticket",
              "redeem_in_kind", "redeem_pending_sale", "settle_claim", "external_seize", "external_donate",
              "observe", "convert_listed_leg", "reinvest_reserve"):
    setattr(RecBasket, _name, _top(getattr(bm.Basket, _name)))


def main():
    os.makedirs(OUT, exist_ok=True)
    tbm.Basket = RecBasket  # the tests construct baskets through this name
    sys.path.insert(0, HERE)
    import variants_initial_shares as var
    loader = unittest.TestLoader()
    suite = unittest.TestSuite([loader.loadTestsFromModule(tbm), loader.loadTestsFromModule(var)])
    summary = {}
    global _current
    def flat(x):
        if isinstance(x, unittest.TestSuite):
            for y in x:
                yield from flat(y)
        else:
            yield x

    for test in flat(suite):
        if True:
            name = test.id().split(".", 1)[1]  # Class.test_name (variants: ...__initial_shares_1e9)
            _current = []
            res = unittest.TestResult()
            test.run(res)
            ok = res.wasSuccessful()
            with open(os.path.join(OUT, f"{name}.json"), "w") as f:
                json.dump({"test": name, "model_passed": ok, "scenarios": _current}, f, separators=(",", ":"))
            summary[name] = {"model_passed": ok, "scenarios": len(_current),
                             "ops": sum(len(s["ops"]) for s in _current)}
            print(f"{'ok ' if ok else 'FAIL'} {name}: {len(_current)} scenarios, {summary[name]['ops']} ops")
            if not ok:
                for _, tb in res.failures + res.errors:
                    print(tb)
    with open(os.path.join(OUT, "summary.json"), "w") as f:
        json.dump(summary, f, indent=1, sort_keys=True)
    if not all(v["model_passed"] for v in summary.values()) or len(summary) != 17 + 4:
        sys.exit(1)


if __name__ == "__main__":
    main()
