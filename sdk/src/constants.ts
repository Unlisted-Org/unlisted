// Constants from spec 02 (docs/specs/02-onchain-interface.md, "Constants").
import { PublicKey } from "@solana/web3.js";

export const MAX_LEGS = 8;
export const SHARE_DECIMALS = 9;
export const LEG_DECIMALS = 9;
export const USDC_DECIMALS = 6;
export const INITIAL_SHARES = 1_000_000_000n;
export const INDEX_ONE = 10n ** 18n;
export const BPS = 10_000n;
export const MIN_LISTING_NOTICE_S = 7 * 24 * 3600;
export const MIN_DEADLINE_MARGIN_S = 7 * 24 * 3600;
export const ROUTER_ALLOWLIST_MAX = 4;
export const ALLOWLIST_TIMELOCK_S = 48 * 3600;
export const TICKET_MAX_AGE_SLOTS = 1_500;

/** Legs per ticket_swap_leg transaction (spec 02, Budgets; Phase 0 Q3). */
export const LEGS_PER_SWAP_TX = 4;
/** Jupiter routing parameters (spec 02 Programs; spec 03 sell_now). */
export const JUPITER_MAX_ACCOUNTS = 30;
// Manifest: quotes ignore the transfer fee (manifest#735). 1DEX: needs a system-owned taker, so it
// fails with the ticket or basket PDA (Agent A, fork run; spec 02 on main).
export const JUPITER_EXCLUDE_DEXES = "Manifest,1DEX";

export const JUPITER_V6_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

/** Constituents, in leg order. All seven are equal weight at inception (spec 01, Bootstrap). */
export const CONSTITUENTS = [
  { symbol: "OPENAI", name: "OpenAI", mainnetMint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", spvContested: true },
  { symbol: "ANTHROPIC", name: "Anthropic", mainnetMint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", spvContested: true },
  { symbol: "NEURALINK", name: "Neuralink", mainnetMint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", spvContested: false },
  { symbol: "ANDURIL", name: "Anduril", mainnetMint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", spvContested: false },
  { symbol: "POLYMARKET", name: "Polymarket", mainnetMint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", spvContested: false },
  { symbol: "KALSHI", name: "Kalshi", mainnetMint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", spvContested: false },
  { symbol: "FIGUREAI", name: "FigureAI", mainnetMint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd", spvContested: false },
] as const;

export const MAINNET_USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export const ERRORS: Record<number, string> = {
  6000: "LegUnavailable",
  6001: "SlippageExceeded",
  6002: "InsufficientShares",
  6003: "TicketIncomplete",
  6004: "TicketExpired",
  6005: "RouterNotAllowed",
  6006: "NotBootstrapped",
  6007: "AlreadyBootstrapped",
  6008: "LegEmpty",
  6009: "ListingNoticeTooShort",
  6010: "ConversionNotOpen",
  6011: "OutstandingClaims",
  6012: "DepositsDisabled",
  6013: "UnexpectedExtensionSet",
  6014: "HookNotNull",
  6015: "VaultFrozen",
  6016: "MathOverflow",
  6017: "ChunkTooLarge",
  // Added by program@700004c (Agent A):
  6018: "InvalidAccount",
  6019: "Unauthorized",
  6020: "NoClaim",
  6021: "RouteViolation",
  6022: "LegsStillLanded",
  6023: "RouterNotPending",
  6024: "InvalidArgument",
};

/** Token-2022 errors the app explains in plain words. */
export const TOKEN_2022_ERRORS: Record<number, string> = {
  0x11: "AccountFrozen",
  0x43: "MintPaused",
};
