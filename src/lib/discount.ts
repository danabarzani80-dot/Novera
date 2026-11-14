// Discount limits — shared by the till (browser) and the server so both apply the exact same rule.
//
// - Discounts are entered in dinars only, in steps of the smallest note in use (250 IQD).
// - Each role has a maximum discount percentage set by the admin (default 0 = no discount).
// - For a sale, the cap is subtotal × role % rounded DOWN to a multiple of 250.
// - The admin (super_admin) is unlimited: the cap is the subtotal rounded down to 250.

export const NOTE_STEP = 250;

/** Roles whose discount ceiling the admin sets on the Settings page. Any other non-admin role gets 0. */
export const DISCOUNT_ROLES = ['cashier', 'pharmacist'] as const;
export type DiscountRole = (typeof DISCOUNT_ROLES)[number];

export const discountSettingKey = (role: DiscountRole) => `max_discount_pct_${role}`;

/** A stored percentage is valid only as a whole number from 0 to 100. Anything else counts as 0. */
export const cleanPct = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : 0;
};

/** Largest discount (IQD) allowed on a sale. `pct` is ignored for the admin. */
export function discountCap(subtotal: number, role: string, pct: number): number {
  const s = Math.max(0, Math.floor(subtotal));
  if (role === 'super_admin') return Math.floor(s / NOTE_STEP) * NOTE_STEP;
  const p = cleanPct(pct);
  // Integer maths: subtotal × p / 100 / 250, rounded down, then × 250.
  return Math.floor((s * p) / (100 * NOTE_STEP)) * NOTE_STEP;
}

export type DiscountProblem = 'not_whole' | 'step' | 'cap' | null;

/** Checks a discount amount against the cap. Returns null when it is acceptable. */
export function checkDiscount(amount: number, cap: number): DiscountProblem {
  if (!Number.isInteger(amount) || amount < 0) return 'not_whole';
  if (amount % NOTE_STEP !== 0) return 'step';
  if (amount > cap) return 'cap';
  return null;
}
