//! Split Pay money core.
//!
//! All amounts are whole numbers in the smallest unit of a currency
//! (rupiah, yen, cents). Nothing here uses floating point.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ---------------------------------------------------------------- splits

#[derive(Deserialize)]
pub struct Part {
    pub id: String,
    /// Meaning depends on the method: exact = amount, percent = hundredths
    /// of a percent, shares = hundredths of a share, adjust = extra amount.
    #[serde(default)]
    pub value: i64,
}

#[derive(Deserialize)]
pub struct SplitReq {
    pub amount: i64,
    pub method: String,
    pub parts: Vec<Part>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Amt {
    pub id: String,
    pub amount: i64,
}

/// Split `amount` by integer weights. Each person gets the floor of their
/// proportional part; leftover units go to the first weighted people, one each.
fn by_weight(amount: i64, ids: &[&str], weights: &[i64]) -> Vec<Amt> {
    let total: i128 = weights.iter().map(|w| *w as i128).sum();
    let mut out: Vec<Amt> = ids
        .iter()
        .zip(weights)
        .map(|(id, w)| Amt {
            id: (*id).to_string(),
            amount: ((amount as i128) * (*w as i128) / total) as i64,
        })
        .collect();
    let mut left = amount - out.iter().map(|a| a.amount).sum::<i64>();
    for (a, w) in out.iter_mut().zip(weights) {
        if left == 0 {
            break;
        }
        if *w > 0 {
            a.amount += 1;
            left -= 1;
        }
    }
    out
}

pub fn split(req: &SplitReq) -> Result<Vec<Amt>, String> {
    if req.amount <= 0 {
        return Err("Enter an amount first.".into());
    }
    if req.parts.is_empty() {
        return Err("Pick at least one person.".into());
    }
    if req.parts.iter().any(|p| p.value < 0) {
        return Err("Values cannot be negative.".into());
    }
    let ids: Vec<&str> = req.parts.iter().map(|p| p.id.as_str()).collect();
    let vals: Vec<i64> = req.parts.iter().map(|p| p.value).collect();
    let sum: i64 = vals.iter().sum();

    let shares = match req.method.as_str() {
        "equal" => by_weight(req.amount, &ids, &vec![1; ids.len()]),
        "exact" => {
            if sum != req.amount {
                return Err(format!("diff:{}", req.amount - sum));
            }
            ids.iter()
                .zip(&vals)
                .map(|(id, v)| Amt { id: (*id).to_string(), amount: *v })
                .collect()
        }
        "percent" => {
            if sum != 10_000 {
                return Err(format!("pct:{}", 10_000 - sum));
            }
            by_weight(req.amount, &ids, &vals)
        }
        "shares" => {
            if sum == 0 {
                return Err("Give at least one share.".into());
            }
            by_weight(req.amount, &ids, &vals)
        }
        "adjust" => {
            if sum > req.amount {
                return Err(format!("diff:{}", req.amount - sum));
            }
            let base = by_weight(req.amount - sum, &ids, &vec![1; ids.len()]);
            base.into_iter()
                .zip(&vals)
                .map(|(a, v)| Amt { id: a.id, amount: a.amount + v })
                .collect()
        }
        other => return Err(format!("Unknown split method: {other}")),
    };
    Ok(shares.into_iter().filter(|a| a.amount != 0).collect())
}

// -------------------------------------------------------------- balances

#[derive(Deserialize)]
pub struct Expense {
    pub currency: String,
    pub payers: Vec<Amt>,
    pub shares: Vec<Amt>,
}

#[derive(Deserialize)]
pub struct Payment {
    pub currency: String,
    pub from: String,
    pub to: String,
    pub amount: i64,
}

#[derive(Deserialize)]
pub struct BalReq {
    #[serde(default)]
    pub expenses: Vec<Expense>,
    #[serde(default)]
    pub payments: Vec<Payment>,
    #[serde(default)]
    pub simplify: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Debt {
    pub from: String,
    pub to: String,
    pub amount: i64,
}

#[derive(Serialize, Debug)]
pub struct CurBal {
    pub currency: String,
    /// Positive = is owed money, negative = owes money.
    pub nets: Vec<Amt>,
    pub debts: Vec<Debt>,
}

/// Match people who owe (negative) with people who are owed (positive).
/// `largest_first` gives the fewest payments; otherwise order is by id.
fn settle(nets: &BTreeMap<String, i64>, largest_first: bool) -> Vec<Debt> {
    let mut debtors: Vec<(String, i64)> =
        nets.iter().filter(|(_, v)| **v < 0).map(|(k, v)| (k.clone(), -*v)).collect();
    let mut creditors: Vec<(String, i64)> =
        nets.iter().filter(|(_, v)| **v > 0).map(|(k, v)| (k.clone(), *v)).collect();
    if largest_first {
        debtors.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        creditors.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    }
    let mut out = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < debtors.len() && j < creditors.len() {
        let pay = debtors[i].1.min(creditors[j].1);
        out.push(Debt { from: debtors[i].0.clone(), to: creditors[j].0.clone(), amount: pay });
        debtors[i].1 -= pay;
        creditors[j].1 -= pay;
        if debtors[i].1 == 0 {
            i += 1;
        }
        if creditors[j].1 == 0 {
            j += 1;
        }
    }
    out
}

pub fn balances(req: &BalReq) -> Result<Vec<CurBal>, String> {
    // per currency: net per person, and "a owes b" totals
    let mut nets: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();
    let mut owes: BTreeMap<String, BTreeMap<(String, String), i64>> = BTreeMap::new();

    for e in &req.expenses {
        let paid: i64 = e.payers.iter().map(|a| a.amount).sum();
        let owed: i64 = e.shares.iter().map(|a| a.amount).sum();
        if paid != owed {
            return Err(format!("An expense does not add up: paid {paid}, split {owed}."));
        }
        let mut local: BTreeMap<String, i64> = BTreeMap::new();
        for p in &e.payers {
            *local.entry(p.id.clone()).or_default() += p.amount;
        }
        for s in &e.shares {
            *local.entry(s.id.clone()).or_default() -= s.amount;
        }
        let n = nets.entry(e.currency.clone()).or_default();
        for (id, v) in &local {
            *n.entry(id.clone()).or_default() += v;
        }
        let o = owes.entry(e.currency.clone()).or_default();
        for d in settle(&local, false) {
            *o.entry((d.from, d.to)).or_default() += d.amount;
        }
    }
    for p in &req.payments {
        if p.amount <= 0 || p.from == p.to {
            continue;
        }
        let n = nets.entry(p.currency.clone()).or_default();
        *n.entry(p.from.clone()).or_default() += p.amount;
        *n.entry(p.to.clone()).or_default() -= p.amount;
        // paying someone is the same as them owing you that amount back
        let o = owes.entry(p.currency.clone()).or_default();
        *o.entry((p.to.clone(), p.from.clone())).or_default() += p.amount;
    }

    let mut out = Vec::new();
    for (currency, n) in nets {
        let debts = if req.simplify {
            settle(&n, true)
        } else {
            let o = owes.remove(&currency).unwrap_or_default();
            let mut pairs: BTreeMap<(String, String), i64> = BTreeMap::new();
            for ((a, b), v) in o {
                if a < b {
                    *pairs.entry((a, b)).or_default() += v;
                } else {
                    *pairs.entry((b, a)).or_default() -= v;
                }
            }
            pairs
                .into_iter()
                .filter(|(_, v)| *v != 0)
                .map(|((a, b), v)| {
                    if v > 0 {
                        Debt { from: a, to: b, amount: v }
                    } else {
                        Debt { from: b, to: a, amount: -v }
                    }
                })
                .collect()
        };
        let nets_out: Vec<Amt> = n
            .into_iter()
            .filter(|(_, v)| *v != 0)
            .map(|(id, amount)| Amt { id, amount })
            .collect();
        if !nets_out.is_empty() || !debts.is_empty() {
            out.push(CurBal { currency, nets: nets_out, debts });
        }
    }
    Ok(out)
}

// ------------------------------------------------------------ conversion

/// Exchange rates typed in by the user.
#[derive(Deserialize)]
pub struct Fx {
    /// Currency to convert everything into.
    pub target: String,
    /// Millionths of the base currency per 1 whole unit of each currency
    /// (the base currency itself is 1_000_000).
    pub rates: BTreeMap<String, i64>,
    /// Decimal places per currency (IDR 0, SGD 2, ...).
    pub decimals: BTreeMap<String, u32>,
}

/// Convert an amount in minor units, rounding half away from zero.
pub fn convert(amount: i64, from: &str, to: &str, fx: &Fx) -> Result<i64, String> {
    if from == to {
        return Ok(amount);
    }
    let rate = |c: &str| match fx.rates.get(c) {
        Some(r) if *r > 0 => Ok(*r as i128),
        _ => Err(format!("rate:{c}")),
    };
    let (rf, rt) = (rate(from)?, rate(to)?);
    let df = *fx.decimals.get(from).unwrap_or(&2);
    let dt = *fx.decimals.get(to).unwrap_or(&2);
    let num = (amount as i128) * rf * 10i128.pow(dt);
    let den = 10i128.pow(df) * rt;
    let q = if num >= 0 { (num + den / 2) / den } else { -((-num + den / 2) / den) };
    Ok(q as i64)
}

#[derive(Deserialize)]
pub struct ConvertReq {
    pub amount: i64,
    pub from: String,
    pub to: String,
    pub fx: Fx,
}

#[derive(Deserialize)]
pub struct ConvBalReq {
    #[serde(default)]
    pub expenses: Vec<Expense>,
    #[serde(default)]
    pub payments: Vec<Payment>,
    #[serde(default)]
    pub simplify: bool,
    pub fx: Fx,
}

/// Re-split a converted total by the original amounts, so every converted
/// expense still adds up exactly.
fn reweigh(total: i64, parts: &[Amt]) -> Vec<Amt> {
    let ids: Vec<&str> = parts.iter().map(|a| a.id.as_str()).collect();
    let w: Vec<i64> = parts.iter().map(|a| a.amount).collect();
    if total == 0 || w.iter().sum::<i64>() <= 0 {
        return Vec::new();
    }
    by_weight(total, &ids, &w).into_iter().filter(|a| a.amount != 0).collect()
}

/// Balances with every expense and payment converted into `fx.target`.
pub fn balances_converted(req: &ConvBalReq) -> Result<Vec<CurBal>, String> {
    let t = req.fx.target.as_str();
    let mut expenses = Vec::new();
    for e in &req.expenses {
        let total: i64 = e.shares.iter().map(|a| a.amount).sum();
        let conv = convert(total, &e.currency, t, &req.fx)?;
        expenses.push(Expense { currency: t.to_string(), payers: reweigh(conv, &e.payers), shares: reweigh(conv, &e.shares) });
    }
    let mut payments = Vec::new();
    for p in &req.payments {
        payments.push(Payment {
            currency: t.to_string(),
            from: p.from.clone(),
            to: p.to.clone(),
            amount: convert(p.amount, &p.currency, t, &req.fx)?,
        });
    }
    balances(&BalReq { expenses, payments, simplify: req.simplify })
}

// ------------------------------------------------------------- JSON API

/// op 1 = split, op 2 = balances, op 3 = convert one amount,
/// op 4 = balances converted into one currency. Input and output are JSON text.
pub fn call_json(op: u32, input: &str) -> String {
    fn wrap<T: Serialize>(r: Result<T, String>) -> String {
        match r {
            Ok(v) => serde_json::json!({ "ok": true, "data": v }).to_string(),
            Err(e) => serde_json::json!({ "ok": false, "error": e }).to_string(),
        }
    }
    match op {
        1 => wrap(serde_json::from_str::<SplitReq>(input).map_err(|e| e.to_string()).and_then(|r| split(&r))),
        2 => wrap(serde_json::from_str::<BalReq>(input).map_err(|e| e.to_string()).and_then(|r| balances(&r))),
        3 => wrap(serde_json::from_str::<ConvertReq>(input).map_err(|e| e.to_string()).and_then(|r| convert(r.amount, &r.from, &r.to, &r.fx))),
        4 => wrap(serde_json::from_str::<ConvBalReq>(input).map_err(|e| e.to_string()).and_then(|r| balances_converted(&r))),
        _ => wrap::<()>(Err("Unknown operation".into())),
    }
}

// ----------------------------------------------------- WebAssembly glue

#[no_mangle]
pub extern "C" fn sp_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// # Safety
/// `ptr` and `len` must come from `sp_alloc` or `sp_call`.
#[no_mangle]
pub unsafe extern "C" fn sp_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

/// Returns a buffer: 4 bytes little-endian length, then that many bytes of
/// JSON. Free it with `sp_free(ptr, length + 4)`.
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn sp_call(op: u32, ptr: *const u8, len: usize) -> *mut u8 {
    let input = std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).unwrap_or("");
    let res = call_json(op, input).into_bytes();
    let mut out = Vec::with_capacity(res.len() + 4);
    out.extend_from_slice(&(res.len() as u32).to_le_bytes());
    out.extend_from_slice(&res);
    Box::into_raw(out.into_boxed_slice()) as *mut u8
}

// ----------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(v: &[(&str, i64)]) -> Vec<Part> {
        v.iter().map(|(id, value)| Part { id: id.to_string(), value: *value }).collect()
    }
    fn amts(v: &[(&str, i64)]) -> Vec<Amt> {
        v.iter().map(|(id, amount)| Amt { id: id.to_string(), amount: *amount }).collect()
    }
    fn sp(amount: i64, method: &str, p: &[(&str, i64)]) -> Result<Vec<Amt>, String> {
        split(&SplitReq { amount, method: method.into(), parts: parts(p) })
    }

    #[test]
    fn equal_divides_evenly() {
        let r = sp(480_000, "equal", &[("a", 0), ("b", 0), ("c", 0), ("d", 0), ("e", 0)]).unwrap();
        assert!(r.iter().all(|x| x.amount == 96_000));
    }

    #[test]
    fn equal_leftover_goes_to_first_people() {
        let r = sp(100_000, "equal", &[("a", 0), ("b", 0), ("c", 0)]).unwrap();
        assert_eq!(r, amts(&[("a", 33_334), ("b", 33_333), ("c", 33_333)]));
        assert_eq!(r.iter().map(|x| x.amount).sum::<i64>(), 100_000);
    }

    #[test]
    fn exact_must_add_up() {
        assert_eq!(sp(100, "exact", &[("a", 60), ("b", 30)]), Err("diff:10".into()));
        assert_eq!(sp(100, "exact", &[("a", 60), ("b", 40)]).unwrap(), amts(&[("a", 60), ("b", 40)]));
    }

    #[test]
    fn exact_drops_people_with_zero() {
        assert_eq!(sp(100, "exact", &[("a", 100), ("b", 0)]).unwrap(), amts(&[("a", 100)]));
    }

    #[test]
    fn percent_must_total_100() {
        assert_eq!(sp(1000, "percent", &[("a", 5000), ("b", 4000)]), Err("pct:1000".into()));
        let r = sp(1000, "percent", &[("a", 7000), ("b", 3000)]).unwrap();
        assert_eq!(r, amts(&[("a", 700), ("b", 300)]));
    }

    #[test]
    fn percent_rounding_keeps_total() {
        let r = sp(100, "percent", &[("a", 3333), ("b", 3333), ("c", 3334)]).unwrap();
        assert_eq!(r.iter().map(|x| x.amount).sum::<i64>(), 100);
    }

    #[test]
    fn shares_split_by_weight() {
        // 2 nights vs 1 night
        let r = sp(300_000, "shares", &[("a", 200), ("b", 100)]).unwrap();
        assert_eq!(r, amts(&[("a", 200_000), ("b", 100_000)]));
    }

    #[test]
    fn adjust_adds_extra_then_splits_rest() {
        // a had an extra 20,000 item; the other 80,000 is shared
        let r = sp(100_000, "adjust", &[("a", 20_000), ("b", 0)]).unwrap();
        assert_eq!(r, amts(&[("a", 60_000), ("b", 40_000)]));
        assert_eq!(sp(100, "adjust", &[("a", 150), ("b", 0)]), Err("diff:-50".into()));
    }

    #[test]
    fn rejects_zero_amount_and_empty_people() {
        assert!(sp(0, "equal", &[("a", 0)]).is_err());
        assert!(sp(100, "equal", &[]).is_err());
    }

    fn exp(cur: &str, payers: &[(&str, i64)], shares: &[(&str, i64)]) -> Expense {
        Expense { currency: cur.into(), payers: amts(payers), shares: amts(shares) }
    }
    fn debt(from: &str, to: &str, amount: i64) -> Debt {
        Debt { from: from.into(), to: to.into(), amount }
    }

    #[test]
    fn one_expense_pairwise() {
        let r = balances(&BalReq {
            expenses: vec![exp("IDR", &[("me", 300)], &[("me", 100), ("a", 100), ("b", 100)])],
            payments: vec![],
            simplify: false,
        })
        .unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].debts, vec![debt("a", "me", 100), debt("b", "me", 100)]);
        assert_eq!(r[0].nets, amts(&[("a", -100), ("b", -100), ("me", 200)]));
    }

    #[test]
    fn opposite_debts_cancel() {
        let r = balances(&BalReq {
            expenses: vec![
                exp("IDR", &[("me", 200)], &[("me", 100), ("a", 100)]),
                exp("IDR", &[("a", 60)], &[("me", 30), ("a", 30)]),
            ],
            payments: vec![],
            simplify: false,
        })
        .unwrap();
        assert_eq!(r[0].debts, vec![debt("a", "me", 70)]);
    }

    #[test]
    fn payment_reduces_debt_and_can_settle() {
        let mut req = BalReq {
            expenses: vec![exp("IDR", &[("me", 200)], &[("me", 100), ("a", 100)])],
            payments: vec![Payment { currency: "IDR".into(), from: "a".into(), to: "me".into(), amount: 40 }],
            simplify: false,
        };
        assert_eq!(balances(&req).unwrap()[0].debts, vec![debt("a", "me", 60)]);
        req.payments[0].amount = 100;
        assert!(balances(&req).unwrap().is_empty());
    }

    #[test]
    fn currencies_never_mix() {
        let r = balances(&BalReq {
            expenses: vec![
                exp("IDR", &[("me", 200)], &[("me", 100), ("a", 100)]),
                exp("SGD", &[("a", 2400)], &[("me", 600), ("a", 1800)]),
            ],
            payments: vec![],
            simplify: false,
        })
        .unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].currency, "IDR");
        assert_eq!(r[0].debts, vec![debt("a", "me", 100)]);
        assert_eq!(r[1].currency, "SGD");
        assert_eq!(r[1].debts, vec![debt("me", "a", 600)]);
    }

    #[test]
    fn simplify_uses_fewer_payments() {
        // a owes b 100, b owes c 100  ->  simplified: a owes c 100
        let expenses = || {
            vec![
                exp("IDR", &[("b", 100)], &[("a", 100)]),
                exp("IDR", &[("c", 100)], &[("b", 100)]),
            ]
        };
        let plain = balances(&BalReq { expenses: expenses(), payments: vec![], simplify: false }).unwrap();
        assert_eq!(plain[0].debts.len(), 2);
        let simple = balances(&BalReq { expenses: expenses(), payments: vec![], simplify: true }).unwrap();
        assert_eq!(simple[0].debts, vec![debt("a", "c", 100)]);
    }

    #[test]
    fn multiple_payers() {
        let r = balances(&BalReq {
            expenses: vec![exp("IDR", &[("a", 60), ("b", 40)], &[("a", 25), ("b", 25), ("c", 50)])],
            payments: vec![],
            simplify: false,
        })
        .unwrap();
        assert_eq!(r[0].debts, vec![debt("c", "a", 35), debt("c", "b", 15)]);
        let total: i64 = r[0].nets.iter().map(|n| n.amount).sum();
        assert_eq!(total, 0);
    }

    #[test]
    fn expense_that_does_not_add_up_is_rejected() {
        let r = balances(&BalReq {
            expenses: vec![exp("IDR", &[("a", 100)], &[("a", 40), ("b", 50)])],
            payments: vec![],
            simplify: false,
        });
        assert!(r.is_err());
    }

    fn fx(target: &str) -> Fx {
        Fx {
            target: target.into(),
            rates: [("IDR", 1_000_000), ("SGD", 12_000_000_000), ("JPY", 105_500_000)]
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
            decimals: [("IDR", 0), ("SGD", 2), ("JPY", 0)].into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
        }
    }

    #[test]
    fn convert_between_currencies() {
        let f = fx("IDR");
        assert_eq!(convert(2400, "SGD", "IDR", &f), Ok(288_000)); // SGD 24.00
        assert_eq!(convert(100_000, "IDR", "SGD", &f), Ok(833)); // SGD 8.33
        assert_eq!(convert(1000, "JPY", "IDR", &f), Ok(105_500));
        assert_eq!(convert(1000, "JPY", "SGD", &f), Ok(879)); // 105,500 / 12,000 = 8.79
        assert_eq!(convert(-2400, "SGD", "IDR", &f), Ok(-288_000));
        assert_eq!(convert(5, "IDR", "IDR", &f), Ok(5));
    }

    #[test]
    fn convert_needs_a_rate() {
        assert_eq!(convert(100, "THB", "IDR", &fx("IDR")), Err("rate:THB".into()));
    }

    #[test]
    fn converted_balances_merge_currencies() {
        let r = balances_converted(&ConvBalReq {
            expenses: vec![
                exp("IDR", &[("me", 200_000)], &[("me", 100_000), ("a", 100_000)]),
                exp("SGD", &[("a", 2400)], &[("me", 600), ("a", 1800)]),
            ],
            payments: vec![],
            simplify: false,
            fx: fx("IDR"),
        })
        .unwrap();
        // a owes me 100,000; I owe a SGD 6.00 = 72,000  ->  a owes me 28,000
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].currency, "IDR");
        assert_eq!(r[0].debts, vec![debt("a", "me", 28_000)]);
        assert_eq!(r[0].nets.iter().map(|n| n.amount).sum::<i64>(), 0);
    }

    #[test]
    fn converted_odd_amounts_still_add_up() {
        // 3 people share SGD 10.00; converted shares must still match the payer
        let r = balances_converted(&ConvBalReq {
            expenses: vec![exp("SGD", &[("a", 1000)], &[("a", 334), ("b", 333), ("c", 333)])],
            payments: vec![],
            simplify: false,
            fx: fx("JPY"),
        });
        assert!(r.is_ok());
        assert_eq!(r.unwrap()[0].nets.iter().map(|n| n.amount).sum::<i64>(), 0);
    }

    #[test]
    fn json_api_round_trip() {
        let out = call_json(1, r#"{"amount":100,"method":"equal","parts":[{"id":"a"},{"id":"b"},{"id":"c"}]}"#);
        assert_eq!(out, r#"{"data":[{"amount":34,"id":"a"},{"amount":33,"id":"b"},{"amount":33,"id":"c"}],"ok":true}"#);
        assert!(call_json(9, "{}").contains("\"ok\":false"));
    }
}
