// Runs one scenario against Symmetry's real program on a surfpool mainnet fork at FORK_RPC.
// Usage: node repro.js <baseline|pause|seize>   Writes out/<scenario>.json
const w3 = require('@solana/web3.js');
const st = require('@solana/spl-token');
const fs = require('fs');
const { SymmetryCore } = require('@symmetry-hq/sdk');

const FORK_RPC = process.env.FORK_RPC || 'http://localhost:8899';
const conn = new w3.Connection(FORK_RPC, 'confirmed');
const sdk = new SymmetryCore({ connection: conn, network: 'mainnet', priorityFee: 0 });

// Live Symmetry vault "NOT INSIDER TRADING" (NIT): holds xStocks, which carry the same
// pausable + permanent-delegate extensions as PreStocks.
const VAULT = 'G54nsrBx9a59YVqiqk2Sg3yX9wQauRz5MEugdWDjvmsf';
const VAULT_MINT = 'FXcxe5f3AwkJZRaoYFuGME7rEXS4NmBxZPYKVh3Q4bnD';
const NVDAX = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'; // paused in scenario "pause"
const AAPLX = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'; // seized in scenario "seize"
const SHARES_GIVEN = 100000, SHARES_REDEEMED = 50000;
const PAUSABLE_EXT = 26;

async function rpc(method, params) {
  const r = await fetch(FORK_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

async function tokenBalance(owner, mint) {
  const r = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
  return r.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n).toString();
}

async function vaultState() {
  const v = await sdk.fetchVault(VAULT);
  const legs = [];
  for (const c of v.formatted.composition) {
    const acct = await rpc('getAccountInfo', [c.mint, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]);
    const prog = acct.value.owner;
    const ata = st.getAssociatedTokenAddressSync(new w3.PublicKey(c.mint), new w3.PublicKey(VAULT), true, new w3.PublicKey(prog)).toBase58();
    const a = await rpc('getAccountInfo', [ata, { encoding: 'jsonParsed' }]);
    legs.push({ mint: c.mint, recorded: String(c.amount), actual: a.value ? a.value.data.parsed.info.tokenAmount.amount : null });
  }
  return { slot: (await rpc('getSlot', [])), supply_outstanding: String(v.formatted.supply_outstanding), legs };
}

async function setPaused(mint, paused) {
  const a = await rpc('getAccountInfo', [mint, { encoding: 'base64' }]);
  const d = Buffer.from(a.value.data[0], 'base64');
  let o = 166; // Token-2022 mint TLV region
  while (o + 4 <= d.length) {
    const t = d.readUInt16LE(o), l = d.readUInt16LE(o + 2);
    if (t === PAUSABLE_EXT) { d[o + 4 + 32] = paused ? 1 : 0; break; }
    o += 4 + l;
  }
  await rpc('surfnet_setAccount', [mint, { data: d.toString('hex') }]);
  const chk = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  return chk.value.data.parsed.info.extensions.find(e => e.extension === 'pausableConfig').state.paused;
}

async function send(seq, kp, label, log) {
  for (const b of seq.batches) for (const p of b.transactions) {
    const tx = w3.VersionedTransaction.deserialize(Buffer.from(p.tx_b64, 'base64'));
    tx.message.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign([kp]);
    try {
      const sig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction(sig, 'confirmed');
      log.push({ step: label, ok: true, signature: sig });
    } catch (e) {
      const logs = e.logs || e.transactionLogs || [];
      log.push({ step: label, ok: false, error: String(e.message).split('\n')[0].slice(0, 240), program_logs: logs.filter(l => /error|failed|paused|insufficient/i.test(l)) });
      return false;
    }
  }
  return true;
}

(async () => {
  const scenario = process.argv[2];
  if (!['baseline', 'pause', 'seize'].includes(scenario)) throw new Error('scenario must be baseline|pause|seize');
  const kp = w3.Keypair.generate(), me = kp.publicKey.toBase58();
  const out = { scenario, fork_rpc: FORK_RPC, symmetry_program: 'BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate', vault: VAULT, wallet: me, steps: [] };
  await rpc('requestAirdrop', [me, 10e9]);
  await rpc('surfnet_setTokenAccount', [me, VAULT_MINT, { amount: SHARES_GIVEN }, st.TOKEN_PROGRAM_ID.toBase58()]);
  const mints = (await sdk.fetchVault(VAULT)).formatted.composition.map(c => c.mint);
  out.vault_before = await vaultState();

  if (scenario === 'seize') {
    // What a permanent-delegate burn does to the vault: its AAPLx balance goes to zero.
    await rpc('surfnet_setTokenAccount', [VAULT, AAPLX, { amount: 0 }, st.TOKEN_2022_PROGRAM_ID.toBase58()]);
    out.steps.push({ step: 'seize: vault AAPLx balance set to 0 (simulated permanent-delegate burn)' });
    out.vault_after_seizure = await vaultState();
  }

  const sell = await sdk.sellVaultTx({ seller: me, vault_mint: VAULT_MINT, withdraw_amount: SHARES_REDEEMED, keep_tokens: mints, rebalance_slippage_bps: 100, per_trade_rebalance_slippage_bps: 100 });
  const sold = await send(sell, kp, 'sellVaultTx (burns shares, creates withdraw intent)', out.steps);
  out.wallet_shares_after_sell = await tokenBalance(me, VAULT_MINT);
  // Baseline for the wallet's own balances (the SDK wraps some of the wallet's SOL into wSOL for the keeper bounty).
  out.wallet_after_sell = Object.fromEntries(await Promise.all(mints.map(async m => [m, await tokenBalance(me, m)])));
  if (sold) {
    const intent = (await sdk.fetchOwnerRebalanceIntents(me))[0].formatted_data.pubkey;
    out.rebalance_intent = intent;
    if (scenario === 'pause') out.steps.push({ step: 'pause NVDAx mid-redemption', paused: await setPaused(NVDAX, true) });
    await send(await sdk.redeemTokensTx({ keeper: me, rebalance_intent: intent }), kp, 'redeemTokensTx', out.steps);
    if (scenario === 'pause') {
      await send(await sdk.redeemTokensTx({ keeper: me, rebalance_intent: intent }), kp, 'redeemTokensTx retry (still paused)', out.steps);
      out.wallet_received_while_paused = Object.fromEntries(await Promise.all(mints.map(async m => [m, await tokenBalance(me, m)])));
      out.steps.push({ step: 'resume NVDAx', paused: await setPaused(NVDAX, false) });
      await send(await sdk.redeemTokensTx({ keeper: me, rebalance_intent: intent }), kp, 'redeemTokensTx after resume', out.steps);
    }
  }
  out.wallet_received = Object.fromEntries(await Promise.all(mints.map(async m => [m, await tokenBalance(me, m)])));
  out.vault_after = await vaultState();
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync(`out/${scenario}.json`, JSON.stringify(out, null, 2));
  for (const s of out.steps) console.log(`[${scenario}] ${s.ok === false ? 'FAILED ' : ''}${s.step}${s.signature ? ' ' + s.signature : ''}${s.error ? ' — ' + s.error : ''}`);
  console.log(`[${scenario}] wallet received:`, JSON.stringify(out.wallet_received));
})().catch(e => { console.error(e); process.exit(1); });
