// Live mainnet read, nothing signed: for every Token-2022 holding in every Symmetry vault, compare
// the amount Symmetry has recorded against the vault's actual token-account balance.
// Usage: node mainnet-recon.js   Writes out/mainnet-recon.json
const w3 = require('@solana/web3.js');
const st = require('@solana/spl-token');
const fs = require('fs');
const { SymmetryCore } = require('@symmetry-hq/sdk');

const RPC = process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
const conn = new w3.Connection(RPC, 'confirmed');
const sdk = new SymmetryCore({ connection: conn, network: 'mainnet', priorityFee: 0 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rpc(method, params) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await r.json();
    if (j.result !== undefined) return j.result;
    await sleep(1500 * (i + 1));
  }
  throw new Error(`rpc ${method} failed`);
}

(async () => {
  const slot = await rpc('getSlot', []);
  const epoch = (await rpc('getEpochInfo', [])).epoch;
  const vaults = (await sdk.fetchAllVaults()).map(v => v.formatted).filter(Boolean);
  const rows = [];
  for (const v of vaults) for (const c of v.composition) {
    const m = await rpc('getAccountInfo', [c.mint, { encoding: 'jsonParsed' }]);
    if (!m.value || m.value.owner !== st.TOKEN_2022_PROGRAM_ID.toBase58()) continue;
    const ext = Object.fromEntries((m.value.data.parsed.info.extensions || []).map(e => [e.extension, e.state]));
    const tf = ext.transferFeeConfig;
    const feeBps = tf ? (epoch >= tf.newerTransferFee.epoch ? tf.newerTransferFee : tf.olderTransferFee).transferFeeBasisPoints : 0;
    const ata = st.getAssociatedTokenAddressSync(new w3.PublicKey(c.mint), new w3.PublicKey(v.pubkey), true, st.TOKEN_2022_PROGRAM_ID).toBase58();
    const a = await rpc('getAccountInfo', [ata, { encoding: 'jsonParsed' }]);
    const actual = a.value ? a.value.data.parsed.info.tokenAmount.amount : null;
    if (String(c.amount) === '0' && (actual === null || actual === '0')) continue;
    rows.push({
      vault: v.pubkey, vault_symbol: v.symbol, mint: c.mint, symbol: (ext.tokenMetadata || {}).symbol,
      fee_bps: feeBps, permanent_delegate: !!ext.permanentDelegate, pausable: !!ext.pausableConfig,
      recorded: String(c.amount), actual, vault_token_account: ata,
      actual_minus_recorded: actual === null ? null : (BigInt(actual) - BigInt(String(c.amount))).toString(),
    });
    await sleep(120);
  }
  const out = { rpc: RPC, slot, epoch, program: 'BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate', vaults_scanned: vaults.length, token2022_holdings: rows };
  fs.mkdirSync('out', { recursive: true });
  fs.writeFileSync('out/mainnet-recon.json', JSON.stringify(out, null, 2));
  console.log(`slot ${slot}: ${vaults.length} vaults, ${rows.length} non-empty Token-2022 holdings`);
  for (const r of rows) console.log(`${r.vault_symbol.padEnd(11)} ${String(r.symbol).padEnd(9)} fee=${r.fee_bps}bps recorded=${r.recorded} actual=${r.actual} diff=${r.actual_minus_recorded}`);
})().catch(e => { console.error(e); process.exit(1); });
