// Role-based access control. The UI hides modules, but the SERVER enforces every one of these checks.

export const PERMISSIONS = [
  'live:view',
  'drivers:view',
  'drivers:verify',
  'drivers:manage',
  'customers:view',
  'customers:manage',
  'rides:view',
  'rides:manage',
  'finance:view',
  'finance:manage',
  'pricing:view',
  'pricing:manage',
  'support:manage',
  'roles:manage',
  'audit:view',
  'exec:view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface RoleDef {
  key: string;
  label: string;
  perms: Permission[];
  citySpecific?: boolean;
}

const all = [...PERMISSIONS];

export const ROLES: RoleDef[] = [
  { key: 'super_admin', label: 'Super Admin', perms: all },
  { key: 'business_owner', label: 'Business Owner', perms: all },
  { key: 'director', label: 'Director', perms: ['live:view', 'drivers:view', 'customers:view', 'rides:view', 'finance:view', 'pricing:view', 'audit:view', 'exec:view'] },
  { key: 'regional_manager', label: 'Regional Manager', perms: ['live:view', 'drivers:view', 'drivers:manage', 'customers:view', 'rides:view', 'rides:manage', 'pricing:view', 'support:manage', 'exec:view'] },
  { key: 'operations_manager', label: 'Operations Manager', perms: ['live:view', 'drivers:view', 'drivers:manage', 'customers:view', 'rides:view', 'rides:manage', 'support:manage'] },
  { key: 'city_manager', label: 'City Manager', citySpecific: true, perms: ['live:view', 'drivers:view', 'drivers:manage', 'customers:view', 'rides:view', 'rides:manage', 'support:manage'] },
  { key: 'finance_manager', label: 'Finance Manager', perms: ['finance:view', 'finance:manage', 'rides:view', 'drivers:view', 'exec:view'] },
  { key: 'marketing_manager', label: 'Marketing Manager', perms: ['customers:view', 'rides:view', 'exec:view'] },
  { key: 'verification_officer', label: 'Driver Verification Officer', perms: ['drivers:view', 'drivers:verify'] },
  { key: 'customer_support', label: 'Customer Support', perms: ['customers:view', 'rides:view', 'support:manage'] },
];

export const roleByKey = (key: string) => ROLES.find((r) => r.key === key);
export const hasPerm = (roleKey: string, perm: Permission) => !!roleByKey(roleKey)?.perms.includes(perm);
