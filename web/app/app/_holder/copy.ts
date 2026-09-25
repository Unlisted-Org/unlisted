// Fixed copy. Disclosure text is quoted from docs/risks.md §3 (main, 2026-09-25) and must not be
// softened here. Anything dynamic (fees, balances, ages) is rendered from chain or API data, never
// from this file, so e2e assertions can't pass on static text.

export const HEADLINE = "A basket of tokenized pre-IPO companies that still pays you out when the issuer acts.";

export const ISSUER_POWERS =
  "PreStocks tokens are controlled by the issuer's 2-of-7 multisig with no time lock. It can pause any token, freeze accounts, " +
  "seize tokens from any account (including this basket's vault) and change the transfer fee on two epochs' notice. " +
  "It has seized before: on 2025-09-19 it emptied 29 holders' accounts to zero, with no memo.";

export const WHAT_THIS_BASKET_DOES = [
  "A paused, frozen or hooked leg becomes a claim; every other leg pays out now.",
  "A seizure is read from the vault's real balance and shared pro rata by every holder and claim on that leg. Later depositors don't make anyone whole.",
  "No oracle: minting and redeeming are computed from the vault's holdings only.",
];

export const NOT_PROTECTION = "This does not protect you from the issuer. It makes the basket lose per name instead of failing whole.";

export const COST_PLAIN =
  "Minting or redeeming through the basket is never cheaper than buying the seven tokens directly. At best it costs the same. " +
  "Every deposit and every redemption moves each leg through the vault and pays the issuer's transfer fee on each transfer.";

export const SPV_DISCLOSURE =
  "Two of the seven companies in this basket, OpenAI and Anthropic, have said publicly that transfers of their shares to special " +
  "purpose vehicles are void. Anthropic says third parties selling its shares through tokenized securities are “likely offering an " +
  "investment that may have no value”. PreStocks tokens give no claim on any company, SPV or PreStocks itself. Their value depends on " +
  "PreStocks’ own undisclosed arrangements, which PreStocks’ terms say may be reduced or eliminated. This basket holds these tokens as " +
  "they are, at equal weight with the other five, and cannot change that. At inception these two names are about 2/7 (≈ 29%) of the basket’s value.";

export const AUTHORITY_LIMITS =
  "The basket authority can propose routers (48 h timelock), stop new deposits, and flag a company's listing (at least 7 days' notice). " +
  "It cannot move vault tokens, and cannot stop, delay or alter redemptions and claims.";

export const HOOK_GOVERNANCE =
  "If the issuer switches on a transfer hook permanently, claims on that leg can't settle until a program upgrade adds reviewed hook support. That is a governance action.";

export const IN_KIND_RESIDUAL =
  "Deposits are sized to the basket's current per-share composition. Any amount of a leg above what the binding leg allows stays in the vault and accrues to all holders.";

export const CLAIM_NOTE =
  "A claim is owed one leg only, in units of burned shares. It pays out after the leg is available again and shares that leg's gains and losses (including any seizure) until then. It can't be transferred.";

// PreStocks' reply of 2026-09-25 (docs/risks.md, "PreStocks' reply"): no objection, which is not an endorsement.
export const NOT_ENDORSED = "PreStocks told us it has no objection to this basket, including a future mainnet version. That is not an endorsement, and we don't present it as one.";

export const NO_ADVANCE_NOTICE =
  "PreStocks has no channel that announces fee or multiplier changes in advance. This app reads the mints directly and shows every scheduled change the moment it exists on chain; that is the only advance warning a holder gets.";

export const TEST_NETWORK = "Devnet only. Every token here is a fixture mint that mirrors a real PreStocks token extension for extension; none has value.";
