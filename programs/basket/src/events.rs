use crate::state::*;
use anchor_lang::prelude::*;

#[event]
pub struct ShortfallObserved {
    pub leg: u8,
    pub expected: u64,
    pub actual: u64,
    pub loss_index: u128,
    pub slot: u64,
}

#[event]
pub struct SurplusObserved {
    pub leg: u8,
    pub expected: u64,
    pub actual: u64,
    pub slot: u64,
}

#[event]
pub struct Minted {
    pub owner: Pubkey,
    pub shares: u64,
    pub deltas: [u64; MAX_LEGS],
    pub path: MintPath,
}

#[event]
pub struct Redeemed {
    pub owner: Pubkey,
    pub ticket: Pubkey,
    pub shares: u64,
    pub paid: [u64; MAX_LEGS],
    pub claims_mask: u8,
}

#[event]
pub struct ClaimCreated {
    pub owner: Pubkey,
    pub ticket: Pubkey,
    pub leg: u8,
    pub units: u64,
    pub reason: ClaimReason,
}

#[event]
pub struct ClaimSettled {
    pub owner: Pubkey,
    pub ticket: Pubkey,
    pub leg: u8,
    pub units: u64,
    pub amount: u64,
}

#[event]
pub struct LegListing {
    pub leg: u8,
    pub convert_after: i64,
    pub deadline: i64,
}

#[event]
pub struct LegConverted {
    pub leg: u8,
    pub amount: u64,
    pub usdc: u64,
}

#[event]
pub struct LegRetired {
    pub leg: u8,
}

#[event]
pub struct RouterProposed {
    pub router: Pubkey,
    pub effective_ts: i64,
}
