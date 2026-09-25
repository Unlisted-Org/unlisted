#!/usr/bin/env python3
"""Build docs/proven.md: every proven claim, each with its signature or transcript.

Records are read from the git branches that own them (program, app, ops, main)
with `git show`, so this runs from the main checkout before or after the merges.
The script then:
- re-checks every signature it cites, and every signature in every devnet record
  it cites, with getSignatureStatuses on the right network;
- exits non-zero, writing nothing, if any is missing, failed, or not finalized.

Usage: python3 evidence/build-proven.py [--out docs/proven.md]
"""
import json, re, subprocess, sys, time, urllib.request
from datetime import datetime, timezone

DEVNET = "https://api.devnet.solana.com"
MAINNET = "https://api.mainnet-beta.solana.com"
B58 = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{86,88}$")
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "docs/proven.md"

# Branch that owns each path prefix before merge; after merge, main has them all.
OWNER = [("tests/program/", "program"), ("programs/", "program"), ("app/", "app"), ("sdk/", "app"),
         ("fixtures/", "ops"), ("services/", "ops"), ("scripts/", "ops")]

def ref_for(path):
    for prefix, branch in OWNER:
        if path.startswith(prefix):
            return branch
    return "main"

def J(path):
    return json.loads(subprocess.check_output(["git", "show", f"{ref_for(path)}:{path}"]))

def T(path):
    return subprocess.check_output(["git", "show", f"{ref_for(path)}:{path}"]).decode()

devnet_cited, mainnet_cited, devnet_records = {}, {}, set()

def D(sig, slot=None):
    """A cited devnet signature, rendered in full."""
    assert B58.match(sig), sig
    devnet_cited[sig] = slot
    return f"`{sig}`" + (f" (slot {int(slot):,})" if slot else "")

def M(sig):
    assert B58.match(sig), sig
    mainnet_cited[sig] = None
    return f"`{sig}`"

def rec(path):
    """Link to a record (relative to docs/), and register it for a full signature sweep."""
    if path.endswith(".json") and ("devnet" in path or path.startswith("fixtures/")):
        devnet_records.add(path)
    return f"[`{path}`](../{path})"

def step(steps, needle, key="label"):
    hits = [s for s in steps if needle in str(s.get(key, ""))]
    if not hits:
        sys.exit(f"no step matching {needle!r}")
    return hits[0]

def S(steps, needle, key="label"):
    s = step(steps, needle, key)
    sig = s.get("signature") or (s.get("signatures") or [None])[0]
    return D(sig, s.get("slot"))

def rpc(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
            r = json.load(urllib.request.urlopen(req, timeout=60))
        except Exception:
            time.sleep(10 * (attempt + 1))
            continue
        if "result" in r:
            return r["result"]
        if r.get("error", {}).get("code") != 429:
            sys.exit(f"RPC {method} on {url}: {r.get('error')}")
        time.sleep(10 * (attempt + 1))
    sys.exit(f"RPC {method} failed on {url}")

def verify(url, sigs):
    sigs, bad = list(sigs), []
    for i in range(0, len(sigs), 200):
        chunk = sigs[i:i + 200]
        vals = rpc(url, "getSignatureStatuses", [chunk, {"searchTransactionHistory": True}])["value"]
        for s, v in zip(chunk, vals):
            if not v or v.get("err") is not None or v.get("confirmationStatus") != "finalized":
                bad.append((s, v))
        time.sleep(2)
    return bad

def all_sigs(o):
    if isinstance(o, dict):
        for v in o.values(): yield from all_sigs(v)
    elif isinstance(o, list):
        for v in o: yield from all_sigs(v)
    elif isinstance(o, str) and B58.match(o):
        yield o

P = "tests/program/devnet/"
out = []
w = out.append

# ---------------------------------------------------------------- program
deploy = J(P + "deploy.json")
w("## 1. The program is deployed on devnet\n")
w(f"- **Program** `{deploy['program']}`. Deploy {D(deploy['deploySignature'], deploy['slot'])}. {rec(P + 'deploy.json')}")
w(f"- **The deployed bytes are the tested build:** sha256 `{deploy['sha256']}` for both `solana program dump` of the deployed program and the `basket.so` the tests ran against.\n")

# ---------------------------------------------------------------- pause
pmr = J(P + "pause-mid-redemption.json"); st = pmr["steps"]
w("## 2. A pause in one name doesn't lock the basket\n")
w(f"**On A's devnet fixture mints** ({rec(P + 'pause-mid-redemption.json')}):")
w(f"- The issuer pauses ANTHROPIC: {S(st, 'ISSUER pauses ANTHROPIC')}.")
w(f"- A redemption goes through during the pause: six legs are paid and ANTHROPIC becomes a claim: {S(st, 'six legs paid, one claim')}.")
w(f"- `settle_claim` while ANTHROPIC is still paused is refused (simulated, not landed).")
w(f"- The issuer resumes ANTHROPIC ({S(st, 'ISSUER resumes ANTHROPIC')}), and a third party settles the claim: {S(st, 'bob (a third party) settles')}.")
w(f"- With two legs paused (ANDURIL {S(st, 'ISSUER pauses ANDURIL')}, KALSHI {S(st, 'ISSUER pauses KALSHI')}), a redemption pays five legs and creates two claims: {S(st, 'five paid, two claims')}.")
w(f"- **A seizure while a claim is open:** the issuer seizes ANDURIL from the vault ({S(st, 'ISSUER seizes')}), and `observe` records the shortfall: {S(st, 'observe: ShortfallObserved')}.\n")

b4 = J("app/e2e/runs/2026-09-24-devnet.json")["runs"][3]; bs = b4["steps"]
red = step(bs, "redeem", "step"); settle = step(bs, "settle the ANTHROPIC claim", "step")
w(f"**In a real browser, by a fresh wallet**, on the canonical basket with C's fixture mints ({rec('app/e2e/runs/2026-09-24-devnet.json')}, run 4):")
w(f"- The wallet `{b4['wallet']['address']}` was created for this run.")
w(f"- The issuer pauses ANTHROPIC: {S(bs, 'issuer pauses ANTHROPIC', 'step')}.")
w(f"- A redemption made in the app pays six legs, and ANTHROPIC becomes a claim: {S(bs, 'redeem', 'step')}.")
w(f"- The issuer resumes ANTHROPIC ({S(bs, 'issuer resumes', 'step')}), and the app settles the claim: {S(bs, 'settle the ANTHROPIC claim', 'step')}. The wallet received {int(settle['checks']['received']):,} raw, exactly the app's estimate.")
w(f"- Screenshots of the open claim and then the settled claim: `app/e2e/runs/2026-09-24-devnet-1-claim-open.png`, `…-2-claim-settled.png`.\n")

rp = J("services/valuation/verify/out/redeem-payout-devnet-2026-09-24T22-25-36-664Z.json")
w(f"**Measured against the valuation API**, on the canonical basket with KALSHI paused ({rec('services/valuation/verify/out/redeem-payout-devnet-2026-09-24T22-25-36-664Z.json')}):")
w(f"- The redemption paid every leg exactly as the API had quoted it, to the unit: {D(rp['redeem_signature'], rp['redeem_slot'])}.")
w(f"- After resume, the claim settled for exactly the API's valuation of it ({int(rp['claim_settlement']['api_entitlement_now_raw']):,} raw): {D(rp['claim_settlement']['signature'], rp['claim_settlement']['slot'])}.\n")

# ---------------------------------------------------------------- seizure
sz = J(P + "seizure.json"); st = sz["steps"]
w("## 3. A seizure is observed and shared pro rata, not hidden\n")
w(f"**On A's devnet fixture mints** ({rec(P + 'seizure.json')}):")
w(f"- The issuer's permanent delegate burns NEURALINK from the vault, without the vault signing: {S(st, 'ISSUER seizes')}.")
w(f"- `observe` (anyone can call it) emits `ShortfallObserved`: {S(st, 'observe (permissionless)')}.")
w(f"- A redemption pays NEURALINK pro rata less, and every other leg in full: {S(st, 'alice redeems half')}.")
w(f"- A later depositor mints at the reduced composition and doesn't top up the seized leg: {S(st, 'bob deposits in kind at the reduced')}.\n")
cz = J("fixtures/scenarios/seizure.json")["runs"][0]["steps"][0]
w(f"**On C's fixtures:** a permanent-delegate burn from a stand-in vault, {D(cz['signature'], cz['slot'])} ({rec('fixtures/scenarios/seizure.json')}).\n")

# ---------------------------------------------------------------- other issuer actions
w("## 4. Every other issuer action degrades one leg, not the basket\n")
fv = J(P + "frozen-vault.json")["steps"]; hk = J(P + "hook-switched-on.json")["steps"]; mc = J(P + "multiplier-change-mid-position.json")["steps"]
w(f"**On A's devnet fixture mints:**")
w(f"- **Frozen vault** ({rec(P + 'frozen-vault.json')}):")
w(f"  - the issuer freezes the FIGUREAI vault: {S(fv, 'ISSUER freezes')};")
w(f"  - a redemption pays six legs, and FIGUREAI becomes a claim: {S(fv, 'alice redeems')};")
w(f"  - after the thaw ({S(fv, 'ISSUER thaws')}), the claim settles: {S(fv, 'the claim settles')}.")
w(f"  - A deposit, and a settle, while the vault is frozen are refused (simulated).")
w(f"- **Transfer hook switched on** ({rec(P + 'hook-switched-on.json')}):")
w(f"  - the issuer sets a hook on POLYMARKET: {S(hk, 'ISSUER sets POLYMARKET transfer hook to Memo')};")
w(f"  - a redemption pays six legs, and POLYMARKET becomes a claim: {S(hk, 'alice redeems')};")
w(f"  - after the hook is removed ({S(hk, 'transfer hook to null')}), the claim settles: {S(hk, 'hook removed')}.")
w(f"- **Display multiplier change** ({rec(P + 'multiplier-change-mid-position.json')}):")
w(f"  - the issuer changes OPENAI's multiplier: {S(mc, 'update-ui-amount-multiplier')};")
w(f"  - raw payouts are identical before ({S(mc, 'redeem before')}) and after ({S(mc, 'redeem after')}), because the program never reads the multiplier.")

fc = J(P + "fee-change-mid-position.json"); fst = fc["steps"]
w(f"- **Transfer fee change, 100 → 300 bps** ({rec(P + 'fee-change-mid-position.json')}):")
w(f"  - the issuer schedules 300 bps: {S(fst, 'legs 0..3')} and {S(fst, 'legs 4..6')};")
w(f"  - before it takes effect, a redemption pays under the older 100 bps: {S(fst, 'alice redeems with the new fee scheduled')}.")
after = [s for s in fst if s.get("signature") and s.get("slot") and int(s["slot"]) > int(step(fst, "alice redeems with the new fee scheduled")["slot"])]
if after:
    w(f"  - **After epoch 1167** (the new fee in force):")
    for s in after:
        w(f"    - {s['label']}: {D(s['signature'], s['slot'])}.")
else:
    w(f"  - *Not yet proven:* the redemption after epoch 1167, under the new 300 bps. See section 12.")

w(f"\n**On C's fixtures, on the canonical basket**, in a window the spec owner granted. Each action was reversed, and the reversal confirmed on chain ({rec('fixtures/scenarios/restored-checks.json')}):")
for f, label in [("pause-resume.json", "Pause / resume (KALSHI)"), ("hook-switched-on.json", "Hook on / off (FIGUREAI)"),
                 ("default-state-change.json", "Default account state frozen / back (OPENAI)"), ("multiplier-change.json", "Multiplier 2 / back to 1 (NEURALINK)")]:
    runs = J("fixtures/scenarios/" + f)["runs"][:2]
    sigs = " → ".join(D(r["steps"][0]["signature"], r["steps"][0]["slot"]) for r in runs)
    w(f"- {label}: {sigs} ({rec('fixtures/scenarios/' + f)})")
mul = J("fixtures/scenarios/multiplier-change.json")["runs"][2]["steps"][0]
w(f"- NEURALINK's stored multiplier field reset to mainnet's value: {D(mul['signature'], mul['slot'])}.")
for f, label in [("frozen-vault.json", "Freeze / thaw a stand-in vault (ANTHROPIC)")]:
    runs = J("fixtures/scenarios/" + f)["runs"][:2]
    w(f"- {label}: " + " → ".join(D(r["steps"][0]["signature"], r["steps"][0]["slot"]) for r in runs) + f" ({rec('fixtures/scenarios/' + f)})")
fee = J("fixtures/scenarios/fee-change.json")["runs"][0]["steps"][0]
w(f"- The fixture fee 100 → 300 bps is scheduled for devnet epoch 1167, mirroring mainnet's epoch 1043: {D(fee['signature'], fee['slot'])} ({rec('fixtures/scenarios/fee-change.json')}).\n")

# ---------------------------------------------------------------- deposits
cn = J(P + "canonical.json"); td = cn["ticketDeposit"]["steps"]
w("## 5. Deposits: in kind, through a USDC ticket, and refunded\n")
w(f"**The canonical basket** `GJueMRWMqH8AMRBD8JP1qXS3vBGAAsjeyNWrYBzeWwJV`, over C's seven fixture mints ({rec(P + 'canonical.json')}):")
w(f"- `initialize_basket`: {S(cn['steps'], 'initialize_basket')}.")
w(f"- Bootstrap: {S(cn['steps'], 'bootstrap')}.")
w(f"- A USDC ticket deposit through `fixture_amm`:")
w(f"  - open: {S(td, 'open_deposit_ticket')};")
w(f"  - five legs: {S(td, '×5')};")
w(f"  - two legs: {S(td, '×2')};")
w(f"  - `finalize_deposit`: {S(td, 'finalize_deposit')}.\n")
dk = step(bs, "deposit in kind", "step"); dt = step(bs, "deposit 10 USDC", "step")
w(f"**In the browser (B's run 4):**")
w(f"- An in-kind deposit minted {int(dk['checks']['sharesMinted']):,} shares, exactly as the app predicted: {D(dk['signatures'][0], dk['slot'])}.")
w(f"- A 10 USDC ticket deposit took {dt['checks']['transactions']} transactions: {D(dt['signatures'][0])}, {D(dt['signatures'][1], dt['slot'])}.\n")
rf = J(P + "refund-path.json")["steps"]
w(f"**The refund path** ({rec(P + 'refund-path.json')}):")
w(f"- Three legs landed ({S(rf, 'ticket_swap_leg ×3')}) and were unwound: {S(rf, 'unwind_leg OPENAI')}, {S(rf, 'unwind_leg ANTHROPIC')}, {S(rf, 'unwind_leg NEURALINK')}.")
w(f"- `abort_deposit` returned the escrow and every lamport of rent to the owner: {S(rf, 'abort_deposit (escrow')}.")
w(f"- **Broken version (a)**, an abort before unwinding, was refused by the program (`LegsStillLanded`).")
w(f"- **Broken version (b)**, an abort that skips a ticket-owned account, is accepted by the program. The record's check caught it. This is recorded in spec 02 as a known limitation; the app always passes every ticket-owned account, and a check asserts that none is left.\n")

# ---------------------------------------------------------------- fork
fk = J("tests/program/fork/transcript-final7.json"); fs = fk["steps"]
w("## 6. The Jupiter path works against the real PreStocks mints (mainnet fork)\n")
w(f"The fork was taken with Surfpool {fk['surfpool']['surfnet-version']} at mainnet slot **{fk['forkStartSlot']:,}** (epoch {fk['forkStartSlot'] // 432000}). Transcript: {rec('tests/program/fork/transcript-final7.json')}. Fork signatures exist only on the fork, so they're cited by transcript rather than explorer.")
w(f"- `initialize_basket` over the seven real PreStocks mints, with Jupiter v6 as the router.")
w(f"- A full USDC deposit in **4 transactions** at CPI depth **4**: transactions of 50, 46, 45 and 48 accounts, with no intermediate account left open after finalize.")
w(f"- `redeem` in USDC mode, then `settle_leg_usdc` on all seven legs over live Jupiter routes.")
w(f"- `flag_listing` on ANDURIL; `convert_listed_leg` before the notice ends is refused (`0x177a`).")
w(f"- After a time jump to epoch {fk['timeTravel']['epoch']}, past mainnet's epoch-1043 fee change:")
w(f"  - ANDURIL is converted to USDC and retired;")
w(f"  - `reinvest_reserve` buys the six remaining legs, each receiving at least its minimum output;")
w(f"  - the reserve ends at {fk['afterReinvest']['reserve']}.")
w(f"- The mainnet simulation of the prop-AMM route from a program-owned taker is in {rec('tests/program/fork/mainnet-prop-amm-sim.json')}.\n")

# ---------------------------------------------------------------- valuation
w("## 7. Pricing without an oracle: the valuation API matches the chain\n")
bvr = "services/valuation/verify/out/basket-vs-rpc-devnet-2026-09-24T22-31-00-833Z.json"; b = J(bvr)
w(f"- **`/v1/basket` against an independent decode of the account bytes:** all {len(b['checks'])} fields match, bracketed at devnet slots {b['rpc_slots'][0]:,}–{b['rpc_slots'][1]:,} and mainnet slots {b['mainnet_slots'][0]:,}–{b['mainnet_slots'][1]:,} ({rec(bvr)}).")
rk = J("services/valuation/verify/out/redeem-payout-devnet-2026-09-24T22-24-15-036Z.json")
w(f"- **`/v1/quote/redeem` against a real in-kind redemption, to the unit on every leg:** {D(rk['redeem_signature'], rk['redeem_slot'])}. The paused-leg case is in section 2.")
md = J("services/valuation/verify/out/multiplier-display-devnet-2026-09-24T22-30-24-840Z.json")
w(f"- **A multiplier change moves display fields only, and only after its effective time:** read at slots {', '.join(f'{v:,}' for v in md['slots'].values())}.")
w(f"- **`sell_now` against mainnet `simulateTransaction`:** 7 of 7 legs within 0.1% (`services/valuation/verify/out/sell-sim-*.json`).")
w(f"- **Every one of these checks fails when broken on purpose:** reading the stored multiplier instead of the effective one, rounding up, and allowing Manifest routes. The failing outputs are the `*MUTATION*` and `sell-sim-negative-*` files alongside.\n")

# ---------------------------------------------------------------- fixtures
diff = T("fixtures/DIFF.md")
m1 = re.search(r"\*\*Mainnet\*\* read at slot \*\*([\d]+)\*\*", diff); m2 = re.search(r"\*\*Fixtures \(devnet\)\*\* read at slot \*\*([\d]+)\*\*", diff)
w("## 8. The fixtures mirror the real mints\n")
w(f"`fixtures/DIFF.md` compares every fixture mint with its PreStocks mint, from live reads at mainnet slot **{int(m1.group(1)):,}** and devnet slot **{int(m2.group(1)):,}**:")
w("- the extension set is identical on all seven legs;")
w("- the fee now and pending, the effective multiplier, pause, hook and default state all match;")
w("- every remaining field difference is listed with its reason.")
w("")
w(f"`--check` exits non-zero on any mismatch. It has caught two real faults, both fixed. `fixture_amm` swaps: 14 on devnet, each delivering exactly the program's predicted amount ({rec('fixtures/amm/swaps.devnet.json')}).\n")

# ---------------------------------------------------------------- mainnet record
w("## 9. What the issuer has done on mainnet\n")
risks = T("docs/risks.md"); ev = T("evidence/README.md")
fee_rows = re.findall(r"^\| ([A-Z]+) \| `([1-9A-HJ-NP-Za-km-z]{86,88})` \|$", risks, re.M)
if len(fee_rows) != 7:
    sys.exit(f"expected 7 fee-change rows in docs/risks.md, found {len(fee_rows)}")
seize_sigs = [s for s in dict.fromkeys(re.findall(r"[1-9A-HJ-NP-Za-km-z]{86,88}", ev)) if s in risks]
w("- **The fee set to 300 bps on all seven mints,** effective from epoch 1043, one transaction per mint (details in [risks §1](risks.md#1-the-fee-three-changes-in-sixteen-days)):")
for name, s in fee_rows:
    w(f"  - {name}: {M(s)}")
w("- **Seizure:** on 2025-09-19 the permanent delegate emptied 29 holder accounts. Two example transactions ([evidence §3](../evidence/README.md#3-the-issuer-has-already-used-the-seizure-power-mainnet-verified)):")
for s in seize_sigs:
    w(f"  - {M(s)}")
w("")

# ---------------------------------------------------------------- symmetry
sp = J("evidence/symmetry-fork/out/pause.json"); sz2 = J("evidence/symmetry-fork/out/seize.json"); rc = J("evidence/symmetry-fork/out/mainnet-recon.json")
held = lambda d: sum(int(v) for k, v in d.items() if not k.startswith("So111"))
w("## 10. Symmetry breaks when the issuer acts (mainnet fork, Symmetry's own program)\n")
w(f"- **Pause one constituent mid-redemption:** the shares are burned, the redemption fails while paused, and the user receives {held(sp['wallet_received_while_paused'])} constituent tokens until the resume ({rec('evidence/symmetry-fork/out/pause.json')}).")
w(f"- **Seize one constituent from the vault:** the redemption fails, and the user receives {held(sz2['wallet_received'])} constituent tokens ({rec('evidence/symmetry-fork/out/seize.json')}).")
w(f"- **Live mainnet read at slot {rc['slot']:,}:** {rc['vaults_scanned']} Symmetry vaults scanned; recorded holdings disagree with actual balances ({rec('evidence/symmetry-fork/out/mainnet-recon.json')}).")
w("- **Reproduce:** `cd evidence/symmetry-fork; ./run.sh`. These signatures exist only on the fork.\n")

# ---------------------------------------------------------------- local, supporting
w("## 11. Supporting evidence (local runs; not proof by spec 00's definition)\n")
w("Each of these was run against a deliberately broken version and seen to fail. They support the proofs above; they aren't proofs themselves.")
w("- **Reference model:** 17 property tests in `spec/model/`. Deliberately breaking any rule makes them fail.")
w("- **LiteSVM suite, run against the real `basket.so`:**")
w("  - 34 of 34 tests pass (`tests/program/out/litesvm-all-tests.log`);")
w("  - each of 4 mutants (redeem-rounds-up, ticket-escapes-shortfall, pay-paused-leg, no-loss-index) makes at least one test fail (`tests/program/out/mutants.log`).")
w("- **App and SDK:**")
w("  - SDK unit tests pass 35/35, and three SDK mutants are each killed;")
w("  - B's localnet browser runs kill six mutants at the intended assertion (`app/e2e/runs/2026-09-24-localnet-mutations.json`).")
w("  - One of the SDK mutants (open tickets ignoring the loss index) first survived; it was killed by a test added for it.")
w("- **C's router-via-CPI forwarding test** passed only on a local validator.\n")

# ---------------------------------------------------------------- open
w("## 12. Not yet proven\n")
if after:
    w("Nothing. Every item above is proven.\n")
else:
    w("- **The redemption under the new fee after devnet epoch 1167** (the second half of `fee-change-mid-position`). The fee change is scheduled on chain; the redemption can only run once the epoch begins.\n")

# ---------------------------------------------------------------- verify
for p in sorted(devnet_records):
    for s in all_sigs(J(p)):
        devnet_cited.setdefault(s, None)
bad_d = verify(DEVNET, devnet_cited); bad_m = verify(MAINNET, mainnet_cited)
if bad_d or bad_m:
    for s, v in bad_d + bad_m:
        print("NOT FINALIZED-OK:", s, v, file=sys.stderr)
    sys.exit(1)
dslot = rpc(DEVNET, "getSlot", [{"commitment": "finalized"}]); mslot = rpc(MAINNET, "getSlot", [{"commitment": "finalized"}])
now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

head = f"""# What Unlisted has proven

The single source for the pitch and the README. Each item is backed by one of:
- a **devnet transaction signature**, which you can look up on any explorer with `?cluster=devnet`;
- a **mainnet-fork transcript**, with its fork slot;
- a **browser run by a fresh wallet**;
- a **figure read live at a stated slot**.

Anything not proven that way is either in section 11, labelled as local, or in section 12, labelled as not proven.

**Verified {now}:**
- **{len(devnet_cited)} devnet signatures:** every signature cited here, plus every signature in every devnet record linked here. All are finalized without error, checked at devnet slot {dslot:,}.
- **{len(mainnet_cited)} mainnet signatures:** all finalized without error, checked at mainnet slot {mslot:,}.

Re-run the check with `python3 evidence/build-proven.py`. It rewrites this file, or exits with an error if any signature fails. Never sign mainnet transactions to reproduce anything here; everything that writes runs on devnet or a local fork.

**Addresses (devnet):**
- program `GyiHodshTGFo7hXSXGQiHLTCzH9yF2QWWHy6s7sm6QQv`;
- canonical basket `GJueMRWMqH8AMRBD8JP1qXS3vBGAAsjeyNWrYBzeWwJV`;
- share mint `HjpaxrkjftbtcRJuyAEm7oR8scasnWNxKNgnN26p7iqj`;
- fixture mints in `fixtures/registry.json`.

"""
open(OUT, "w").write(head + "\n".join(out) + "\n")
print(f"wrote {OUT}: {len(devnet_cited)} devnet + {len(mainnet_cited)} mainnet signatures verified; open items: {'none' if after else 'epoch-1167 fee redemption'}")
