//! fixture_hook: the smallest Token-2022 transfer hook, for the `hook-switched-on` issuer scenario.
//!
//! - `Execute` (and anything else unrecognised) succeeds and does nothing, so transfers that forward the
//!   hook accounts still work: the scenario tests the basket's reaction to a non-null hook program,
//!   not a hostile hook.
//! - `InitializeExtraAccountMetaList` creates the validation PDA `["extra-account-metas", mint]` holding
//!   an empty extra-account list, so off-chain resolvers (spl-token CLI, wallets) find a valid account.
//!   Accounts: 0 validation [w] 1 mint 2 authority [w,s] (pays rent) 3 system_program.

#![no_std]

use pinocchio::{
    account_info::AccountInfo,
    cpi::slice_invoke_signed,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::{create_program_address, Pubkey},
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};

pinocchio::program_entrypoint!(process_instruction, 16);
pinocchio::no_allocator!();

/// no_std panic handler: abort without formatting (keeps core::fmt out of the binary).
#[cfg(target_os = "solana")]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    pinocchio::log::sol_log("panicked");
    unsafe { pinocchio::syscalls::abort() }
}

#[cfg(not(target_os = "solana"))]
extern crate std;

/// sha256("spl-transfer-hook-interface:initialize-extra-account-metas")[..8]
const INIT_DISC: [u8; 8] = [43, 34, 13, 49, 167, 88, 235, 235];
/// sha256("spl-transfer-hook-interface:execute")[..8]
const EXECUTE_DISC: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];
const SYSTEM_PROGRAM: Pubkey = [0u8; 32];
/// TLV: type = Execute discriminator, length = 4, value = PodSlice count 0.
const EMPTY_LIST_LEN: usize = 16;

fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() >= 8 && data[..8] == INIT_DISC {
        return init(program_id, accounts);
    }
    Ok(())
}

fn init(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [validation, mint, authority, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key() != &SYSTEM_PROGRAM {
        return Err(ProgramError::IncorrectProgramId);
    }
    let mut bump = 255u8;
    let pda = loop {
        if let Ok(k) = create_program_address(&[b"extra-account-metas", mint.key(), &[bump]], program_id) {
            break k;
        }
        bump = bump.checked_sub(1).ok_or(ProgramError::InvalidSeeds)?;
    };
    if validation.key() != &pda {
        return Err(ProgramError::InvalidSeeds);
    }
    let lamports = rent_exempt(EMPTY_LIST_LEN)?;
    let mut ix = [0u8; 52];
    ix[4..12].copy_from_slice(&lamports.to_le_bytes());
    ix[12..20].copy_from_slice(&(EMPTY_LIST_LEN as u64).to_le_bytes());
    ix[20..52].copy_from_slice(program_id);
    let metas = [AccountMeta::writable_signer(authority.key()), AccountMeta::writable_signer(validation.key())];
    let b = [bump];
    let seeds = [Seed::from(b"extra-account-metas".as_slice()), Seed::from(mint.key().as_slice()), Seed::from(b.as_slice())];
    slice_invoke_signed(
        &Instruction { program_id: &SYSTEM_PROGRAM, data: &ix, accounts: &metas },
        &[authority, validation],
        &[Signer::from(&seeds)],
    )?;
    let mut d = validation.try_borrow_mut_data()?;
    d[..8].copy_from_slice(&EXECUTE_DISC);
    d[8..12].copy_from_slice(&4u32.to_le_bytes());
    d[12..16].copy_from_slice(&0u32.to_le_bytes());
    Ok(())
}

/// Rent-exempt minimum without f64 (soft-float would add several KB to the binary).
/// Handles the two thresholds in use (2.0 today, 1.0 under SIMD-0194); anything else is refused.
#[allow(deprecated)]
fn rent_exempt(len: usize) -> Result<u64, ProgramError> {
    let rent = Rent::get()?;
    let base = (128 + len as u64) * rent.lamports_per_byte_year;
    match rent.exemption_threshold.to_bits() {
        0x4000_0000_0000_0000 => Ok(base * 2),
        0x3FF0_0000_0000_0000 => Ok(base),
        _ => Err(ProgramError::InvalidAccountData),
    }
}
