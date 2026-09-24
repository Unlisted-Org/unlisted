//! fixture_amm: minimal constant-product pools, fixture USDC <-> one fixture leg per pool.
//!
//! The basket's devnet router (spec 02). Deliberately tiny:
//! - one pool per leg mint, PDA `["pool", leg_mint]`, holding two token accounts it owns;
//! - reserves are the vaults' **actual balances**, read on every swap (no stored reserves);
//! - input is measured as the in-vault's balance change, so Token-2022 transfer fees are priced in;
//! - output goes to **any** destination token account; `min_out` is checked against the
//!   destination's **measured** balance change (net of the leg's transfer fee on the way out);
//! - the taker only has to be a signer, so a program PDA can be the taker through CPI;
//! - every token movement is `transfer_checked` (Token-2022 legs and classic-SPL USDC alike).
//!
//! Instructions (first data byte is the tag, integers little-endian):
//!
//! 0 `init_pool { fee_bps: u16 }`
//!    0 payer [w,s] 1 admin [s] 2 pool [w] 3 leg_mint 4 usdc_mint 5 leg_vault 6 usdc_vault 7 system_program
//!    The vaults must already exist, be owned by the pool PDA and hold the right mints.
//!
//! 1 `swap { amount_in: u64, min_out: u64, side: u8 }` (side 0 = buy leg with USDC, 1 = sell leg for USDC)
//!    0 pool 1 leg_mint 2 usdc_mint 3 leg_vault [w] 4 usdc_vault [w] 5 taker [s] 6 source [w]
//!    7 destination [w] 8 leg_token_program 9 usdc_token_program
//!    Sets return data to the destination's measured delta (u64 LE).
//!
//! 2 `admin_withdraw { amount: u64, side: u8 }` (side 0 = leg vault, 1 = usdc vault)
//!    0 pool 1 admin [s] 2 vault [w] 3 mint 4 destination [w] 5 token_program
//!    Lets the fixture issuer re-centre a pool on a new mainnet price. Deposits need no instruction:
//!    anyone can transfer or mint into a vault, and the price follows the balances.

#![no_std]

use pinocchio::{
    account_info::AccountInfo,
    cpi::{set_return_data, slice_invoke_signed},
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

const POOL_TAG: u8 = 0xA1;
/// Layout: [0] tag [1] bump [2..4] fee_bps [4..36] admin [36..68] leg_mint [68..100] usdc_mint
///         [100..132] leg_vault [132..164] usdc_vault
pub const POOL_LEN: usize = 164;
const SYSTEM_PROGRAM: Pubkey = [0u8; 32];
/// TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
const TOKEN_PROGRAM: Pubkey = [
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58,
    140, 245, 133, 126, 255, 0, 169,
];
/// TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
const TOKEN_2022_PROGRAM: Pubkey = [
    6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77, 131, 185, 13, 39, 254,
    189, 249, 40, 216, 161, 139, 252,
];

/// Custom error codes (ProgramError::Custom(n)).
#[repr(u32)]
enum AmmError {
    SlippageExceeded = 1,
    BadPool = 2,
    BadVault = 3,
    BadTokenProgram = 4,
    EmptyPool = 5,
    NotAdmin = 6,
    ZeroAmount = 7,
    Overflow = 8,
}

impl From<AmmError> for ProgramError {
    fn from(e: AmmError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    match data.split_first() {
        Some((0, rest)) => init_pool(program_id, accounts, rest),
        Some((1, rest)) => swap(program_id, accounts, rest),
        Some((2, rest)) => admin_withdraw(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn read_u64(d: &[u8], at: usize) -> Result<u64, ProgramError> {
    d.get(at..at + 8)
        .map(|b| u64::from_le_bytes(b.try_into().unwrap()))
        .ok_or(ProgramError::InvalidInstructionData)
}

/// Token account (classic or Token-2022 base layout): mint [0..32], owner [32..64], amount [64..72].
fn token_account(acc: &AccountInfo) -> Result<(Pubkey, Pubkey, u64), ProgramError> {
    if !(acc.is_owned_by(&TOKEN_PROGRAM) || acc.is_owned_by(&TOKEN_2022_PROGRAM)) {
        return Err(AmmError::BadVault.into());
    }
    let d = acc.try_borrow_data()?;
    if d.len() < 165 {
        return Err(AmmError::BadVault.into());
    }
    let mint: Pubkey = d[0..32].try_into().unwrap();
    let owner: Pubkey = d[32..64].try_into().unwrap();
    let amount = u64::from_le_bytes(d[64..72].try_into().unwrap());
    Ok((mint, owner, amount))
}

fn amount_of(acc: &AccountInfo) -> Result<u64, ProgramError> {
    let d = acc.try_borrow_data()?;
    if d.len() < 72 {
        return Err(AmmError::BadVault.into());
    }
    Ok(u64::from_le_bytes(d[64..72].try_into().unwrap()))
}

fn mint_decimals(mint: &AccountInfo) -> Result<u8, ProgramError> {
    let d = mint.try_borrow_data()?;
    d.get(44).copied().ok_or(ProgramError::InvalidAccountData)
}

struct Pool {
    bump: u8,
    fee_bps: u16,
    admin: Pubkey,
    leg_mint: Pubkey,
    usdc_mint: Pubkey,
    leg_vault: Pubkey,
    usdc_vault: Pubkey,
}

fn load_pool(program_id: &Pubkey, pool: &AccountInfo) -> Result<Pool, ProgramError> {
    if !pool.is_owned_by(program_id) {
        return Err(AmmError::BadPool.into());
    }
    let d = pool.try_borrow_data()?;
    if d.len() != POOL_LEN || d[0] != POOL_TAG {
        return Err(AmmError::BadPool.into());
    }
    let k = |a: usize| -> Pubkey { d[a..a + 32].try_into().unwrap() };
    Ok(Pool {
        bump: d[1],
        fee_bps: u16::from_le_bytes([d[2], d[3]]),
        admin: k(4),
        leg_mint: k(36),
        usdc_mint: k(68),
        leg_vault: k(100),
        usdc_vault: k(132),
    })
}

#[allow(clippy::too_many_arguments)]
#[inline(never)]
fn transfer_checked(
    token_program: &AccountInfo,
    source: &AccountInfo,
    mint: &AccountInfo,
    destination: &AccountInfo,
    authority: &AccountInfo,
    amount: u64,
    decimals: u8,
    signers: &[Signer],
) -> ProgramResult {
    let mut data = [0u8; 10];
    data[0] = 12; // TransferChecked: same tag in Token and Token-2022
    data[1..9].copy_from_slice(&amount.to_le_bytes());
    data[9] = decimals;
    let metas = [
        AccountMeta::writable(source.key()),
        AccountMeta::readonly(mint.key()),
        AccountMeta::writable(destination.key()),
        AccountMeta::readonly_signer(authority.key()),
    ];
    let ix = Instruction { program_id: token_program.key(), data: &data, accounts: &metas };
    slice_invoke_signed(&ix, &[source, mint, destination, authority], signers)
}

fn init_pool(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [payer, admin, pool, leg_mint, usdc_mint, leg_vault, usdc_vault, system, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !payer.is_signer() || !admin.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if system.key() != &SYSTEM_PROGRAM {
        return Err(ProgramError::IncorrectProgramId);
    }
    let fee_bps = u16::from_le_bytes(data.get(0..2).ok_or(ProgramError::InvalidInstructionData)?.try_into().unwrap());
    if fee_bps >= 10_000 {
        return Err(ProgramError::InvalidInstructionData);
    }
    if !leg_mint.is_owned_by(&TOKEN_2022_PROGRAM) {
        return Err(AmmError::BadTokenProgram.into());
    }
    if !(usdc_mint.is_owned_by(&TOKEN_PROGRAM) || usdc_mint.is_owned_by(&TOKEN_2022_PROGRAM)) {
        return Err(AmmError::BadTokenProgram.into());
    }
    // Canonical bump for ["pool", leg_mint].
    let mut bump = 255u8;
    let pda = loop {
        if let Ok(k) = create_program_address(&[b"pool", leg_mint.key(), &[bump]], program_id) {
            break k;
        }
        bump = bump.checked_sub(1).ok_or(ProgramError::InvalidSeeds)?;
    };
    if pool.key() != &pda {
        return Err(ProgramError::InvalidSeeds);
    }
    for (vault, mint) in [(leg_vault, leg_mint), (usdc_vault, usdc_mint)] {
        let (m, owner, _) = token_account(vault)?;
        if &m != mint.key() || owner != pda || vault.owner() != mint.owner() {
            return Err(AmmError::BadVault.into());
        }
    }
    // Create the pool account; the PDA signs for its own creation.
    let lamports = rent_exempt(POOL_LEN)?;
    let mut ix_data = [0u8; 52]; // [0..4] = 0: SystemInstruction::CreateAccount
    ix_data[4..12].copy_from_slice(&lamports.to_le_bytes());
    ix_data[12..20].copy_from_slice(&(POOL_LEN as u64).to_le_bytes());
    ix_data[20..52].copy_from_slice(program_id);
    let metas = [AccountMeta::writable_signer(payer.key()), AccountMeta::writable_signer(pool.key())];
    let bump_seed = [bump];
    let seeds = [Seed::from(b"pool".as_slice()), Seed::from(leg_mint.key().as_slice()), Seed::from(bump_seed.as_slice())];
    slice_invoke_signed(
        &Instruction { program_id: &SYSTEM_PROGRAM, data: &ix_data, accounts: &metas },
        &[payer, pool],
        &[Signer::from(&seeds)],
    )?;
    let mut d = pool.try_borrow_mut_data()?;
    d[0] = POOL_TAG;
    d[1] = bump;
    d[2..4].copy_from_slice(&fee_bps.to_le_bytes());
    d[4..36].copy_from_slice(admin.key());
    d[36..68].copy_from_slice(leg_mint.key());
    d[68..100].copy_from_slice(usdc_mint.key());
    d[100..132].copy_from_slice(leg_vault.key());
    d[132..164].copy_from_slice(usdc_vault.key());
    Ok(())
}

fn swap(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [pool_ai, leg_mint, usdc_mint, leg_vault, usdc_vault, taker, source, destination, leg_tp, usdc_tp, ..] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let amount_in = read_u64(data, 0)?;
    let min_out = read_u64(data, 8)?;
    let side = *data.get(16).ok_or(ProgramError::InvalidInstructionData)?;
    if amount_in == 0 {
        return Err(AmmError::ZeroAmount.into());
    }
    let pool = load_pool(program_id, pool_ai)?;
    if leg_mint.key() != &pool.leg_mint
        || usdc_mint.key() != &pool.usdc_mint
        || leg_vault.key() != &pool.leg_vault
        || usdc_vault.key() != &pool.usdc_vault
    {
        return Err(AmmError::BadPool.into());
    }
    if !leg_mint.is_owned_by(leg_tp.key()) || !usdc_mint.is_owned_by(usdc_tp.key()) {
        return Err(AmmError::BadTokenProgram.into());
    }
    if !taker.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // side 0: USDC in, leg out. side 1: leg in, USDC out.
    let (in_vault, in_mint, in_tp, out_vault, out_mint, out_tp) = match side {
        0 => (usdc_vault, usdc_mint, usdc_tp, leg_vault, leg_mint, leg_tp),
        1 => (leg_vault, leg_mint, leg_tp, usdc_vault, usdc_mint, usdc_tp),
        _ => return Err(ProgramError::InvalidInstructionData),
    };
    let in_reserve = amount_of(in_vault)?;
    let out_reserve = amount_of(out_vault)?;
    if in_reserve == 0 || out_reserve == 0 {
        return Err(AmmError::EmptyPool.into());
    }

    // Pull the input from the taker and measure what actually arrived (net of any transfer fee).
    transfer_checked(in_tp, source, in_mint, in_vault, taker, amount_in, mint_decimals(in_mint)?, &[])?;
    let received = amount_of(in_vault)?.checked_sub(in_reserve).ok_or(AmmError::Overflow)?;

    // Constant product on the measured input after the LP fee. Floored: rounding favours the pool.
    let eff = (received as u128) * (10_000 - pool.fee_bps as u128) / 10_000;
    let out = (out_reserve as u128) * eff / (in_reserve as u128 + eff);
    let out = u64::try_from(out).map_err(|_| AmmError::Overflow)?;
    if out == 0 {
        return Err(AmmError::SlippageExceeded.into());
    }

    let before = amount_of(destination)?;
    let bump_seed = [pool.bump];
    let seeds = [Seed::from(b"pool".as_slice()), Seed::from(pool.leg_mint.as_slice()), Seed::from(bump_seed.as_slice())];
    transfer_checked(out_tp, out_vault, out_mint, destination, pool_ai, out, mint_decimals(out_mint)?, &[Signer::from(&seeds)])?;
    // A destination equal to the out vault measures a negative delta and fails here, as intended.
    let delivered = amount_of(destination)?.saturating_sub(before);
    if delivered < min_out {
        return Err(AmmError::SlippageExceeded.into());
    }
    set_return_data(&delivered.to_le_bytes());
    Ok(())
}

fn admin_withdraw(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let [pool_ai, admin, vault, mint, destination, token_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let amount = read_u64(data, 0)?;
    let side = *data.get(8).ok_or(ProgramError::InvalidInstructionData)?;
    let pool = load_pool(program_id, pool_ai)?;
    if !admin.is_signer() || admin.key() != &pool.admin {
        return Err(AmmError::NotAdmin.into());
    }
    let (want_vault, want_mint) = match side {
        0 => (&pool.leg_vault, &pool.leg_mint),
        1 => (&pool.usdc_vault, &pool.usdc_mint),
        _ => return Err(ProgramError::InvalidInstructionData),
    };
    if vault.key() != want_vault || mint.key() != want_mint || !mint.is_owned_by(token_program.key()) {
        return Err(AmmError::BadPool.into());
    }
    let bump_seed = [pool.bump];
    let seeds = [Seed::from(b"pool".as_slice()), Seed::from(pool.leg_mint.as_slice()), Seed::from(bump_seed.as_slice())];
    transfer_checked(token_program, vault, mint, destination, pool_ai, amount, mint_decimals(mint)?, &[Signer::from(&seeds)])
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
