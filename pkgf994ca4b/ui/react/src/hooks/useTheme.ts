/*
 * Copyright 2009-2026 C3 AI (www.c3.ai). All Rights Reserved.
 * Confidential and Proprietary C3 Materials.
 * This material, including without limitation any software, is the confidential trade secret and proprietary
 * information of C3 and its licensors. Reproduction, use and/or distribution of this material in any form is
 * strictly prohibited except as set forth in a written license agreement with C3 and/or its authorized distributors.
 * This material may be covered by one or more patents or pending patent applications.
 */

import { useEffect, useState } from 'react';

export type ThemeType = 'light' | 'dark';

const STORAGE_KEY = 'ui-theme';

/**
 * Theme hook: toggles `dark` on <html> and persists preference.
 * Styling uses C3 tokens + shadcn CSS variables.
 *
 * **Dark is the default, not a preference.** Every colour decision in this
 * application — the sequential ramp on the campus map and matrix, the
 * categorical series, the reserved status palette — was contrast-validated
 * against the dark chart surface, so light mode is an explicit opt-out rather
 * than something inherited from the OS. The initial state is already `'dark'`,
 * which also removes the white flash on first paint.
 */
export const useTheme = (): { currentTheme: ThemeType; toggleTheme: () => void } => {
  const [currentTheme, setCurrentTheme] = useState<ThemeType>('dark');

  useEffect(() => {
    const html = document.documentElement;

    const stored = localStorage.getItem(STORAGE_KEY) as ThemeType | null;
    const theme: ThemeType = stored === 'light' ? 'light' : 'dark';

    html.classList.toggle('dark', theme === 'dark');
    setCurrentTheme(theme);
  }, []);

  const toggleTheme = (): void => {
    const html = document.documentElement;
    const next: ThemeType = currentTheme === 'light' ? 'dark' : 'light';

    setCurrentTheme(next);
    html.classList.toggle('dark', next === 'dark');
    localStorage.setItem(STORAGE_KEY, next);
    localStorage.setItem('darkMode', next === 'dark' ? 'true' : 'false');

    document.dispatchEvent(new CustomEvent('c3-theme-changed', { detail: { theme: next } }));
  };

  return { currentTheme, toggleTheme };
};
