import { en, type Translations } from "./en";
import { vi } from "./vi";

export type Locale = "en" | "vi";

export const locales: Record<Locale, Translations> = {
  en,
  vi,
};

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return Object.entries(params).reduce((acc, [key, val]) => {
    return acc.replace(new RegExp(`\\{${key}\\}`, "g"), String(val));
  }, template);
}

export type { Translations };
export { en, vi };
