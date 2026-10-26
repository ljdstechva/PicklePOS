/* PicklePOS - money math: court billing, Senior/PWD discount, totals */
(function (POS) {
  'use strict';
  const U = POS.util;
  const C = POS.calc = {};

  // Minutes to charge for a court session, from the rules in Settings.
  // Example (min 60, every 30, grace 5): 50m -> 60, 64m -> 60, 66m -> 90, 94m -> 90, 96m -> 120
  C.billMinutes = function (elapsed, s) {
    const min = Math.max(0, +s.courtMin || 0);
    const inc = Math.max(1, +s.courtInc || 1);
    const grace = Math.max(0, +s.courtGrace || 0);
    if (elapsed <= min) return min;
    const rem = elapsed - min;
    if (rem <= grace) return min;
    return min + Math.ceil((rem - grace) / inc) * inc;
  };

  // Court line -> { elapsed, billed, amount, running, active }
  C.court = function (l, now) {
    now = now || Date.now();
    if (l.mode === 'fixed') {
      return {
        elapsed: l.minutes, billed: l.minutes, amount: U.r2(l.minutes / 60 * l.rate),
        running: false, active: now >= l.start && now < l.end
      };
    }
    if (l.end && l.amount != null) {
      return { elapsed: l.elapsed, billed: l.billed, amount: l.amount, running: false, active: false };
    }
    const end = l.end || now;
    const elapsed = Math.max(0, (end - l.start) / 60000);
    const billed = C.billMinutes(elapsed, POS.state.settings);
    return {
      elapsed: elapsed, billed: billed, amount: U.r2(billed / 60 * l.rate),
      running: !l.end, active: !l.end
    };
  };

  // Freeze a court line's numbers (when the timer stops) so later rate changes don't alter history.
  C.freezeCourt = function (l, now) {
    if (l.mode === 'fixed') return;
    if (!l.end) l.end = now || Date.now();
    l.amount = null;
    const r = C.court(l, l.end);
    l.elapsed = r.elapsed;
    l.billed = r.billed;
    l.amount = r.amount;
  };

  C.lineAmount = (l, now) => (l.kind === 'court' ? C.court(l, now).amount : U.r2(l.price * l.qty));

  C.discountLabel = function (d) {
    if (!d) return '';
    if (d.type === 'senior') return 'Senior Citizen';
    if (d.type === 'pwd') return 'PWD';
    return d.reason || 'Discount';
  };

  C.totals = function (o, now) {
    const s = POS.state.settings;
    let food = 0, court = 0, courtMin = 0;
    o.lines.forEach((l) => {
      if (l.kind === 'court') {
        const r = C.court(l, now);
        court += r.amount;
        courtMin += r.billed;
      } else food += l.price * l.qty;
    });
    food = U.r2(food);
    court = U.r2(court);
    const sub = U.r2(food + court);
    const d = o.discount;
    let disc = 0, vatEx = 0, exemptNet = 0;

    if (d && (d.type === 'senior' || d.type === 'pwd')) {
      // RA 9994 / RA 10754: 20% off what the Senior/PWD consumed (+ VAT exemption if VAT-registered).
      // If the cashier ticked the Senior/PWD's own items, only those are discounted (their meal, not the
      // whole bill). If nothing is ticked, the bill is divided equally: bill / guests x Senior/PWD count.
      let share;
      const own = Array.isArray(d.lineIds) && d.lineIds.length ? d.lineIds : null;
      if (own) {
        share = 0;
        o.lines.forEach((l) => { if (own.indexOf(l.id) >= 0) share += C.lineAmount(l, now); });
        share = U.r2(share);
      } else {
        const base = food + (d.includeCourt ? court : 0);
        const pax = Math.max(1, +d.pax || 1);
        const cnt = Math.min(pax, Math.max(0, +d.count || 1));
        share = base / pax * cnt;
      }
      if (s.vatRegistered) {
        exemptNet = share / 1.12;
        vatEx = share - exemptNet;
        disc = exemptNet * 0.2;
      } else disc = share * 0.2;
    } else if (d && d.type === 'custom') {
      disc = d.mode === 'pct' ? sub * Math.min(100, +d.value || 0) / 100 : Math.min(+d.value || 0, sub);
    }
    disc = U.r2(disc);
    vatEx = U.r2(vatEx);
    const total = U.r2(Math.max(0, sub - disc - vatEx));
    let paid = 0, change = 0;
    (o.payments || []).forEach((p) => {
      paid += +p.amount || 0;
      change += Math.max(0, (+p.tendered || 0) - (+p.amount || 0));
    });
    const t = {
      food: food, court: court, courtMinutes: courtMin, subtotal: sub, discount: disc, vatExempt: vatEx,
      total: total, paid: U.r2(paid), balance: U.r2(total - paid), change: U.r2(change)
    };
    if (s.vatRegistered) {
      const seniorDisc = d && d.type !== 'custom' ? disc : 0;
      const vatableGross = total - (exemptNet - seniorDisc);
      t.vatableSales = U.r2(vatableGross / 1.12);
      t.vat = U.r2(vatableGross - vatableGross / 1.12);
      t.vatExemptSales = U.r2(exemptNet);
    }
    return t;
  };
})(window.POS);
