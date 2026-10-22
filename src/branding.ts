export const BRAND_NAME = 'PotsHavenGh';
export const BRAND_TAGLINE = 'Brighten your world';
export const BRAND_LOGO_PREVIEW = '/branding/potshaven-logo-preview.webp';
export const BRAND_LOGO = '/branding/potshaven-logo.png';
export function withBrandDefaults(settings: Record<string, any> = {}) {
  return {
    ...settings,
    companyName: !settings.companyName || settings.companyName === 'PotsHaven' ? BRAND_NAME : settings.companyName,
    tagline: !settings.tagline || ['Beautiful spaces. Thoughtfully cared for.', 'Thoughtfully designed. Beautifully cared for.'].includes(settings.tagline) ? BRAND_TAGLINE : settings.tagline,
    logo: settings.logo || BRAND_LOGO,
  };
}
