export type NavItem = {key: string; label: string; icon: string};

const pages: Record<string, NavItem> = {
  overview: {key: 'overview', label: 'Home', icon: 'LayoutDashboard'},
  schedule: {key: 'schedule', label: 'Schedule', icon: 'CalendarDays'},
  places: {key: 'places', label: 'Places', icon: 'MapPin'},
  inventory: {key: 'inventory', label: 'Inventory', icon: 'Sprout'},
  studio: {key: 'studio', label: 'Design studio', icon: 'WandSparkles'},
  assistant: {key: 'assistant', label: 'Company assistant', icon: 'MessageCircle'},
  projects: {key: 'projects', label: 'Projects', icon: 'FolderKanban'},
  team: {key: 'team', label: 'Team & vehicles', icon: 'UsersRound'},
  business: {key: 'business', label: 'Business', icon: 'ChartNoAxesCombined'},
  portfolio: {key: 'portfolio', label: 'Portfolio & reports', icon: 'Images'},
};
const ownerNavigation = ['overview', 'projects', 'business', 'team', 'studio', 'schedule', 'places', 'inventory', 'assistant', 'portfolio'].map(key => pages[key]);
const managerNavigation = ['overview', 'schedule', 'places', 'inventory', 'team', 'projects', 'assistant'].map(key => key === 'overview' ? {...pages[key], label: 'Today'} : pages[key]);
const managerPages = new Set([...managerNavigation.map(item => item.key), 'settings']);

/** Unknown or missing roles receive no owner capabilities. The API is authoritative. */
export const roleIsOwner = (role: unknown): boolean => role === 'owner';
export function canAccessPage(role: unknown, page: string): boolean {
  return roleIsOwner(role) ? page === 'settings' || Object.hasOwn(pages, page) : role === 'manager' && managerPages.has(page);
}
export const navigationFor = (role: unknown): NavItem[] => roleIsOwner(role) ? ownerNavigation : managerNavigation;
