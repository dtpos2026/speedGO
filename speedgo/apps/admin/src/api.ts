import { createApi } from '@speedgo/ui';

export const api = createApi('speedgo-admin-token', () => window.dispatchEvent(new Event('speedgo:logout')));

export interface AdminMe {
  id: number;
  email: string;
  name: string;
  roleKey: string;
  roleLabel: string;
  permissions: string[];
}
