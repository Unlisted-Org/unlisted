//! Unlisted `basket`: a basket of PreStocks that keeps paying out when the issuer acts.
//!
//! Share maths follows spec 01 and `spec/model/basket_model.py` to the unit:
//! balance-as-truth `observe`, a per-leg loss index, partial redemption into claims,
//! measured deltas everywhere, and every division floored in the vault's favour.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod state;
pub mod tok;

pub use errors::BasketError;
pub use events::*;
pub use state::*;

declare_id!("GyiHodshTGFo7hXSXGQiHLTCzH9yF2QWWHy6s7sm6QQv");

type E = BasketError;

// ---------------------------------------------------------------- maths

fn mul_div(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c != 0, E::MathOverflow);
    Ok(a.checked_mul(b).ok_or(E::MathOverflow)? / c)
}

fn to_u64(x: u128) -> Result<u64> {
    u64::try_from(x).map_err(|_| error!(E::MathOverflow))
}

/// pending_i = P_i × L_i / 10^18
fn pending(l: &Leg) -> Result<u128> {
    mul_div(l.pending_norm, l.loss_index, INDEX_ONE)
}

/// owned_i = B_i − pending_i
fn owned(l: &Leg, bal: u64) -> Result<u128> {
    (bal as u128).checked_sub(pending(l)?).ok_or(error!(E::MathOverflow))
}

/// floor(units × owned_i / (S + C_i))
fn pro_rata(l: &Leg, bal: u64, units: u64, supply: u64) -> Result<u64> {
    let denom = supply as u128 + l.claim_units as u128;
    to_u64(mul_div(units as u128, owned(l, bal)?, denom)?)
}

/// Reconcile leg i against the vault's actual balance (spec 01, Observation).
fn observe_leg(b: &mut Basket, i: usize, vault: &AccountInfo) -> Result<u64> {
    require_keys_eq!(*vault.key, b.legs[i].vault, E::InvalidAccount);
    let bal = tok::amount(vault)?;
    let leg = &mut b.legs[i];
    if bal < leg.accounted {
        leg.loss_index = mul_div(leg.loss_index, bal as u128, leg.accounted as u128)?;
        emit!(ShortfallObserved {
            leg: i as u8,
            expected: leg.accounted,
            actual: bal,
            loss_index: leg.loss_index,
            slot: Clock::get()?.slot,
        });
    } else if bal > leg.accounted {
        emit!(SurplusObserved { leg: i as u8, expected: leg.accounted, actual: bal, slot: Clock::get()?.slot });
    }
    leg.accounted = bal;
    Ok(bal)
}

/// m = min over active legs of floor(Δ_i × (S + C_i) / (owned_i − Δ_i)); `bals` are post-deposit balances.
fn shares_for(b: &Basket, legs: &[usize], deltas: &[u64; MAX_LEGS], bals: &[u64; MAX_LEGS], supply: u64) -> Result<u64> {
    let mut m = u128::MAX;
    for &i in legs {
        let l = &b.legs[i];
        let own = owned(l, bals[i])?;
        let d = deltas[i] as u128;
        require!(own > d, E::LegEmpty);
        let cand = mul_div(d, supply as u128 + l.claim_units as u128, own - d)?;
        m = m.min(cand);
    }
    to_u64(m)
}

/// Active legs and their slice of remaining accounts: stride accounts per leg, mint first then vault.
fn leg_slices<'a, 'info>(b: &Basket, rem: &'a [AccountInfo<'info>], stride: usize) -> Result<Vec<(usize, &'a [AccountInfo<'info>])>> {
    let mut out = Vec::with_capacity(b.n_legs as usize);
    let mut k = 0;
    for i in 0..b.n_legs as usize {
        if b.legs[i].status == LegStatus::Retired {
            continue;
        }
        require!(rem.len() >= k + stride, E::InvalidAccount);
        let s = &rem[k..k + stride];
        require_keys_eq!(*s[0].key, b.legs[i].mint, E::InvalidAccount);
        require_keys_eq!(*s[1].key, b.legs[i].vault, E::InvalidAccount);
        out.push((i, s));
        k += stride;
    }
    Ok(out)
}

fn check_leg(b: &Basket, leg: u8, mint: &AccountInfo, vault: &AccountInfo) -> Result<usize> {
    let i = leg as usize;
    require!(i < b.n_legs as usize, E::InvalidArgument);
    require_keys_eq!(*mint.key, b.legs[i].mint, E::InvalidAccount);
    require_keys_eq!(*vault.key, b.legs[i].vault, E::InvalidAccount);
    Ok(i)
}

fn require_available(mint: &AccountInfo, vault: &AccountInfo) -> Result<()> {
    require!(tok::unavailable(mint, vault)?.is_none(), E::LegUnavailable);
    Ok(())
}

/// A basket-signed router CPI may move only the one vault and/or the reserve it is meant to. Every other
/// basket token account the route lists (Jupiter's route_v2 lists the taker's own output account even when a
/// destination is given) is watched: returns (route index, balance before). The share mint may not appear.
fn watch_route(b: &Basket, route: &[AccountInfo], vault: Option<usize>, reserve: bool) -> Result<Vec<(usize, u64)>> {
    let mut w = Vec::new();
    for (k, a) in route.iter().enumerate() {
        require!(*a.key != b.share_mint, E::RouteViolation);
        let other_vault = (0..b.n_legs as usize).any(|j| *a.key == b.legs[j].vault && vault != Some(j));
        if other_vault || (*a.key == b.usdc_reserve && !reserve) {
            w.push((k, tok::amount(a)?));
        }
    }
    Ok(w)
}

/// After the CPI: every watched account kept its balance and is still the basket's, with no delegate.
fn check_watch(route: &[AccountInfo], w: &[(usize, u64)], basket: &Pubkey) -> Result<()> {
    for &(k, before) in w {
        let t = tok::token_acc(&route[k])?;
        require!(t.amount == before && t.owner == *basket && t.clean, E::RouteViolation);
    }
    Ok(())
}

/// After a router CPI: the basket's token account is still the basket's, with no delegate or close authority.
fn check_intact(a: &AccountInfo, owner: &Pubkey) -> Result<()> {
    let t = tok::token_acc(a)?;
    require!(t.owner == *owner && t.clean, E::RouteViolation);
    Ok(())
}

fn now() -> Result<(u64, i64)> {
    let c = Clock::get()?;
    Ok((c.slot, c.unix_timestamp))
}

#[program]
pub mod basket {
    use super::*;

    // ------------------------------------------------------------ setup and authority

    pub fn initialize_basket<'info>(
        ctx: Context<'_, '_, 'info, 'info, InitializeBasket<'info>>,
        n_legs: u8,
        mirror_of: Vec<Pubkey>,
        max_convert_chunk: u64,
        routers: Vec<Pubkey>,
    ) -> Result<()> {
        let n = n_legs as usize;
        require!(n >= 1 && n <= MAX_LEGS, E::InvalidArgument);
        require!(mirror_of.len() == n, E::MathOverflow);
        require!(routers.len() <= ROUTER_ALLOWLIST_MAX, E::InvalidArgument);
        let rem = ctx.remaining_accounts;
        require!(rem.len() == 2 * n, E::InvalidAccount);
        let a = &ctx.accounts;
        let basket_key = a.basket.key();
        tok::check_share_mint(&a.share_mint, &basket_key)?;
        require!(*a.usdc_mint.owner == tok::TOKEN, E::InvalidAccount);
        let basket_info = a.basket.to_account_info();
        let payer = a.payer.to_account_info();
        let sys = a.system_program.to_account_info();
        tok::create_ata(&a.associated_token_program, &payer, &a.usdc_reserve, &basket_info, &a.usdc_mint, &sys, &a.token_program)?;
        let mut legs: Vec<Leg> = Vec::with_capacity(n);
        for i in 0..n {
            let (mint, vault) = (&rem[2 * i], &rem[2 * i + 1]);
            tok::check_leg_mint(mint)?;
            for l in legs.iter().take(i) {
                require_keys_neq!(l.mint, *mint.key, E::InvalidAccount);
            }
            tok::create_ata(&a.associated_token_program, &payer, vault, &basket_info, mint, &sys, &a.token_2022_program)?;
            let v = tok::token_acc(vault)?;
            require!(v.owner == basket_key && v.mint == *mint.key, E::InvalidAccount);
            require!(v.state == 1, E::VaultFrozen);
            legs.push(Leg {
                mint: *mint.key,
                vault: *vault.key,
                accounted: v.amount,
                claim_units: 0,
                pending_norm: 0,
                loss_index: INDEX_ONE,
                status: LegStatus::Active,
                mirror_of: mirror_of[i],
            });
        }
        let mut allow = [Pubkey::default(); ROUTER_ALLOWLIST_MAX];
        allow[..routers.len()].copy_from_slice(&routers);
        let b = &mut ctx.accounts.basket;
        b.version = 1;
        b.bump = ctx.bumps.basket;
        b.authority = ctx.accounts.authority.key();
        b.share_mint = ctx.accounts.share_mint.key();
        b.usdc_mint = ctx.accounts.usdc_mint.key();
        b.usdc_reserve = ctx.accounts.usdc_reserve.key();
        b.accounted_usdc_reserve = 0;
        b.n_legs = n_legs;
        b.legs[..n].copy_from_slice(&legs);
        b.router_allowlist = allow;
        b.pending_router = None;
        b.max_convert_chunk = max_convert_chunk;
        b.deposits_enabled = true;
        b.bootstrapped = false;
        b.reinvest_mask = 0;
        Ok(())
    }

    pub fn propose_router(ctx: Context<AuthorityOnly>, router: Pubkey) -> Result<()> {
        require_keys_neq!(router, Pubkey::default(), E::InvalidArgument);
        let effective_ts = now()?.1 + ALLOWLIST_TIMELOCK;
        ctx.accounts.basket.pending_router = Some(PendingRouter { router, effective_ts });
        emit!(RouterProposed { router, effective_ts });
        Ok(())
    }

    pub fn activate_router(ctx: Context<AuthorityOnly>, router: Pubkey) -> Result<()> {
        let b = &mut ctx.accounts.basket;
        let p = b.pending_router.ok_or(E::RouterNotPending)?;
        require!(p.router == router && now()?.1 >= p.effective_ts, E::RouterNotPending);
        require!(!b.is_router_allowed(&router), E::InvalidArgument);
        let slot = b.router_allowlist.iter_mut().find(|r| **r == Pubkey::default()).ok_or(E::RouterNotPending)?;
        *slot = router;
        b.pending_router = None;
        Ok(())
    }

    /// Removal is immediate (spec 02). Not listed as its own instruction in spec 02; reported.
    pub fn remove_router(ctx: Context<AuthorityOnly>, router: Pubkey) -> Result<()> {
        let b = &mut ctx.accounts.basket;
        for r in b.router_allowlist.iter_mut() {
            if *r == router {
                *r = Pubkey::default();
            }
        }
        if b.pending_router.map(|p| p.router == router).unwrap_or(false) {
            b.pending_router = None;
        }
        Ok(())
    }

    pub fn set_deposits_enabled(ctx: Context<AuthorityOnly>, enabled: bool) -> Result<()> {
        ctx.accounts.basket.deposits_enabled = enabled;
        Ok(())
    }

    pub fn flag_listing(ctx: Context<AuthorityOnly>, leg: u8, convert_after: i64, deadline: i64) -> Result<()> {
        let b = &mut ctx.accounts.basket;
        let i = leg as usize;
        require!(i < b.n_legs as usize && b.legs[i].status == LegStatus::Active, E::InvalidArgument);
        let t = now()?.1;
        require!(
            convert_after >= t.checked_add(MIN_LISTING_NOTICE).ok_or(E::MathOverflow)?
                && deadline.checked_sub(convert_after).ok_or(E::MathOverflow)? >= MIN_DEADLINE_MARGIN,
            E::ListingNoticeTooShort
        );
        b.legs[i].status = LegStatus::Listing { convert_after, deadline };
        emit!(LegListing { leg, convert_after, deadline });
        Ok(())
    }

    pub fn cancel_listing(ctx: Context<AuthorityOnly>, leg: u8) -> Result<()> {
        let b = &mut ctx.accounts.basket;
        let i = leg as usize;
        require!(i < b.n_legs as usize, E::InvalidArgument);
        match b.legs[i].status {
            LegStatus::Listing { convert_after, .. } => {
                require!(now()?.1 < convert_after, E::ConversionNotOpen);
                b.legs[i].status = LegStatus::Active;
                Ok(())
            }
            _ => err!(E::InvalidArgument),
        }
    }

    // ------------------------------------------------------------ mint

    /// Authority-only, once, into an empty basket: mints exactly INITIAL_SHARES.
    pub fn bootstrap<'info>(ctx: Context<'_, '_, 'info, 'info, Deposit<'info>>, gross: Vec<u64>) -> Result<()> {
        let initial_shares = INITIAL_SHARES;
        require_keys_eq!(ctx.accounts.depositor.key(), ctx.accounts.basket.authority, E::Unauthorized);
        require!(!ctx.accounts.basket.bootstrapped, E::AlreadyBootstrapped);
        let (supply, _) = tok::mint_supply_decimals(&ctx.accounts.share_mint)?;
        require!(supply == 0, E::AlreadyBootstrapped);
        let (deltas, _, mask) = deposit_legs(ctx.accounts, ctx.remaining_accounts, &gross)?;
        for (i, d) in deltas.iter().enumerate() {
            require!(*d > 0 || mask & (1 << i) == 0, E::LegEmpty);
        }
        mint_shares(ctx.accounts, initial_shares)?;
        ctx.accounts.basket.bootstrapped = true;
        emit!(Minted { owner: ctx.accounts.depositor.key(), shares: initial_shares, deltas, path: MintPath::Bootstrap });
        Ok(())
    }

    pub fn deposit_in_kind<'info>(
        ctx: Context<'_, '_, 'info, 'info, Deposit<'info>>,
        gross: Vec<u64>,
        min_shares: u64,
    ) -> Result<()> {
        require!(ctx.accounts.basket.bootstrapped, E::NotBootstrapped);
        require!(ctx.accounts.basket.deposits_enabled, E::DepositsDisabled);
        let (supply, _) = tok::mint_supply_decimals(&ctx.accounts.share_mint)?;
        let (deltas, bals, mask) = deposit_legs(ctx.accounts, ctx.remaining_accounts, &gross)?;
        let legs: Vec<usize> = (0..MAX_LEGS).filter(|i| mask & (1 << i) != 0).collect();
        let m = shares_for(&ctx.accounts.basket, &legs, &deltas, &bals, supply)?;
        require!(m >= min_shares.max(1), E::SlippageExceeded);
        mint_shares(ctx.accounts, m)?;
        emit!(Minted { owner: ctx.accounts.depositor.key(), shares: m, deltas, path: MintPath::InKind });
        Ok(())
    }

    pub fn open_deposit_ticket<'info>(
        ctx: Context<'_, '_, 'info, 'info, OpenDepositTicket<'info>>,
        nonce: u64,
        usdc_in: u64,
        expiry_slots: u64,
    ) -> Result<()> {
        require!(expiry_slots >= 1 && expiry_slots <= TICKET_MAX_AGE_SLOTS, E::InvalidArgument);
        {
            let b = &mut ctx.accounts.basket;
            require!(b.bootstrapped, E::NotBootstrapped);
            require!(b.deposits_enabled, E::DepositsDisabled);
            let legs = leg_slices(b, ctx.remaining_accounts, 2)?;
            for (i, s) in legs.iter() {
                observe_leg(b, *i, &s[1])?;
            }
            for (_, s) in legs.iter() {
                require_available(&s[0], &s[1])?;
            }
        }
        let a = &ctx.accounts;
        let ticket_info = a.ticket.to_account_info();
        tok::create_ata(
            &a.associated_token_program,
            &a.owner.to_account_info(),
            &a.escrow,
            &ticket_info,
            &a.usdc_mint,
            &a.system_program.to_account_info(),
            &a.token_program,
        )?;
        tok::transfer_checked(&a.token_program, &a.owner_usdc, &a.usdc_mint, &a.escrow, &a.owner.to_account_info(), usdc_in, &[])?;
        let got = tok::amount(&a.escrow)?;
        require!(got > 0, E::InvalidArgument);
        let slot = now()?.0;
        let t = &mut ctx.accounts.ticket;
        t.basket = ctx.accounts.basket.key();
        t.owner = ctx.accounts.owner.key();
        t.nonce = nonce;
        t.bump = ctx.bumps.ticket;
        t.escrow = ctx.accounts.escrow.key();
        t.usdc_in = got;
        t.norm = [0; MAX_LEGS];
        t.landed_mask = 0;
        t.created_slot = slot;
        t.expiry_slot = slot + expiry_slots;
        Ok(())
    }

    pub fn ticket_swap_leg<'info>(
        ctx: Context<'_, '_, 'info, 'info, TicketSwapLeg<'info>>,
        leg: u8,
        usdc_amount: u64,
        min_out: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        let a = &ctx.accounts;
        let b = &a.basket;
        require!(b.is_router_allowed(a.router_program.key), E::RouterNotAllowed);
        require!(now()?.0 <= a.ticket.expiry_slot, E::TicketExpired);
        let i = check_leg(b, leg, &a.leg_mint, &a.leg_vault)?;
        require!(b.legs[i].status != LegStatus::Retired, E::InvalidArgument);
        require_available(&a.leg_mint, &a.leg_vault)?;
        let before = observe_leg(&mut ctx.accounts.basket, i, &ctx.accounts.leg_vault)?;
        let a = &ctx.accounts;
        let esc_before = tok::amount(&a.escrow)?;
        let (bk, ow, nonce, bump) = (a.ticket.basket, a.ticket.owner, a.ticket.nonce.to_le_bytes(), [a.ticket.bump]);
        let seeds: &[&[u8]] = &[b"deposit", bk.as_ref(), ow.as_ref(), &nonce, &bump];
        tok::router_cpi(&a.router_program, ctx.remaining_accounts, route_data, &a.ticket.key(), &[seeds])?;
        let after = tok::amount(&a.leg_vault)?;
        let spent = esc_before.checked_sub(tok::amount(&a.escrow)?).ok_or(E::RouteViolation)?;
        require!(spent <= usdc_amount, E::RouteViolation);
        let delta = after.checked_sub(before).ok_or(E::SlippageExceeded)?;
        require!(delta >= min_out.max(1), E::SlippageExceeded);
        let b = &mut ctx.accounts.basket;
        let l = &mut b.legs[i];
        require!(l.loss_index > 0, E::LegEmpty);
        let norm = mul_div(delta as u128, INDEX_ONE, l.loss_index)?;
        l.pending_norm = l.pending_norm.checked_add(norm).ok_or(E::MathOverflow)?;
        l.accounted = after;
        let t = &mut ctx.accounts.ticket;
        t.norm[i] = t.norm[i].checked_add(norm).ok_or(E::MathOverflow)?;
        t.landed_mask |= 1 << i;
        Ok(())
    }

    pub fn finalize_deposit<'info>(
        ctx: Context<'_, '_, 'info, 'info, FinalizeDeposit<'info>>,
        min_shares: u64,
    ) -> Result<()> {
        let (supply, _) = tok::mint_supply_decimals(&ctx.accounts.share_mint)?;
        let norms = ctx.accounts.ticket.norm;
        let landed = ctx.accounts.ticket.landed_mask;
        let b = &mut ctx.accounts.basket;
        let legs = leg_slices(b, ctx.remaining_accounts, 2)?;
        let mut bals = [0u64; MAX_LEGS];
        for (i, s) in legs.iter() {
            bals[*i] = observe_leg(b, *i, &s[1])?;
            require!(landed & (1 << *i) != 0, E::TicketIncomplete);
        }
        let mut deltas = [0u64; MAX_LEGS];
        let idx: Vec<usize> = legs.iter().map(|(i, _)| *i).collect();
        for &i in idx.iter() {
            let l = &mut b.legs[i];
            deltas[i] = to_u64(mul_div(norms[i], l.loss_index, INDEX_ONE)?)?;
            l.pending_norm = l.pending_norm.checked_sub(norms[i]).ok_or(E::MathOverflow)?;
        }
        let m = shares_for(b, &idx, &deltas, &bals, supply)?;
        require!(m >= min_shares.max(1), E::SlippageExceeded);
        let a = &ctx.accounts;
        let sm = a.basket.share_mint;
        let bump = [a.basket.bump];
        let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
        tok::mint_to(&a.token_program, &a.share_mint, &a.owner_share_ata, &a.basket.to_account_info(), m, &[bseeds])?;
        let extra = &ctx.remaining_accounts[2 * idx.len()..];
        close_ticket_accounts(a.ticket.as_ref(), &a.escrow, &a.owner_usdc, &a.owner.to_account_info(), &a.token_program, &a.token_2022_program, extra)?;
        emit!(Minted { owner: a.owner.key(), shares: m, deltas, path: MintPath::Ticket });
        Ok(())
    }

    pub fn unwind_leg<'info>(
        ctx: Context<'_, '_, 'info, 'info, UnwindLeg<'info>>,
        leg: u8,
        min_usdc_out: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        let a = &ctx.accounts;
        require!(a.basket.is_router_allowed(a.router_program.key), E::RouterNotAllowed);
        let i = check_leg(&a.basket, leg, &a.leg_mint, &a.leg_vault)?;
        require!(a.ticket.landed_mask & (1 << i) != 0, E::NoClaim);
        require_available(&a.leg_mint, &a.leg_vault)?;
        let watch = watch_route(&a.basket, ctx.remaining_accounts, Some(i), false)?;
        let before = observe_leg(&mut ctx.accounts.basket, i, &ctx.accounts.leg_vault)?;
        let norm = ctx.accounts.ticket.norm[i];
        let b = &mut ctx.accounts.basket;
        let amount = to_u64(mul_div(norm, b.legs[i].loss_index, INDEX_ONE)?)?;
        b.legs[i].pending_norm = b.legs[i].pending_norm.checked_sub(norm).ok_or(E::MathOverflow)?;
        let a = &ctx.accounts;
        let esc_before = tok::amount(&a.escrow)?;
        let sm = a.basket.share_mint;
        let bump = [a.basket.bump];
        let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
        tok::router_cpi(&a.router_program, ctx.remaining_accounts, route_data, &a.basket.key(), &[bseeds])?;
        check_watch(ctx.remaining_accounts, &watch, &a.basket.key())?;
        let after = tok::amount(&a.leg_vault)?;
        check_intact(&a.leg_vault, &a.basket.key())?;
        let spent = before.checked_sub(after).ok_or(E::RouteViolation)?;
        require!(spent <= amount, E::RouteViolation);
        let got = tok::amount(&a.escrow)?.checked_sub(esc_before).ok_or(E::SlippageExceeded)?;
        require!(got >= min_usdc_out, E::SlippageExceeded);
        ctx.accounts.basket.legs[i].accounted = after;
        let t = &mut ctx.accounts.ticket;
        t.norm[i] = 0;
        t.landed_mask &= !(1 << i);
        Ok(())
    }

    /// Remaining accounts: any ticket-owned intermediate token accounts to close.
    pub fn abort_deposit<'info>(ctx: Context<'_, '_, 'info, 'info, AbortDeposit<'info>>) -> Result<()> {
        let a = &ctx.accounts;
        require!(a.ticket.landed_mask == 0, E::LegsStillLanded);
        close_ticket_accounts(a.ticket.as_ref(), &a.escrow, &a.owner_usdc, &a.owner.to_account_info(), &a.token_program, &a.token_2022_program, ctx.remaining_accounts)
    }

    // ------------------------------------------------------------ redeem

    pub fn redeem<'info>(
        ctx: Context<'_, '_, 'info, 'info, Redeem<'info>>,
        nonce: u64,
        shares: u64,
        mode: RedeemMode,
    ) -> Result<()> {
        let a = &ctx.accounts;
        require!(shares > 0, E::InsufficientShares);
        let sa = tok::token_acc(&a.owner_share_ata)?;
        require!(sa.mint == a.basket.share_mint && sa.amount >= shares, E::InsufficientShares);
        let (supply, _) = tok::mint_supply_decimals(&a.share_mint)?;
        let basket_info = a.basket.to_account_info();
        let (sm, bump) = (a.basket.share_mint, [a.basket.bump]);
        let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
        let owner_key = a.owner.key();
        let ticket_key = a.ticket.key();
        let t2022 = a.token_2022_program.to_account_info();
        let in_kind = mode == RedeemMode::InKind;

        let b = &mut ctx.accounts.basket;
        let legs = leg_slices(b, ctx.remaining_accounts, 3)?;
        let mut bals = [0u64; MAX_LEGS];
        for (i, s) in legs.iter() {
            bals[*i] = observe_leg(b, *i, &s[1])?;
        }
        let mut paid = [0u64; MAX_LEGS];
        let mut tlegs = [TicketLeg::None; MAX_LEGS];
        let mut claims_mask = 0u8;
        for (i, s) in legs.iter() {
            let i = *i;
            let why = tok::unavailable(&s[0], &s[1])?;
            if why.is_none() && in_kind {
                let out = pro_rata(&b.legs[i], bals[i], shares, supply)?;
                let user = &s[2];
                require_keys_neq!(*user.key, b.legs[i].vault, E::InvalidAccount);
                let u0 = tok::amount(user)?;
                if out > 0 {
                    tok::transfer_checked(&t2022, &s[1], &s[0], user, &basket_info, out, &[bseeds])?;
                }
                let received = tok::amount(user)?.checked_sub(u0).ok_or(E::MathOverflow)?;
                b.legs[i].accounted = tok::amount(&s[1])?;
                paid[i] = received;
                tlegs[i] = TicketLeg::Paid { amount: out, received };
            } else {
                let reason = why.unwrap_or(ClaimReason::PendingSale);
                let l = &mut b.legs[i];
                l.claim_units = l.claim_units.checked_add(shares).ok_or(E::MathOverflow)?;
                tlegs[i] = TicketLeg::Claim { units: shares, reason };
                claims_mask |= 1 << i;
                if why.is_some() {
                    emit!(ClaimCreated { owner: owner_key, ticket: ticket_key, leg: i as u8, units: shares, reason });
                }
            }
        }
        let a = &ctx.accounts;
        tok::burn(&a.token_program, &a.owner_share_ata, &a.share_mint, &a.owner.to_account_info(), shares)?;

        // USDC reserve (non-zero only during an IPO conversion): pro-rata share, floor.
        let mut usdc = 0u64;
        let reserve_needed = a.basket.accounted_usdc_reserve > 0;
        match (&a.usdc_reserve, &a.owner_usdc) {
            (Some(res), Some(dst)) => {
                require_keys_eq!(res.key(), a.basket.usdc_reserve, E::InvalidAccount);
                let r = tok::amount(res)?;
                usdc = to_u64(mul_div(shares as u128, r as u128, supply as u128)?)?;
                if usdc > 0 {
                    tok::transfer(&a.token_program, res, dst, &basket_info, usdc, &[bseeds])?;
                }
                let left = tok::amount(res)?;
                ctx.accounts.basket.accounted_usdc_reserve = left;
            }
            _ => require!(!reserve_needed, E::InvalidAccount),
        }
        let t = &mut ctx.accounts.ticket;
        t.basket = ctx.accounts.basket.key();
        t.owner = owner_key;
        t.nonce = nonce;
        t.bump = ctx.bumps.ticket;
        t.mode = mode;
        t.shares_burned = shares;
        t.legs = tlegs;
        t.usdc_out = usdc;
        emit!(Redeemed { owner: owner_key, ticket: ticket_key, shares, paid, claims_mask });
        Ok(())
    }

    pub fn settle_claim<'info>(ctx: Context<'_, '_, 'info, 'info, SettleClaim<'info>>, leg: u8) -> Result<()> {
        let a = &ctx.accounts;
        let i = check_leg(&a.basket, leg, &a.leg_mint, &a.leg_vault)?;
        let (units, reason) = match a.ticket.legs[i] {
            TicketLeg::Claim { units, reason } => (units, reason),
            _ => return err!(E::NoClaim),
        };
        if reason == ClaimReason::PendingSale {
            require_keys_eq!(a.cranker.key(), a.ticket.owner, E::Unauthorized);
        }
        require_keys_eq!(a.share_mint.key(), a.basket.share_mint, E::InvalidAccount);
        let dst = tok::token_acc(&a.owner_token_account)?;
        require!(dst.owner == a.ticket.owner && dst.mint == *a.leg_mint.key, E::InvalidAccount);
        require_available(&a.leg_mint, &a.leg_vault)?;
        let (supply, _) = tok::mint_supply_decimals(&a.share_mint)?;
        let bal = observe_leg(&mut ctx.accounts.basket, i, &ctx.accounts.leg_vault)?;
        let b = &mut ctx.accounts.basket;
        let out = pro_rata(&b.legs[i], bal, units, supply)?;
        b.legs[i].claim_units -= units;
        let a = &ctx.accounts;
        let (sm, bump) = (a.basket.share_mint, [a.basket.bump]);
        let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
        let u0 = dst.amount;
        if out > 0 {
            tok::transfer_checked(&a.token_2022_program, &a.leg_vault, &a.leg_mint, &a.owner_token_account, &a.basket.to_account_info(), out, &[bseeds])?;
        }
        let received = tok::amount(&a.owner_token_account)? - u0;
        let after = tok::amount(&a.leg_vault)?;
        let (owner, tk) = (a.ticket.owner, a.ticket.key());
        ctx.accounts.basket.legs[i].accounted = after;
        ctx.accounts.ticket.legs[i] = TicketLeg::Paid { amount: out, received };
        emit!(ClaimSettled { owner, ticket: tk, leg, units, amount: out, received });
        Ok(())
    }

    pub fn settle_leg_usdc<'info>(
        ctx: Context<'_, '_, 'info, 'info, SettleLegUsdc<'info>>,
        leg: u8,
        min_usdc_out: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        let a = &ctx.accounts;
        require!(a.basket.is_router_allowed(a.router_program.key), E::RouterNotAllowed);
        let i = check_leg(&a.basket, leg, &a.leg_mint, &a.leg_vault)?;
        let units = match a.ticket.legs[i] {
            TicketLeg::Claim { units, .. } => units,
            _ => return err!(E::NoClaim),
        };
        require_keys_eq!(a.share_mint.key(), a.basket.share_mint, E::InvalidAccount);
        let dst = tok::token_acc(&a.owner_usdc)?;
        require!(dst.owner == a.ticket.owner && dst.mint == a.basket.usdc_mint, E::InvalidAccount);
        require_available(&a.leg_mint, &a.leg_vault)?;
        let watch = watch_route(&a.basket, ctx.remaining_accounts, Some(i), false)?;
        let (supply, _) = tok::mint_supply_decimals(&a.share_mint)?;
        let before = observe_leg(&mut ctx.accounts.basket, i, &ctx.accounts.leg_vault)?;
        let b = &mut ctx.accounts.basket;
        let amount = pro_rata(&b.legs[i], before, units, supply)?;
        b.legs[i].claim_units -= units;
        let a = &ctx.accounts;
        let (sm, bump) = (a.basket.share_mint, [a.basket.bump]);
        let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
        tok::router_cpi(&a.router_program, ctx.remaining_accounts, route_data, &a.basket.key(), &[bseeds])?;
        check_watch(ctx.remaining_accounts, &watch, &a.basket.key())?;
        let after = tok::amount(&a.leg_vault)?;
        check_intact(&a.leg_vault, &a.basket.key())?;
        let spent = before.checked_sub(after).ok_or(E::RouteViolation)?;
        require!(spent <= amount, E::RouteViolation);
        let got = tok::amount(&a.owner_usdc)?.checked_sub(dst.amount).ok_or(E::SlippageExceeded)?;
        require!(got >= min_usdc_out.max(1), E::SlippageExceeded);
        let (owner, tk) = (a.ticket.owner, a.ticket.key());
        ctx.accounts.basket.legs[i].accounted = after;
        let t = &mut ctx.accounts.ticket;
        // amount = leg units debited from the vault; received = the owner's measured USDC.
        t.legs[i] = TicketLeg::Paid { amount: spent, received: got };
        t.usdc_out = t.usdc_out.saturating_add(got);
        emit!(ClaimSettled { owner, ticket: tk, leg, units, amount: spent, received: got });
        Ok(())
    }

    pub fn close_redemption(ctx: Context<CloseRedemption>) -> Result<()> {
        for l in ctx.accounts.ticket.legs.iter() {
            require!(!matches!(l, TicketLeg::Claim { .. }), E::OutstandingClaims);
        }
        Ok(())
    }

    // ------------------------------------------------------------ maintenance (permissionless)

    /// Remaining accounts: (mint, vault) of each leg in `legs`, in leg order.
    pub fn observe<'info>(ctx: Context<'_, '_, 'info, 'info, Observe<'info>>, legs: u8) -> Result<()> {
        let b = &mut ctx.accounts.basket;
        let rem = ctx.remaining_accounts;
        let mut k = 0;
        for i in 0..b.n_legs as usize {
            if legs & (1 << i) != 0 {
                require!(rem.len() >= k + 2, E::InvalidAccount);
                require_keys_eq!(*rem[k].key, b.legs[i].mint, E::InvalidAccount);
                observe_leg(b, i, &rem[k + 1])?;
                k += 2;
            }
        }
        require!(legs >> b.n_legs == 0, E::InvalidArgument);
        Ok(())
    }

    pub fn harvest(ctx: Context<Harvest>, leg: u8) -> Result<()> {
        let a = &ctx.accounts;
        check_leg(&a.basket, leg, &a.leg_mint, &a.leg_vault)?;
        tok::harvest(&a.token_2022_program, &a.leg_mint, &a.leg_vault)
    }

    pub fn convert_listed_leg<'info>(
        ctx: Context<'_, '_, 'info, 'info, ConvertListedLeg<'info>>,
        leg: u8,
        amount: u64,
        min_usdc_out: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        let a = &ctx.accounts;
        let b = &a.basket;
        require!(b.is_router_allowed(a.router_program.key), E::RouterNotAllowed);
        let i = check_leg(b, leg, &a.leg_mint, &a.leg_vault)?;
        require_keys_eq!(a.usdc_reserve.key(), b.usdc_reserve, E::InvalidAccount);
        require_keys_eq!(a.usdc_mint.key(), b.usdc_mint, E::InvalidAccount);
        match b.legs[i].status {
            LegStatus::Listing { convert_after, .. } => require!(now()?.1 >= convert_after, E::ConversionNotOpen),
            _ => return err!(E::ConversionNotOpen),
        }
        require!(b.legs[i].claim_units == 0, E::OutstandingClaims);
        require!(amount <= b.max_convert_chunk, E::ChunkTooLarge);
        require_available(&a.leg_mint, &a.leg_vault)?;
        let watch = watch_route(b, ctx.remaining_accounts, Some(i), true)?;
        let before = observe_leg(&mut ctx.accounts.basket, i, &ctx.accounts.leg_vault)?;
        let a = &ctx.accounts;
        require!(amount as u128 <= owned(&a.basket.legs[i], before)?, E::InvalidArgument);
        let r0 = tok::amount(&a.usdc_reserve)?;
        let (sm, bump) = (a.basket.share_mint, [a.basket.bump]);
        let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
        let bk = a.basket.key();
        tok::router_cpi(&a.router_program, ctx.remaining_accounts, route_data, &bk, &[bseeds])?;
        check_watch(ctx.remaining_accounts, &watch, &bk)?;
        let after = tok::amount(&a.leg_vault)?;
        let r1 = tok::amount(&a.usdc_reserve)?;
        check_intact(&a.leg_vault, &bk)?;
        check_intact(&a.usdc_reserve, &bk)?;
        let spent = before.checked_sub(after).ok_or(E::RouteViolation)?;
        require!(spent <= amount, E::RouteViolation);
        let usdc = r1.checked_sub(r0).ok_or(E::SlippageExceeded)?;
        require!(usdc >= min_usdc_out.max(1), E::SlippageExceeded);
        let b = &mut ctx.accounts.basket;
        b.legs[i].accounted = after;
        b.accounted_usdc_reserve = r1;
        emit!(LegConverted { leg, amount: spent, usdc });
        if owned(&b.legs[i], after)? == 0 {
            b.legs[i].status = LegStatus::Retired;
            let mut m = 0u8;
            for j in 0..b.n_legs as usize {
                if b.legs[j].status == LegStatus::Active {
                    m |= 1 << j;
                }
            }
            b.reinvest_mask |= m;
            emit!(LegRetired { leg });
        }
        Ok(())
    }

    pub fn reinvest_reserve<'info>(
        ctx: Context<'_, '_, 'info, 'info, ReinvestReserve<'info>>,
        leg: u8,
        usdc_amount: u64,
        min_out: u64,
        route_data: Vec<u8>,
    ) -> Result<()> {
        let a = &ctx.accounts;
        let b = &a.basket;
        require!(b.is_router_allowed(a.router_program.key), E::RouterNotAllowed);
        let i = check_leg(b, leg, &a.leg_mint, &a.leg_vault)?;
        require_keys_eq!(a.usdc_reserve.key(), b.usdc_reserve, E::InvalidAccount);
        require_keys_eq!(a.usdc_mint.key(), b.usdc_mint, E::InvalidAccount);
        require!(b.reinvest_mask & (1 << i) != 0 && b.legs[i].status == LegStatus::Active, E::InvalidArgument);
        require_available(&a.leg_mint, &a.leg_vault)?;
        let watch = watch_route(b, ctx.remaining_accounts, Some(i), true)?;
        let r0 = tok::amount(&a.usdc_reserve)?;
        let left = b.reinvest_mask.count_ones() as u64;
        let slice = if left == 1 { r0 } else { r0 / left };
        require!(usdc_amount == slice, E::InvalidArgument);
        let before = observe_leg(&mut ctx.accounts.basket, i, &ctx.accounts.leg_vault)?;
        let a = &ctx.accounts;
        let (sm, bump) = (a.basket.share_mint, [a.basket.bump]);
        let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
        let bk = a.basket.key();
        tok::router_cpi(&a.router_program, ctx.remaining_accounts, route_data, &bk, &[bseeds])?;
        check_watch(ctx.remaining_accounts, &watch, &bk)?;
        let after = tok::amount(&a.leg_vault)?;
        let r1 = tok::amount(&a.usdc_reserve)?;
        check_intact(&a.leg_vault, &bk)?;
        check_intact(&a.usdc_reserve, &bk)?;
        require!(r0.checked_sub(r1) == Some(slice), E::RouteViolation);
        let delta = after.checked_sub(before).ok_or(E::SlippageExceeded)?;
        require!(delta >= min_out.max(1), E::SlippageExceeded);
        let b = &mut ctx.accounts.basket;
        b.legs[i].accounted = after;
        b.accounted_usdc_reserve = r1;
        b.reinvest_mask &= !(1 << i);
        Ok(())
    }
}

// ---------------------------------------------------------------- shared handlers

/// In-kind transfer of every active leg with measured deltas. Returns (deltas, post balances, leg mask).
fn deposit_legs<'info>(
    a: &mut Deposit<'info>,
    rem: &'info [AccountInfo<'info>],
    gross: &[u64],
) -> Result<([u64; MAX_LEGS], [u64; MAX_LEGS], u8)> {
    require!(gross.len() == a.basket.n_legs as usize, E::MathOverflow);
    let legs = leg_slices(&a.basket, rem, 3)?;
    let mut bals = [0u64; MAX_LEGS];
    for (i, s) in legs.iter() {
        bals[*i] = observe_leg(&mut a.basket, *i, &s[1])?;
        require_available(&s[0], &s[1])?;
    }
    let mut deltas = [0u64; MAX_LEGS];
    let mut mask = 0u8;
    let dep = a.depositor.to_account_info();
    for (i, s) in legs.iter() {
        let i = *i;
        tok::transfer_checked(&a.token_2022_program, &s[2], &s[0], &s[1], &dep, gross[i], &[])?;
        let after = tok::amount(&s[1])?;
        deltas[i] = after.checked_sub(bals[i]).ok_or(E::MathOverflow)?;
        bals[i] = after;
        a.basket.legs[i].accounted = after;
        mask |= 1 << i;
    }
    Ok((deltas, bals, mask))
}

fn mint_shares(a: &Deposit, m: u64) -> Result<()> {
    let (sm, bump) = (a.basket.share_mint, [a.basket.bump]);
    let bseeds: &[&[u8]] = &[b"basket", sm.as_ref(), &bump];
    tok::mint_to(&a.token_program, &a.share_mint, &a.depositor_share_ata, &a.basket.to_account_info(), m, &[bseeds])
}

/// Refund the escrow to the owner, then close the escrow and every ticket-owned intermediate token
/// account passed (rent to the owner). An intermediate holding tokens is refused, not swept.
fn close_ticket_accounts<'info>(
    ticket: &Account<'info, DepositTicket>,
    escrow: &AccountInfo<'info>,
    owner_usdc: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    token_2022_program: &AccountInfo<'info>,
    extra: &[AccountInfo<'info>],
) -> Result<()> {
    let (bk, ow, nonce, bump) = (ticket.basket, ticket.owner, ticket.nonce.to_le_bytes(), [ticket.bump]);
    let seeds: &[&[u8]] = &[b"deposit", bk.as_ref(), ow.as_ref(), &nonce, &bump];
    let ti = ticket.to_account_info();
    let left = tok::amount(escrow)?;
    if left > 0 {
        tok::transfer(token_program, escrow, owner_usdc, &ti, left, &[seeds])?;
    }
    tok::close_account(token_program, escrow, owner, &ti, &[seeds])?;
    for acc in extra {
        if acc.lamports() == 0 {
            continue; // already closed earlier in this instruction (listed twice)
        }
        let t = tok::token_acc(acc)?;
        require!(t.owner == ti.key() && t.amount == 0, E::InvalidAccount);
        let tp = if *acc.owner == tok::TOKEN { token_program } else { token_2022_program };
        tok::close_account(tp, acc, owner, &ti, &[seeds])?;
    }
    Ok(())
}

// ---------------------------------------------------------------- accounts

#[derive(Accounts)]
pub struct InitializeBasket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub authority: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Basket::INIT_SPACE, seeds = [b"basket", share_mint.key().as_ref()], bump)]
    pub basket: Box<Account<'info, Basket>>,
    /// CHECK: pre-created classic mint; validated (authority = basket, supply 0, decimals 9, no freeze).
    #[account(mut)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: classic SPL mint (owner checked).
    pub usdc_mint: UncheckedAccount<'info>,
    /// CHECK: created here as ATA(basket, usdc_mint); the ATA program checks the address.
    #[account(mut)]
    pub usdc_reserve: UncheckedAccount<'info>,
    pub token_program: Program<'info, tok::Token>,
    pub token_2022_program: Program<'info, tok::Token2022>,
    pub associated_token_program: Program<'info, tok::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ E::Unauthorized)]
    pub basket: Box<Account<'info, Basket>>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    /// CHECK: address
    #[account(mut, address = basket.share_mint @ E::InvalidAccount)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: any share-mint token account; the token program checks the mint.
    #[account(mut)]
    pub depositor_share_ata: UncheckedAccount<'info>,
    pub token_program: Program<'info, tok::Token>,
    pub token_2022_program: Program<'info, tok::Token2022>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct OpenDepositTicket<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    #[account(init, payer = owner, space = 8 + DepositTicket::INIT_SPACE,
        seeds = [b"deposit", basket.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub ticket: Box<Account<'info, DepositTicket>>,
    /// CHECK: created here as ATA(ticket, usdc_mint); the ATA program checks the address.
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,
    /// CHECK: token program checks
    #[account(mut)]
    pub owner_usdc: UncheckedAccount<'info>,
    /// CHECK: address
    #[account(address = basket.usdc_mint @ E::InvalidAccount)]
    pub usdc_mint: UncheckedAccount<'info>,
    pub token_program: Program<'info, tok::Token>,
    pub associated_token_program: Program<'info, tok::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TicketSwapLeg<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    #[account(mut, has_one = owner @ E::Unauthorized, has_one = basket @ E::InvalidAccount, has_one = escrow @ E::InvalidAccount)]
    pub ticket: Box<Account<'info, DepositTicket>>,
    /// CHECK: == ticket.escrow
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,
    /// CHECK: == basket leg mint
    pub leg_mint: UncheckedAccount<'info>,
    /// CHECK: == basket leg vault
    #[account(mut)]
    pub leg_vault: UncheckedAccount<'info>,
    /// CHECK: must be in the router allowlist
    pub router_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    #[account(mut, close = owner, has_one = owner @ E::Unauthorized, has_one = basket @ E::InvalidAccount, has_one = escrow @ E::InvalidAccount)]
    pub ticket: Box<Account<'info, DepositTicket>>,
    /// CHECK: == ticket.escrow
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,
    /// CHECK: token program checks
    #[account(mut)]
    pub owner_usdc: UncheckedAccount<'info>,
    /// CHECK: address
    #[account(mut, address = basket.share_mint @ E::InvalidAccount)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: token program checks
    #[account(mut)]
    pub owner_share_ata: UncheckedAccount<'info>,
    pub token_program: Program<'info, tok::Token>,
    pub token_2022_program: Program<'info, tok::Token2022>,
}

#[derive(Accounts)]
pub struct UnwindLeg<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    #[account(mut, has_one = owner @ E::Unauthorized, has_one = basket @ E::InvalidAccount, has_one = escrow @ E::InvalidAccount)]
    pub ticket: Box<Account<'info, DepositTicket>>,
    /// CHECK: == ticket.escrow
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,
    /// CHECK: == basket leg mint
    pub leg_mint: UncheckedAccount<'info>,
    /// CHECK: == basket leg vault
    #[account(mut)]
    pub leg_vault: UncheckedAccount<'info>,
    /// CHECK: must be in the router allowlist
    pub router_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AbortDeposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub basket: Box<Account<'info, Basket>>,
    #[account(mut, close = owner, has_one = owner @ E::Unauthorized, has_one = basket @ E::InvalidAccount, has_one = escrow @ E::InvalidAccount)]
    pub ticket: Box<Account<'info, DepositTicket>>,
    /// CHECK: == ticket.escrow
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,
    /// CHECK: token program checks
    #[account(mut)]
    pub owner_usdc: UncheckedAccount<'info>,
    pub token_program: Program<'info, tok::Token>,
    pub token_2022_program: Program<'info, tok::Token2022>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    /// CHECK: address
    #[account(mut, address = basket.share_mint @ E::InvalidAccount)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: mint and balance checked
    #[account(mut)]
    pub owner_share_ata: UncheckedAccount<'info>,
    #[account(init, payer = owner, space = 8 + RedemptionTicket::INIT_SPACE,
        seeds = [b"redeem", basket.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub ticket: Box<Account<'info, RedemptionTicket>>,
    /// CHECK: == basket.usdc_reserve; required while the reserve is non-zero
    #[account(mut)]
    pub usdc_reserve: Option<UncheckedAccount<'info>>,
    /// CHECK: token program checks
    #[account(mut)]
    pub owner_usdc: Option<UncheckedAccount<'info>>,
    pub token_program: Program<'info, tok::Token>,
    pub token_2022_program: Program<'info, tok::Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleClaim<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    #[account(mut, has_one = basket @ E::InvalidAccount)]
    pub ticket: Box<Account<'info, RedemptionTicket>>,
    /// CHECK: == basket leg mint
    pub leg_mint: UncheckedAccount<'info>,
    /// CHECK: == basket leg vault
    #[account(mut)]
    pub leg_vault: UncheckedAccount<'info>,
    /// CHECK: owner == ticket.owner, mint == leg mint
    #[account(mut)]
    pub owner_token_account: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, tok::Token2022>,
    /// CHECK: == basket.share_mint (read for S)
    pub share_mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleLegUsdc<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    #[account(mut, has_one = owner @ E::Unauthorized, has_one = basket @ E::InvalidAccount)]
    pub ticket: Box<Account<'info, RedemptionTicket>>,
    /// CHECK: == basket leg mint
    pub leg_mint: UncheckedAccount<'info>,
    /// CHECK: == basket leg vault
    #[account(mut)]
    pub leg_vault: UncheckedAccount<'info>,
    /// CHECK: owner == ticket.owner, mint == usdc
    #[account(mut)]
    pub owner_usdc: UncheckedAccount<'info>,
    /// CHECK: must be in the router allowlist
    pub router_program: UncheckedAccount<'info>,
    /// CHECK: == basket.share_mint (read for S)
    pub share_mint: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseRedemption<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, close = owner, has_one = owner @ E::Unauthorized)]
    pub ticket: Box<Account<'info, RedemptionTicket>>,
}

#[derive(Accounts)]
pub struct Observe<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
}

#[derive(Accounts)]
pub struct Harvest<'info> {
    pub cranker: Signer<'info>,
    pub basket: Box<Account<'info, Basket>>,
    /// CHECK: == basket leg mint
    #[account(mut)]
    pub leg_mint: UncheckedAccount<'info>,
    /// CHECK: == basket leg vault
    #[account(mut)]
    pub leg_vault: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, tok::Token2022>,
}

#[derive(Accounts)]
pub struct ConvertListedLeg<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    /// CHECK: == basket leg mint
    pub leg_mint: UncheckedAccount<'info>,
    /// CHECK: == basket leg vault
    #[account(mut)]
    pub leg_vault: UncheckedAccount<'info>,
    /// CHECK: == basket.usdc_mint
    pub usdc_mint: UncheckedAccount<'info>,
    /// CHECK: == basket.usdc_reserve
    #[account(mut)]
    pub usdc_reserve: UncheckedAccount<'info>,
    /// CHECK: must be in the router allowlist
    pub router_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ReinvestReserve<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub basket: Box<Account<'info, Basket>>,
    /// CHECK: == basket.usdc_mint
    pub usdc_mint: UncheckedAccount<'info>,
    /// CHECK: == basket.usdc_reserve
    #[account(mut)]
    pub usdc_reserve: UncheckedAccount<'info>,
    /// CHECK: == basket leg mint
    pub leg_mint: UncheckedAccount<'info>,
    /// CHECK: == basket leg vault
    #[account(mut)]
    pub leg_vault: UncheckedAccount<'info>,
    /// CHECK: must be in the router allowlist
    pub router_program: UncheckedAccount<'info>,
}
