// The seven basket constituents (spec 01), in leg order. Mainnet addresses; read-only.

export interface Constituent {
  index: number;
  symbol: string;
  mainnet_mint: string;
}

export const CONSTITUENTS: Constituent[] = [
  { index: 0, symbol: "OPENAI", mainnet_mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
  { index: 1, symbol: "ANTHROPIC", mainnet_mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
  { index: 2, symbol: "NEURALINK", mainnet_mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S" },
  { index: 3, symbol: "ANDURIL", mainnet_mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" },
  { index: 4, symbol: "POLYMARKET", mainnet_mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP" },
  { index: 5, symbol: "KALSHI", mainnet_mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua" },
  { index: 6, symbol: "FIGUREAI", mainnet_mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd" },
];

/** Squads v4 multisig controlling every PreStocks authority (docs/phase0.md, decoded at slot 450080146). */
export const PRESTOCKS_MULTISIG = "53Ab3Rqx1a5uiV7qmsX4qbdbrqstVDpnH4LoJGfsZsU8";
export const PRESTOCKS_MULTISIG_VAULT = "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc";
export const SQUADS_V4_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
