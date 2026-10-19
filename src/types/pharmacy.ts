export type Role = 'super_admin' | 'pharmacist' | 'cashier' | 'warehouse_manager' | 'doctor';
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
  pharmacist: ALL.filter((m) => !['branches', 'users', 'audit'].includes(m)),
  cashier: ['dashboard', 'pos', 'returns', 'customers', 'shifts'],
  warehouse_manager: ['dashboard', 'products', 'barcode', 'transfers', 'adjust', 'expiry', 'receive', 'rtv', 'supplier'],
  doctor: ['doctor'],
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
}

export interface CartLine {
  product_id: number; name: string; dosage?: string | null; unit_price: number; list_price?: number; quantity: number; max: number;
}
