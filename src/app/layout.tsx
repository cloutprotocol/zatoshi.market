import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zatoshi.market - Zerdinals & ZRC20 Marketplace",
  description: "The premiere marketplace for Zerdinals & ZRC20 on Zcash",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.cdnfonts.com/css/vcr-osd-mono" rel="stylesheet" />
      </head>
      <body style={{ fontFamily: "'VCR OSD Mono', monospace" }}>{children}</body>
    </html>
  );
}
