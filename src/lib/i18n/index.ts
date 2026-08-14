// Importing this barrel initialises i18next.
//
// A module side effect, deliberately: both the Astro prerender and every hydrating island need an
// initialised instance before their first render, and `useTranslation` throws without one. A
// provider component would work in the app but not during the prerender of an island that renders
// `Report` directly. `initI18n` is idempotent, so importing this from twenty files costs nothing.

import { initI18n } from './config';

initI18n();

export { DEFAULT_LOCALE, NAMESPACES, RESOURCES, initI18n } from './config';
export type { Locale } from './config';
export { default as i18n } from './config';
