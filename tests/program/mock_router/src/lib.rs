//! Test-only router. Instruction data: tag u8, then u64 args.
//!   tag 0 swap(amount_in, amount_out)
//!     accounts: taker[s], src[w], src_mint, pool_in[w], dst[w], dst_mint, pool_out[w], pool_authority,
//!               src_token_program, dst_token_program
//!     taker pays amount_in (src -> pool_in), pool pays amount_out (pool_out -> dst).
//!   tag 1 approve(amount): accounts taker[s], src[w], delegate, token_program — a hostile route.
//! The basket program must judge every call by measured balances only.
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed}, program_error::ProgramError, pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process);

fn xfer<'a>(tp: &AccountInfo<'a>, from: &AccountInfo<'a>, mint: &AccountInfo<'a>, to: &AccountInfo<'a>,
            auth: &AccountInfo<'a>, amount: u64, seeds: &[&[&[u8]]]) -> ProgramResult {
    let d = mint.try_borrow_data()?[44];
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(d);
    let ix = Instruction {
        program_id: *tp.key,
        accounts: vec![AccountMeta::new(*from.key, false), AccountMeta::new_readonly(*mint.key, false),
                       AccountMeta::new(*to.key, false), AccountMeta::new_readonly(*auth.key, true)],
        data,
    };
    invoke_signed(&ix, &[from.clone(), mint.clone(), to.clone(), auth.clone(), tp.clone()], seeds)
}

pub fn process(program_id: &Pubkey, accs: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let arg = |k: usize| -> Result<u64, ProgramError> {
        data.get(1 + 8 * k..9 + 8 * k).map(|b| u64::from_le_bytes(b.try_into().unwrap())).ok_or(ProgramError::InvalidInstructionData)
    };
    match data.first() {
        Some(0) => {
            let (amount_in, amount_out) = (arg(0)?, arg(1)?);
            let [taker, src, src_mint, pool_in, dst, dst_mint, pool_out, pool_auth, src_tp, dst_tp, ..] = accs else {
                return Err(ProgramError::NotEnoughAccountKeys);
            };
            let (pda, bump) = Pubkey::find_program_address(&[b"pool"], program_id);
            if *pool_auth.key != pda { return Err(ProgramError::InvalidSeeds); }
            if amount_in > 0 { xfer(src_tp, src, src_mint, pool_in, taker, amount_in, &[])?; }
            if amount_out > 0 { xfer(dst_tp, pool_out, dst_mint, dst, pool_auth, amount_out, &[&[b"pool", &[bump]]])?; }
            Ok(())
        }
        Some(1) => {
            let [taker, src, delegate, tp, ..] = accs else { return Err(ProgramError::NotEnoughAccountKeys) };
            let mut d = vec![4u8];
            d.extend_from_slice(&arg(0)?.to_le_bytes());
            let ix = Instruction { program_id: *tp.key, accounts: vec![AccountMeta::new(*src.key, false),
                AccountMeta::new_readonly(*delegate.key, false), AccountMeta::new_readonly(*taker.key, true)], data: d };
            invoke(&ix, &[src.clone(), delegate.clone(), taker.clone(), tp.clone()])
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
