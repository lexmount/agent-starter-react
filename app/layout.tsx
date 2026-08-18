import type { Metadata } from 'next';
import { headers } from 'next/headers';
import '@lexmount/agentwidget-sdk/styles.css';
import { ApplyThemeScript } from '@/components/app/theme-toggle';
import { cn, getAppConfig, getStyles } from '@/lib/utils';
import '@/styles/agentwidget-frontdesk.css';
import '@/styles/globals.css';

const metadataBaseUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(metadataBaseUrl),
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const hdrs = await headers();
  const appConfig = await getAppConfig(hdrs);
  const { pageTitle, pageDescription } = appConfig;
  const styles = getStyles(appConfig);

  return (
    <html lang="en" suppressHydrationWarning className={cn('scroll-smooth font-sans antialiased')}>
      <head>
        {styles && <style>{styles}</style>}
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <ApplyThemeScript />
      </head>
      <body className="overflow-x-hidden">{children}</body>
    </html>
  );
}
