use anchor_lang::prelude::*;

/// 6000–6017 are spec 02 verbatim. 6018+ are additions reported in docs/reports.
#[error_code]
pub enum BasketError {
    #[msg("Leg unavailable: mint paused, transfer hook set, or vault frozen")]
    LegUnavailable,
    #[msg("Measured output below the caller's minimum")]
    SlippageExceeded,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Deposit ticket incomplete: not every active leg has landed")]
    TicketIncomplete,
    #[msg("Deposit ticket expired")]
    TicketExpired,
    #[msg("Router not in allowlist")]
    RouterNotAllowed,
    #[msg("Basket not bootstrapped")]
    NotBootstrapped,
    #[msg("Basket already bootstrapped")]
    AlreadyBootstrapped,
    #[msg("Leg empty")]
    LegEmpty,
    #[msg("Listing notice or deadline margin too short")]
    ListingNoticeTooShort,
    #[msg("Conversion not open")]
    ConversionNotOpen,
    #[msg("Outstanding claims on this leg")]
    OutstandingClaims,
    #[msg("Deposits disabled")]
    DepositsDisabled,
    #[msg("Mint does not carry the expected extension set")]
    UnexpectedExtensionSet,
    #[msg("Transfer hook program is not null")]
    HookNotNull,
    #[msg("Vault account frozen")]
    VaultFrozen,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Chunk larger than max_convert_chunk")]
    ChunkTooLarge,
    // ---- additions (not in spec 02) ----
    #[msg("Account does not match the basket's records")]
    InvalidAccount,
    #[msg("Signer not authorised for this action")]
    Unauthorized,
    #[msg("No claim on this leg")]
    NoClaim,
    #[msg("Route spent more than allowed or touched a basket account it may not")]
    RouteViolation,
    #[msg("Deposit ticket still holds landed legs; unwind them first")]
    LegsStillLanded,
    #[msg("Router allowlist full or router not pending")]
    RouterNotPending,
    #[msg("Invalid argument")]
    InvalidArgument,
}
