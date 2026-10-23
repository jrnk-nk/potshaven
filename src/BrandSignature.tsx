import {BRAND_LOGO, BRAND_LOGO_PREVIEW, BRAND_NAME, BRAND_TAGLINE} from './branding';
import './BrandSignature.css';

type Props = {settings?: Record<string, any>; compact?: boolean; className?: string};

export default function BrandSignature({settings = {}, compact = false, className = ''}: Props) {
  const name = settings.companyName || BRAND_NAME;
  const logo = !settings.logo || settings.logo === BRAND_LOGO ? BRAND_LOGO_PREVIEW : settings.logo;
  return <div className={`brand-signature${compact ? ' bs-compact' : ''} ${className}`.trim()}>
    <img className="bs-logo" src={logo} alt={`${name} logo`} />
    <div className="bs-copy"><strong>{name}</strong><span>{settings.tagline || BRAND_TAGLINE}</span></div>
  </div>;
}
