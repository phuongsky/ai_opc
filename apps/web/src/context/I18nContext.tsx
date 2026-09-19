"use client";

import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { locales, type Locale, type Translations, interpolate } from "@/locales";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  interpolate: (template: string, params?: Record<string, string | number>) => string;
}

const STORAGE_KEY = "ai_opc_lang";

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Default is English as requested
  const [locale, setLocaleState] = useState<Locale>("en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved && (saved === "en" || saved === "vi")) {
        setLocaleState(saved);
        document.documentElement.lang = saved;
      } else {
        document.documentElement.lang = "en";
      }
    } catch {
      // ignore localStorage error on restricted environments
    } finally {
      setMounted(true);
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
      document.documentElement.lang = newLocale;
    } catch {
      // ignore
    }
  };

  const t = useMemo(() => {
    return locales[locale] || locales.en;
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      interpolate,
    }),
    [locale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback if rendered outside provider
    return {
      locale: "en" as Locale,
      setLocale: () => {},
      t: locales.en,
      interpolate,
    };
  }
  return ctx;
}
