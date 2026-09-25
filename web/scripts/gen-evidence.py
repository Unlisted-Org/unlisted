#!/usr/bin/env python3
"""Generate lib/evidence.json for the landing page from the committed records on each branch.
Every signature is copied programmatically from its record; scripts/verify-evidence.mjs then
checks each one on chain (finalized, no error, and at the recorded slot)."""
import json, re, subprocess, sys, os
REPO = subprocess.check_output(["git", "rev-parse", "--show-toplevel"]).decode().strip()
OWNER = [("tests/program/", "program"), ("app/", "app"), ("fixtures/", "ops"), ("services/", "ops")]
def ref_for(p):
    for pre, b in OWNER:
        if p.startswith(pre): return b
    return "main"
def J(p): return json.loads(subprocess.check_output(["git", "-C", REPO, "show", f"{ref_for(p)}:{p}"]))
def T(p): return subprocess.check_output(["git", "-C", REPO, "show", f"main:{p}"]).decode()
def step(steps, needle, key="label"):
    for s in steps:
        if needle in str(s.get(key, "")): return s
    sys.exit(f"missing step {needle!r}")
def tx(s, label, record, network="devnet"):
    sig = s.get("signature") or (s.get("signatures") or [None])[0]
    return {"label": label, "signature": sig, "slot": int(s["slot"]) if s.get("slot") else None, "network": network, "record": record}
E = {}
P = "tests/program/devnet/"
pmr = J(P + "pause-mid-redemption.json")["steps"]; r = P + "pause-mid-redemption.json"
E["survive"] = [
    tx(step(pmr, "ISSUER pauses ANTHROPIC"), "The issuer pauses ANTHROPIC", r),
    tx(step(pmr, "six legs paid, one claim"), "Redeem during the pause: six legs paid now, ANTHROPIC becomes a claim", r),
    tx(step(pmr, "ISSUER resumes ANTHROPIC"), "The issuer resumes ANTHROPIC", r),
    tx(step(pmr, "bob (a third party) settles"), "Anyone settles the claim: it pays out", r),
]
sz = J(P + "seizure.json")["steps"]; rs = P + "seizure.json"
E["seizure"] = [
    tx(step(sz, "ISSUER seizes"), "The issuer burns NEURALINK out of the vault", rs),
    tx(step(sz, "observe (permissionless)"), "Anyone records the shortfall", rs),
    tx(step(sz, "alice redeems half"), "Redemption: NEURALINK pays pro rata less, the rest in full", rs),
]
b4 = J("app/e2e/runs/2026-09-24-devnet.json")["runs"][3]; bs = b4["steps"]; rb = "app/e2e/runs/2026-09-24-devnet.json"
red = step(bs, "redeem", "step")
E["browser"] = {"wallet": b4["wallet"]["address"], "steps": [
    tx(step(bs, "deposit in kind", "step"), "Deposit in kind from a fresh wallet", rb),
    tx(step(bs, "issuer pauses ANTHROPIC", "step"), "The issuer pauses ANTHROPIC", rb),
    tx(red, "Redeem in the app: six legs paid, one claim", rb),
    tx(step(bs, "settle the ANTHROPIC claim", "step"), "Settle the claim after the resume", rb),
], "paidNow": red["checks"]["paidNow"], "claim": red["checks"].get("claim"), "settled": step(bs, "settle the ANTHROPIC claim", "step")["checks"]}
E["proofTable"] = []
for f, rows in [("frozen-vault.json", [("ISSUER freezes", "Freeze the vault"), ("alice redeems", "Redeem: six paid, one claim"), ("the claim settles", "Thaw: claim settles")]),
                ("hook-switched-on.json", [("POLYMARKET transfer hook to Memo", "Switch on a transfer hook"), ("alice redeems", "Redeem: six paid, one claim"), ("hook removed", "Hook off: claim settles")]),
                ("multiplier-change-mid-position.json", [("update-ui-amount-multiplier", "Change the display multiplier"), ("redeem after", "Redeem: raw payout unchanged")]),
                ("fee-change-mid-position.json", [("legs 0..3", "Schedule the fee 100 → 300 bps"), ("alice redeems with the new fee scheduled", "Redeem under the current fee")])]:
    st = J(P + f)["steps"]
    for needle, label in rows: E["proofTable"].append(dict(tx(step(st, needle), label, P + f), scenario=f.replace(".json", "")))
cn = J(P + "canonical.json")
E["deposit"] = [tx(step(cn["ticketDeposit"]["steps"], "open_deposit_ticket"), "Open a USDC deposit ticket", P + "canonical.json"),
                tx(step(cn["ticketDeposit"]["steps"], "finalize_deposit"), "Finalize: shares minted, leftovers refunded", P + "canonical.json")]
rf = J(P + "refund-path.json")["steps"]
E["deposit"].append(tx(step(rf, "abort_deposit (escrow"), "Abort: every unit and every lamport of rent returned", P + "refund-path.json"))
d = J(P + "deploy.json"); E["deploy"] = {"program": d["program"], "signature": d["deploySignature"], "slot": int(d["slot"]), "sha256": d["sha256"], "network": "devnet"}
# mainnet: parsed from docs/risks.md tables
risks = T("docs/risks.md"); ev = T("evidence/README.md")
E["feeChanges"] = [{"mint": m, "signature": s, "network": "mainnet"} for m, s in re.findall(r"^\| ([A-Z]+) \| `([1-9A-HJ-NP-Za-km-z]{86,88})` \|$", risks, re.M)]
E["multiplier"] = [{"mint": m, "multiplier": x, "signed": a.strip(), "effective": b.strip(), "warning": w.strip(), "signature": s, "network": "mainnet"}
    for m, x, a, b, w, s in re.findall(r"^\| (OPENAI|SPACEX) \([^)]*\) \| ([\d.]+) \| ([^|]+) \| ([^|]+) \| \*{0,2}([^|*]+?)\*{0,2} \| `([1-9A-HJ-NP-Za-km-z]{86,88})` \|$", risks, re.M)]
E["seizureMainnet"] = [{"signature": s, "network": "mainnet"} for s in dict.fromkeys(re.findall(r"[1-9A-HJ-NP-Za-km-z]{86,88}", ev)) if s in risks]
fk = J("tests/program/fork/transcript-final7.json"); E["fork"] = {"forkStartSlot": fk["forkStartSlot"], "record": "tests/program/fork/transcript-final7.json"}
sp = J("evidence/symmetry-fork/out/pause.json"); se = J("evidence/symmetry-fork/out/seize.json"); rc = J("evidence/symmetry-fork/out/mainnet-recon.json")
held = lambda dd: sum(int(v) for k, v in dd.items() if not k.startswith("So111"))
E["symmetry"] = {"program": sp["symmetry_program"], "pauseReceived": held(sp["wallet_received_while_paused"]), "seizeReceived": held(se["wallet_received"]),
    "pauseSteps": [{"step": s.get("step"), "ok": s.get("ok")} for s in sp["steps"]], "seizeSteps": [{"step": s.get("step"), "ok": s.get("ok")} for s in se["steps"]],
    "reconSlot": rc["slot"], "vaultsScanned": rc["vaults_scanned"]}
for k in ["feeChanges", "multiplier", "seizureMainnet"]:
    if not E[k]: sys.exit(f"empty {k}")
out = os.path.join(os.path.dirname(__file__), "..", "lib", "evidence.json")
json.dump(E, open(out, "w"), indent=1); print("wrote", os.path.relpath(out), "| signatures:", len(re.findall(r'"signature": "', json.dumps(E, indent=1))))
