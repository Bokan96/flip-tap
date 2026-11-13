/*
 * Imported first by main.ts: puts the chosen language's texts in place before any screen (or any
 * module that reads them) runs.
 */
import { applyLanguage, getLanguage } from './content/i18n';

applyLanguage(getLanguage());
