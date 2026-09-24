//! cpi_probe: LOCAL TEST ONLY, never deployed to devnet.
//!
//! Reproduces the basket's router call shape (spec 02): CPI into a router program with opaque
//! instruction data and the remaining accounts, with this program's PDA `["taker"]` signing as taker.
//! Used by scripts/amm/cpi-probe-test.ts to prove fixture_amm works as that router: PDA taker via
//! invoke_signed, output to an arbitrary token account, Token-2022 transfer_checked one level deeper.
//!
//! Accounts: 0 router program, 1.. forwarded in order (the PDA among them is marked signer).
//! Data: [bump, ...router instruction data].

use pinocchio::{
    account_info::AccountInfo,
    cpi::slice_invoke_signed,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{create_program_address, Pubkey},
    ProgramResult,
};

pinocchio::entrypoint!(process_instruction);

fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (bump, router_data) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    let (router, forwarded) = accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let pda = create_program_address(&[b"taker", &[*bump]], program_id)?;
    let metas: Vec<AccountMeta> = forwarded
        .iter()
        .map(|a| AccountMeta::new(a.key(), a.is_writable(), a.is_signer() || a.key() == &pda))
        .collect();
    let infos: Vec<&AccountInfo> = forwarded.iter().collect();
    let b = [*bump];
    let seeds = [Seed::from(b"taker".as_slice()), Seed::from(b.as_slice())];
    slice_invoke_signed(
        &Instruction { program_id: router.key(), data: router_data, accounts: &metas },
        &infos,
        &[Signer::from(&seeds)],
    )
}
