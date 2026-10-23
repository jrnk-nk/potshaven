import {FINANCIAL_FEATURES_ENABLED} from './features.js';

export type NavItem = {key: string; label: string; icon: string};

const pages: Record<string, NavItem> = {
  overview: {key: 'overview', label: 'Home', icon: 'LayoutDashboard'},
  sites: {key: 'sites', label: 'Sites', icon: 'MapPin'},
  schedule: {key: 'schedule', label: 'Schedule', icon: 'CalendarDays'},
  inventory: {key: 'inventory', label: 'Inventory', icon: 'Sprout'},
  studio: {key: 'studio', label: 'Design studio', icon: 'WandSparkles'},
  assistant: {key: 'assistant', label: 'Company assistant', icon: 'MessageCircle'},
  team: {key: 'team', label: 'Team & vehicles', icon: 'UsersRound'},
  business: {key: 'business', label: 'Business', icon: 'ChartNoAxesCombined'},
  portfolio: {key: 'portfolio', label: 'Portfolio & reports', icon: 'Images'},
  activity: {key: 'activity', label: 'Manager activity', icon: 'Bell'},
};
const ownerNavigation = ['overview', 'sites', 'schedule', 'team', 'studio', 'inventory', 'assistant', 'portfolio', 'activity', ...(FINANCIAL_FEATURES_ENABLED ? ['business'] : [])].map(key => pages[key]);
const managerNavigation = ['overview', 'schedule', 'sites', 'inventory', 'team', 'assistant'].map(key => key === 'overview' ? {...pages[key], label: 'Today'} : pages[key]);
const managerPages = new Set([...managerNavigation.map(item => item.key), 'settings']);

/** Existing bookmarks continue to open the unified site workspace. */
export const canonicalPage = (hash: string): string => {
  const page = hash.split('?')[0];
  return ['places', 'projects'].includes(page) ? 'sites' : page || 'overview';
};
/** Preserve site deep links while replacing legacy navigation names. */
export const canonicalHash = (hash: string): string => canonicalPage(hash) + (hash.includes('?') ? hash.slice(hash.indexOf('?')) : '');
/** Unknown or missing roles receive no owner capabilities. The API is authoritative. */
export const roleIsOwner = (role: unknown): boolean => role === 'owner';
export function canAccessPage(role: unknown, page: string): boolean {
  const key = canonicalPage(page);
  if (key === 'business' && !FINANCIAL_FEATURES_ENABLED) return false;
  return roleIsOwner(role) ? key === 'settings' || Object.hasOwn(pages, key) : role === 'manager' && managerPages.has(key);
}
export const navigationFor = (role: unknown): NavItem[] => roleIsOwner(role) ? ownerNavigation : managerNavigation;
