// Deliberate breakage for negative controls (spec 00: every check must be shown to fail on a broken
// version). Set VALUATION_MUTATION only when running a verify/* script against a mutated service;
// the server reports it in /health and in every response. Never set in normal operation.
//   stored_multiplier  effective multiplier = the stored `multiplier` field (the 1.486x OPENAI bug)
//   round_up           redeem entitlement uses ceil instead of floor
//   skip_observe       per-share amounts ignore observe() (stale loss index and accounted balance)
export const MUTATION = process.env.VALUATION_MUTATION ?? "";
