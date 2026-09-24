use anchor_lang::prelude::*;

pub const MAX_LEGS: usize = 8;
pub const SHARE_DECIMALS: u8 = 9;
pub const INITIAL_SHARES: u64 = 1_000_000_000;
pub const INDEX_ONE: u128 = 1_000_000_000_000_000_000;
pub const MIN_LISTING_NOTICE: i64 = 7 * 24 * 3600;
pub const MIN_DEADLINE_MARGIN: i64 = 7 * 24 * 3600;
pub const ROUTER_ALLOWLIST_MAX: usize = 4;
pub const ALLOWLIST_TIMELOCK: i64 = 48 * 3600;
pub const TICKET_MAX_AGE_SLOTS: u64 = 1_500;

#[account]
#[derive(InitSpace)]
pub struct Basket {
    pub version: u8,
    pub bump: u8,
    pub authority: Pubkey,
    pub share_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdc_reserve: Pubkey,
    pub accounted_usdc_reserve: u64,
    pub n_legs: u8,
    // The IDL (idl-build) sees the spec type `[Leg; MAX_LEGS]`. On chain the same bytes go through
    // `LegArray`, whose deserializer fills the array in place: Borsh's derived array code for this
    // struct needs a ~6 KiB stack frame and overflows the 4 KiB SBF limit.
    #[cfg(feature = "idl-build")]
    pub legs: [Leg; MAX_LEGS],
    #[cfg(not(feature = "idl-build"))]
    pub legs: LegArray,
    pub router_allowlist: [Pubkey; ROUTER_ALLOWLIST_MAX],
    pub pending_router: Option<PendingRouter>,
    pub max_convert_chunk: u64,
    pub deposits_enabled: bool,
    pub bootstrapped: bool,
    /// Legs still owed an equal slice of the USDC reserve after a retirement (IPO rule step 4).
    pub reinvest_mask: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Leg {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub accounted: u64,
    pub claim_units: u64,
    pub pending_norm: u128,
    pub loss_index: u128,
    pub status: LegStatus,
    pub mirror_of: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, InitSpace)]
pub enum LegStatus {
    #[default]
    Active,
    Listing { convert_after: i64, deadline: i64 },
    Retired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct PendingRouter {
    pub router: Pubkey,
    pub effective_ts: i64,
}

#[account]
#[derive(InitSpace)]
pub struct DepositTicket {
    pub basket: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    pub bump: u8,
    pub escrow: Pubkey,
    pub usdc_in: u64,
    pub norm: [u128; MAX_LEGS],
    pub landed_mask: u8,
    pub created_slot: u64,
    pub expiry_slot: u64,
}

#[account]
#[derive(InitSpace)]
pub struct RedemptionTicket {
    pub basket: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    pub bump: u8,
    pub mode: RedeemMode,
    pub shares_burned: u64,
    pub legs: [TicketLeg; MAX_LEGS],
    pub usdc_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum RedeemMode {
    InKind,
    Usdc { min_usdc_out: u64 },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq, InitSpace)]
pub enum TicketLeg {
    /// amount = gross debited from the vault (the model's floor value); received = owner's measured net.
    Paid { amount: u64, received: u64 },
    Claim { units: u64, reason: ClaimReason },
    #[default]
    None,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ClaimReason {
    Paused,
    Hook,
    Frozen,
    PendingSale,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MintPath {
    InKind,
    Ticket,
    Bootstrap,
}

impl Basket {
    pub fn signer_seeds(&self) -> [&[u8]; 3] {
        [b"basket", self.share_mint.as_ref(), core::slice::from_ref(&self.bump)]
    }

    pub fn is_router_allowed(&self, router: &Pubkey) -> bool {
        *router != Pubkey::default() && self.router_allowlist.iter().any(|r| r == router)
    }

    /// Bitmask of legs that are not retired (the "active legs" of spec 01).
    pub fn active_mask(&self) -> u8 {
        let mut m = 0u8;
        for i in 0..self.n_legs as usize {
            if self.legs[i].status != LegStatus::Retired {
                m |= 1 << i;
            }
        }
        m
    }
}


/// `[Leg; MAX_LEGS]` with an in-place Borsh deserializer. Byte layout identical to the array.
#[derive(Clone, Copy, Default)]
pub struct LegArray(pub [Leg; MAX_LEGS]);

impl core::ops::Deref for LegArray {
    type Target = [Leg; MAX_LEGS];
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl core::ops::DerefMut for LegArray {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl AnchorSerialize for LegArray {
    fn serialize<W: std::io::Write>(&self, w: &mut W) -> std::io::Result<()> {
        for l in self.0.iter() {
            l.serialize(w)?;
        }
        Ok(())
    }
}
impl AnchorDeserialize for LegArray {
    #[inline(never)]
    fn deserialize_reader<R: std::io::Read>(r: &mut R) -> std::io::Result<Self> {
        let mut out = LegArray::default();
        for l in out.0.iter_mut() {
            *l = Leg::deserialize_reader(r)?;
        }
        Ok(out)
    }
}
impl anchor_lang::Space for LegArray {
    const INIT_SPACE: usize = MAX_LEGS * Leg::INIT_SPACE;
}
