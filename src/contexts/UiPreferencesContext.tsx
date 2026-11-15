import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Category } from '../types/finance';
import { DEFAULT_CATEGORIES } from '../data/defaultState';

export type ThemeMode = 'light' | 'dark';
export type LanguageCode = 'es' | 'en';

const THEME_STORAGE_KEY = 'midas_theme_v1';
const LANG_STORAGE_KEY = 'midas_lang_v1';

interface UiPreferencesContextValue {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  toggleLang: () => void;
  tr: (es: string, en: string) => string;
  catName: (cat?: Category | null, fallback?: string) => string;
}

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

const CATEGORY_EN_MAP: Record<string, string> = {
  cat_vivienda: 'Housing & Rent',
  cat_supermercado: 'Groceries',
  cat_restaurantes: 'Dining & Coffee',
  cat_transporte: 'Transport',
  cat_servicios: 'Utilities (Power/Gas/Net)',
  cat_salud: 'Health & Pharmacy',
  cat_suscripciones: 'Subscriptions',
  cat_compras: 'Shopping & Home',
  cat_ocio: 'Leisure & Travel',
  cat_otros_gastos: 'Other Expenses',
  cat_sueldo: 'Salary',
  cat_dividendos: 'Dividends',
  cat_intereses: 'Interest',
  cat_otros_ingresos: 'Other Income',
  cat_transfer: 'Internal Transfer',
};

function readInitialTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore storage errors
  }
  return 'light';
}

function readInitialLang(): LanguageCode {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // ignore storage errors
  }
  return 'es';
}

export function UiPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);
  const [lang, setLangState] = useState<LanguageCode>(readInitialLang);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')),
    []
  );
  const setLang = useCallback((nextLang: LanguageCode) => setLangState(nextLang), []);
  const toggleLang = useCallback(
    () => setLangState((prev) => (prev === 'es' ? 'en' : 'es')),
    []
  );

  const tr = useCallback((es: string, en: string) => (lang === 'en' ? en : es), [lang]);

  const catName = useCallback(
    (cat?: Category | null, fallback = '') => {
      if (!cat) return fallback || (lang === 'en' ? 'Category' : 'Categoría');
      // Translate default categories only while the user hasn't renamed them.
      const defaultName = DEFAULT_CATEGORIES.find((c) => c.id === cat.id)?.name;
      if (lang === 'en' && CATEGORY_EN_MAP[cat.id] && (!defaultName || defaultName === cat.name)) {
        return CATEGORY_EN_MAP[cat.id];
      }
      return cat.name;
    },
    [lang]
  );

  return (
    <UiPreferencesContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        setTheme,
        toggleTheme,
        lang,
        setLang,
        toggleLang,
        tr,
        catName,
      }}
    >
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences(): UiPreferencesContextValue {
  const ctx = useContext(UiPreferencesContext);
  if (!ctx) {
    throw new Error('useUiPreferences must be used inside UiPreferencesProvider');
  }
  return ctx;
}
