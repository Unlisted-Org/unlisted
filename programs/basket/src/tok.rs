//! Minimal raw Token / Token-2022 / ATA helpers. No spl crates: the program reads the few
//! fields it needs straight from account data and builds the few CPIs it makes by hand.

use crate::errors::BasketError;
use crate::state::ClaimReason;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

pub const TOKEN: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const ACCOUNT_LEN: usize = 165;
const ACCOUNT_TYPE_MINT: u8 = 1;

// Token-2022 extension type ids (spl-token-2022 ExtensionType).
const EXT_TRANSFER_FEE_CONFIG: u16 = 1;
const EXT_CONFIDENTIAL_TRANSFER_MINT: u16 = 4;
const EXT_DEFAULT_ACCOUNT_STATE: u16 = 6;
const EXT_PERMANENT_DELEGATE: u16 = 12;
const EXT_TRANSFER_HOOK: u16 = 14;
const EXT_CONFIDENTIAL_TRANSFER_FEE_CONFIG: u16 = 16;
const EXT_METADATA_POINTER: u16 = 18;
const EXT_TOKEN_METADATA: u16 = 19;
const EXT_SCALED_UI_AMOUNT: u16 = 25;
const EXT_PAUSABLE: u16 = 26;

/// The PreStocks mint extension set, as read from mainnet (spec 02, Fixtures).
pub const PRESTOCKS_EXTENSIONS: u32 = (1 << EXT_TRANSFER_FEE_CONFIG)
    | (1 << EXT_CONFIDENTIAL_TRANSFER_MINT)
    | (1 << EXT_DEFAULT_ACCOUNT_STATE)
    | (1 << EXT_PERMANENT_DELEGATE)
    | (1 << EXT_TRANSFER_HOOK)
    | (1 << EXT_CONFIDENTIAL_TRANSFER_FEE_CONFIG)
    | (1 << EXT_METADATA_POINTER)
    | (1 << EXT_TOKEN_METADATA)
    | (1 << EXT_SCALED_UI_AMOUNT)
    | (1 << EXT_PAUSABLE);

fn data_of<'a>(a: &'a AccountInfo) -> Result<std::cell::Ref<'a, &'a mut [u8]>> {
    Ok(a.try_borrow_data()?)
}

/// Token account (either program) — returns (mint, owner, amount, state).
pub struct TokenAcc {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub state: u8,
    pub clean: bool, // no delegate, no close authority
}

pub fn token_acc(a: &AccountInfo) -> Result<TokenAcc> {
    require!(
        *a.owner == TOKEN || *a.owner == TOKEN_2022,
        BasketError::InvalidAccount
    );
    let d = data_of(a)?;
    require!(d.len() >= ACCOUNT_LEN, BasketError::InvalidAccount);
    // 108: state (0 uninitialised, 1 initialised, 2 frozen)
    require!(d[108] != 0, BasketError::InvalidAccount);
    Ok(TokenAcc {
        mint: Pubkey::try_from(&d[0..32]).unwrap(),
        owner: Pubkey::try_from(&d[32..64]).unwrap(),
        amount: u64::from_le_bytes(d[64..72].try_into().unwrap()),
        state: d[108],
        clean: d[72..76] == [0u8; 4] && d[129..133] == [0u8; 4],
    })
}

pub fn amount(a: &AccountInfo) -> Result<u64> {
    Ok(token_acc(a)?.amount)
}

/// Classic or 2022 mint base fields.
pub fn mint_supply_decimals(a: &AccountInfo) -> Result<(u64, u8)> {
    require!(
        *a.owner == TOKEN || *a.owner == TOKEN_2022,
        BasketError::InvalidAccount
    );
    let d = data_of(a)?;
    require!(d.len() >= 82 && d[45] == 1, BasketError::InvalidAccount);
    Ok((u64::from_le_bytes(d[36..44].try_into().unwrap()), d[44]))
}

/// Share mint must be classic SPL, decimals 9, mint authority = basket, no freeze authority.
pub fn check_share_mint(a: &AccountInfo, basket: &Pubkey) -> Result<()> {
    require!(*a.owner == TOKEN, BasketError::InvalidAccount);
    let d = data_of(a)?;
    require!(d.len() == 82 && d[45] == 1, BasketError::InvalidAccount);
    require!(d[0..4] == [1, 0, 0, 0] && d[4..36] == basket.to_bytes(), BasketError::InvalidAccount);
    require!(d[36..44] == [0u8; 8], BasketError::InvalidAccount); // supply 0
    require!(d[44] == crate::state::SHARE_DECIMALS, BasketError::InvalidAccount);
    require!(d[46..50] == [0u8; 4], BasketError::InvalidAccount); // no freeze authority
    Ok(())
}

/// Walk a Token-2022 mint's TLV area, calling f(type, value) for each entry.
fn for_each_ext(d: &[u8], mut f: impl FnMut(u16, &[u8])) -> Result<()> {
    if d.len() <= ACCOUNT_LEN {
        return Ok(());
    }
    require!(d[ACCOUNT_LEN] == ACCOUNT_TYPE_MINT, BasketError::InvalidAccount);
    let mut o = ACCOUNT_LEN + 1;
    while o + 4 <= d.len() {
        let t = u16::from_le_bytes([d[o], d[o + 1]]);
        let l = u16::from_le_bytes([d[o + 2], d[o + 3]]) as usize;
        if t == 0 {
            break;
        }
        require!(o + 4 + l <= d.len(), BasketError::InvalidAccount);
        f(t, &d[o + 4..o + 4 + l]);
        o += 4 + l;
    }
    Ok(())
}

/// Init-time check: exact PreStocks extension set and a null hook program.
pub fn check_leg_mint(mint: &AccountInfo) -> Result<()> {
    require!(*mint.owner == TOKEN_2022, BasketError::InvalidAccount);
    let d = data_of(mint)?;
    require!(d.len() > ACCOUNT_LEN && d[45] == 1, BasketError::UnexpectedExtensionSet);
    let mut set = 0u32;
    let mut hook = false;
    for_each_ext(&d, |t, v| {
        set |= 1u32.checked_shl(t as u32).unwrap_or(1 << 31);
        if t == EXT_TRANSFER_HOOK && v.len() >= 64 && v[32..64] != [0u8; 32] {
            hook = true;
        }
    })?;
    require!(set == PRESTOCKS_EXTENSIONS, BasketError::UnexpectedExtensionSet);
    require!(!hook, BasketError::HookNotNull);
    Ok(())
}

/// Availability read live from the mint's extensions and the vault's state (spec 02).
/// None = available; Some(reason) = unavailable.
pub fn unavailable(mint: &AccountInfo, vault: &AccountInfo) -> Result<Option<ClaimReason>> {
    let (mut paused, mut hook) = (false, false);
    {
        let d = data_of(mint)?;
        for_each_ext(&d, |t, v| {
            if t == EXT_PAUSABLE && v.len() >= 33 {
                paused = v[32] != 0;
            } else if t == EXT_TRANSFER_HOOK && v.len() >= 64 {
                hook = v[32..64] != [0u8; 32];
            }
        })?;
    }
    if paused {
        return Ok(Some(ClaimReason::Paused));
    }
    if hook {
        return Ok(Some(ClaimReason::Hook));
    }
    if token_acc(vault)?.state == 2 {
        return Ok(Some(ClaimReason::Frozen));
    }
    Ok(None)
}

pub fn decimals(mint: &AccountInfo) -> Result<u8> {
    Ok(mint_supply_decimals(mint)?.1)
}

fn call<'info>(
    program: &AccountInfo<'info>,
    metas: Vec<AccountMeta>,
    infos: &[AccountInfo<'info>],
    data: Vec<u8>,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let ix = Instruction { program_id: *program.key, accounts: metas, data };
    invoke_signed(&ix, infos, seeds).map_err(Into::into)
}

#[allow(clippy::too_many_arguments)]
pub fn transfer_checked<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let dec = decimals(mint)?;
    let mut data = Vec::with_capacity(10);
    data.push(12u8);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(dec);
    call(
        token_program,
        vec![
            AccountMeta::new(*from.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*to.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        &[from.clone(), mint.clone(), to.clone(), authority.clone(), token_program.clone()],
        data,
        seeds,
    )
}

pub fn mint_to<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = vec![7u8];
    data.extend_from_slice(&amount.to_le_bytes());
    call(
        token_program,
        vec![
            AccountMeta::new(*mint.key, false),
            AccountMeta::new(*to.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        &[mint.clone(), to.clone(), authority.clone(), token_program.clone()],
        data,
        seeds,
    )
}

pub fn burn<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let mut data = vec![8u8];
    data.extend_from_slice(&amount.to_le_bytes());
    call(
        token_program,
        vec![
            AccountMeta::new(*from.key, false),
            AccountMeta::new(*mint.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        &[from.clone(), mint.clone(), authority.clone(), token_program.clone()],
        data,
        &[],
    )
}

pub fn close_account<'info>(
    token_program: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    dest: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    call(
        token_program,
        vec![
            AccountMeta::new(*account.key, false),
            AccountMeta::new(*dest.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        &[account.clone(), dest.clone(), authority.clone(), token_program.clone()],
        vec![9u8],
        seeds,
    )
}

pub fn harvest<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    source: &AccountInfo<'info>,
) -> Result<()> {
    call(
        token_program,
        vec![AccountMeta::new(*mint.key, false), AccountMeta::new(*source.key, false)],
        &[mint.clone(), source.clone(), token_program.clone()],
        vec![26u8, 4u8],
        &[],
    )
}

/// CreateIdempotent on the ATA program. The ATA program checks the address derivation.
#[allow(clippy::too_many_arguments)]
pub fn create_ata<'info>(
    ata_program: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    ata: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
) -> Result<()> {
    call(
        ata_program,
        vec![
            AccountMeta::new(*payer.key, true),
            AccountMeta::new(*ata.key, false),
            AccountMeta::new_readonly(*owner.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
        ],
        &[
            payer.clone(),
            ata.clone(),
            owner.clone(),
            mint.clone(),
            system_program.clone(),
            token_program.clone(),
            ata_program.clone(),
        ],
        vec![1u8],
        &[],
    )
}

/// Opaque router CPI. `signer` (a PDA of this program) is marked as signer wherever it appears.
pub fn router_cpi<'info>(
    router: &AccountInfo<'info>,
    route: &[AccountInfo<'info>],
    data: Vec<u8>,
    signer: &Pubkey,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let metas = route
        .iter()
        .map(|a| AccountMeta {
            pubkey: *a.key,
            is_signer: a.is_signer || a.key == signer,
            is_writable: a.is_writable,
        })
        .collect();
    let mut infos = Vec::with_capacity(route.len() + 1);
    infos.extend_from_slice(route);
    infos.push(router.clone());
    call(router, metas, &infos, data, seeds)
}

/// Classic `Transfer` (USDC moves; no mint account needed).
pub fn transfer<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    call(
        token_program,
        vec![
            AccountMeta::new(*from.key, false),
            AccountMeta::new(*to.key, false),
            AccountMeta::new_readonly(*authority.key, true),
        ],
        &[from.clone(), to.clone(), authority.clone(), token_program.clone()],
        data,
        seeds,
    )
}

/// Program marker types so the IDL carries the fixed program addresses.
#[derive(Clone)]
pub struct Token;
impl anchor_lang::Id for Token {
    fn id() -> Pubkey {
        TOKEN
    }
}
#[derive(Clone)]
pub struct Token2022;
impl anchor_lang::Id for Token2022 {
    fn id() -> Pubkey {
        TOKEN_2022
    }
}
#[derive(Clone)]
pub struct AssociatedToken;
impl anchor_lang::Id for AssociatedToken {
    fn id() -> Pubkey {
        ATA_PROGRAM
    }
}
