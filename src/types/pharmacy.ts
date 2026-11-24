export type Role = 'super_admin' | 'pharmacist' | 'cashier' | 'warehouse_manager' | 'doctor' | 'accountant';
export type Lang = 'en' | 'ku' | 'ar';

export type Module =
  | 'dashboard' | 'pos' | 'returns' | 'doctor'
  | 'products' | 'barcode' | 'transfers' | 'adjust' | 'expiry' | 'receive' | 'rtv' | 'supplier'
  | 'customers' | 'shifts' | 'accounting'
  | 'branches' | 'users' | 'audit' | 'architecture';

const ALL: Module[] = [
  'dashboard', 'pos', 'returns', 'doctor', 'products', 'barcode', 'transfers', 'adjust', 'expiry',
  'receive', 'rtv', 'supplier', 'customers', 'shifts', 'accounting', 'branches', 'users', 'audit', 'architecture',
];

export const ROLE_MODULES: Record<Role, Module[]> = {
  super_admin: ALL,
  // Each branch is a separate pharmacy: moving stock between branches is for the admin and the warehouse manager.
  // Profit, net profit and cost of goods sold (accounting / P&L) are admin-only.
  pharmacist: ALL.filter((m) => !['branches', 'users', 'audit', 'transfers', 'accounting'].includes(m)),
  cashier: ['dashboard', 'pos', 'returns', 'customers', 'shifts'],
  // The warehouse manager may also move stock between branches (sent from their own branch, received into it).
  warehouse_manager: ['dashboard', 'products', 'barcode', 'adjust', 'expiry', 'receive', 'rtv', 'supplier', 'transfers'],
  doctor: ['doctor'],
  // Accountant: Accounting only, view-only, totals without cost or profit; can switch between branches.
  accountant: ['accounting'],
};

export const can = (role: Role, m: Module) => ROLE_MODULES[role]?.includes(m) ?? false;

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: Role;
  branch_id: number;
  specialty: string | null;
  lang: Lang;
}

export interface Product {
  id: number; barcode: string | null; brand_name: string; generic_name: string | null; category: string | null;
  manufacturer: string | null; dosage: string | null; form: string | null; unit: string | null;
  shelf_rack: string | null; is_rx: number; reorder_level: number; supplier_id: number | null;
  stock?: number; total_stock?: number; price?: number; nearest_expiry?: string | null; cost?: number;
  sheets_per_pack?: number; sheet_price?: number | null; tablets_per_sheet?: number; tablet_price?: number | null; loose?: number;
}

export interface CartLine {
  product_id: number; name: string; dosage?: string | null; unit_price: number; list_price?: number; quantity: number; max: number;
  key?: string; unit?: 'pack' | 'sheet' | 'tablet';
}
