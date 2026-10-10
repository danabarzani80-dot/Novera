CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, phone TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','pharmacist','cashier','warehouse_manager','doctor')),
  branch_id INTEGER REFERENCES branches(id), specialty TEXT, lang TEXT DEFAULT 'en',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT UNIQUE, brand_name TEXT NOT NULL, generic_name TEXT,
  category TEXT, manufacturer TEXT, dosage TEXT, form TEXT, unit TEXT DEFAULT 'tablet', shelf_rack TEXT,
  is_rx INTEGER NOT NULL DEFAULT 0, reorder_level INTEGER NOT NULL DEFAULT 10,
  supplier_id INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL DEFAULT 1, batch_number TEXT NOT NULL, expiry_date DATE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0), purchase_price INTEGER NOT NULL DEFAULT 0,
  selling_price INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_batches_product ON batches(product_id, expiry_date);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, branch_id INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL, closed_at TEXT, opening_cash INTEGER NOT NULL DEFAULT 0, counted_cash INTEGER
);
CREATE TABLE IF NOT EXISTS customer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id), amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash', note TEXT, shift_id INTEGER, user_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
  customer_id INTEGER REFERENCES customers(id), branch_id INTEGER NOT NULL DEFAULT 1,
  shift_id INTEGER NOT NULL REFERENCES shifts(id), subtotal INTEGER NOT NULL, tax_amount INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0, grand_total INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','card','mixed','qarz')),
  cash_amount INTEGER NOT NULL DEFAULT 0, card_amount INTEGER NOT NULL DEFAULT 0, qarz_amount INTEGER NOT NULL DEFAULT 0,
  received_amount INTEGER NOT NULL DEFAULT 0, change_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, batch_id INTEGER NOT NULL REFERENCES batches(id), quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL, purchase_price INTEGER NOT NULL, total_amount INTEGER NOT NULL,
  returned_qty INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT
);
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), invoice_number TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  payment_type TEXT NOT NULL DEFAULT 'credit' CHECK (payment_type IN ('cash','credit')),
  total_cost INTEGER NOT NULL DEFAULT 0, user_id INTEGER, branch_id INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, approved_at TEXT
);
CREATE TABLE IF NOT EXISTS purchase_invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, batch_number TEXT, expiry_date DATE, quantity INTEGER NOT NULL,
  cost_price INTEGER NOT NULL, margin_pct REAL NOT NULL DEFAULT 0, selling_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), amount INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','old_invoice')), note TEXT, user_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rtv (
  id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL, reason TEXT, total INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rtv_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rtv_id INTEGER NOT NULL REFERENCES rtv(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, unit_cost INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id), refund_method TEXT NOT NULL,
  total INTEGER NOT NULL, user_id INTEGER, shift_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  invoice_item_id INTEGER NOT NULL, batch_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL, purchase_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, product_id INTEGER NOT NULL, system_qty INTEGER NOT NULL,
  counted_qty INTEGER NOT NULL, reason TEXT NOT NULL, user_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_branch INTEGER NOT NULL, to_branch INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','received','rejected')),
  user_id INTEGER, created_at TEXT NOT NULL, received_at TEXT
);
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, doctor_id INTEGER NOT NULL,
  destination TEXT NOT NULL CHECK (destination IN ('pharmacy','lab','both')),
  patient_name TEXT NOT NULL, patient_phone TEXT, patient_age INTEGER,
  status TEXT NOT NULL DEFAULT 'sent', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prescription_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, dose TEXT, instructions TEXT
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT,
  date DATE NOT NULL, user_id INTEGER
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id INTEGER, role TEXT, module TEXT NOT NULL,
  action_code TEXT NOT NULL, details_json TEXT
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
