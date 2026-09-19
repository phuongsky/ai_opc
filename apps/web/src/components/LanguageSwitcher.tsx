"use client";

import React from "react";
import { useI18n } from "@/context/I18nContext";
import { Globe } from "lucide-react";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale } = useI18n();

  return (
    <div
      className={`inline-flex items-center rounded-xl border border-border/80 bg-panel/80 p-0.5 backdrop-blur-md shadow-sm ${className}`}
      role="group"
      aria-label="Language selector"
    >
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
          locale === "en"
            ? "bg-accent text-black shadow-md shadow-accent/20"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
        }`}
        title="Switch to English (Default)"
      >
        <span>🇺🇸</span>
        <span>EN</span>
      </button>

      <button
        type="button"
        onClick={() => setLocale("vi")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
          locale === "vi"
            ? "bg-accent text-black shadow-md shadow-accent/20"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
        }`}
        title="Chuyển sang Tiếng Việt"
      >
        <span>🇻🇳</span>
        <span>VI</span>
      </button>
    </div>
  );
}
