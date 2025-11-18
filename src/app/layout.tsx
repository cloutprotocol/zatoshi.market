import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "zatoshi.market",
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover'
  },
  themeColor: '#000000',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'zatoshi.market'
  },
  openGraph: {
    title: 'zatoshi.market',
    images: ['/ogimage.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'zatoshi.market',
    images: ['/ogimage.png'],
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <link href="https://fonts.cdnfonts.com/css/vcr-osd-mono" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'VCR OSD Mono', monospace" }}>
        <Providers>
          <Header />
          {children}
        </Providers>
      </body>
    </html>
  );
}
