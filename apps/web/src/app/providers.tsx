'use client';

import { useState } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/primitives';
import { ApiRequestError } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // coming back to the tab shows the latest (live updates cover the rest)
            refetchOnWindowFocus: true,
            // Don't retry "not allowed" / "not found" - only network-type failures.
            retry: (count, err) => !(err instanceof ApiRequestError && err.status < 500) && count < 2,
          },
        },
        // After any successful save, refresh every list on screen.
        mutationCache: new MutationCache({
          onSuccess: (_data, _vars, _ctx, mutation) => {
            if (mutation.options.meta?.skipInvalidate) return;
            void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
          },
        }),
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          {children}
          {/* below the 56 px top bar, so pop-ups never cover the chat / bell / user buttons */}
          <Toaster richColors position="top-right" closeButton offset={{ top: 64, right: 16 }} mobileOffset={{ top: 64, right: 12, left: 12 }} />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { skipInvalidate?: boolean };
  }
}
