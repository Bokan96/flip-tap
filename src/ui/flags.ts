import type { Lang } from '../content/i18n';

/**
 * Flags for the language picker. Drawn inline so they look the same everywhere (Windows has no
 * flag emoji). Every language in LANGUAGES needs one here.
 */
export const FLAGS: Record<Lang, string> = {
  // United Kingdom
  en: `<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <clipPath id="flag-uk-diag"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath>
    <rect width="60" height="30" fill="#012169"/>
    <path d="M0,0 60,30M60,0 0,30" stroke="#fff" stroke-width="6"/>
    <path d="M0,0 60,30M60,0 0,30" stroke="#c8102e" stroke-width="4" clip-path="url(#flag-uk-diag)"/>
    <path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/>
    <path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/>
  </svg>`,
  // Serbia (national tricolour)
  sr: `<svg viewBox="0 0 3 2" preserveAspectRatio="none" aria-hidden="true">
    <rect width="3" height="2" fill="#fff"/>
    <rect width="3" height="1.334" fill="#0c4076"/>
    <rect width="3" height=".667" fill="#c6363c"/>
  </svg>`,
};
