// Verifies every translation key used in src/ exists with EN, KU and AR text.
// Run: npx tsx tests/i18n-check.ts [--list]   (--list prints the keys used, for authoring)
import fs from 'node:fs';
import path from 'node:path';
import { dictionary } from '../src/i18n/translations';

const root = path.resolve(import.meta.dirname, '../src');
const files: string[] = [];
(function walk(d: string) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p); else if (/\.tsx?$/.test(f.name) && !p.endsWith('translations.ts')) files.push(p);
  }
})(root);

const used = new Set<string>();
const KEYLIKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$|^(pay|nav|sec|st|sub|reason|exp|tr|role|tx|dest|status)_\w+$/;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  // t('key') / t(cond ? 'a' : 'b')
  for (const m of src.matchAll(/\bt\(([^()]*?)(?:,\s*\{[^}]*\})?\)/g)) for (const l of m[1].matchAll(/'([a-z][a-z0-9_]*)'/g)) used.add(l[1]);
  // literals used as keys through variables (menus, maps)
  for (const l of src.matchAll(/'((?:pay|nav|sec|st|sub|reason|exp|tr|role|tx|dest|status)_[a-z0-9_]+)'/g)) used.add(l[1]);
  for (const l of src.matchAll(/'(t_[a-z_]+)'/g)) used.add(l[1]);
}
// Dynamic key families
['damaged', 'lost', 'expired_disposal', 'count_correction'].forEach((r) => used.add('reason_' + r));
['expired', 'critical', 'warning', 'good'].forEach((r) => used.add('st_' + r));
['rent', 'salaries', 'utilities', 'other'].forEach((r) => used.add('exp_' + r));
['pending', 'approved', 'received', 'rejected'].forEach((r) => used.add('tr_' + r));
['super_admin', 'pharmacist', 'cashier', 'warehouse_manager', 'doctor'].forEach((r) => used.add('role_' + r));


if (process.argv.includes('--list')) { console.log([...used].filter((k) => KEYLIKE.test(k) || true).sort().join('\n')); process.exit(0); }

const IGNORE = new Set(['exp_', 'reason_', 'st_', 'tr_', 'role_', 'dispensed', 'payment', 'old_invoice']);
const missing = [...used].filter((k) => !IGNORE.has(k)).filter((k) => !dictionary[k]).sort();
const incomplete = Object.entries(dictionary).filter(([, v]) => v.length !== 3 || v.some((s) => !s)).map(([k]) => k);
// Literal English-looking words picked by the regex that are not keys are ignored only if absent from both lists.
if (missing.length || incomplete.length) {
  if (missing.length) console.error('Missing keys:\n  ' + missing.join('\n  '));
  if (incomplete.length) console.error('Incomplete translations:\n  ' + incomplete.join('\n  '));
  process.exit(1);
}
console.log(`i18n OK: ${used.size} keys used, ${Object.keys(dictionary).length} defined.`);
