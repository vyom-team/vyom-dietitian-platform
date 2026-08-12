"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme provider.
 *
 * `next-themes` arrived as a dependency of the toast component; reusing it here
 * avoids hand-rolling the inline script needed to apply the stored theme before
 * first paint (which is what prevents a flash of the wrong theme).
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
