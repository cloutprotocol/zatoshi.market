import type { Metadata } from "next";
import "./globals.css";
import { ClientLayout } from "@/components/ClientLayout";

export const metadata: Metadata = {
  title: "ZORDINALS.MARKET",
  description: "Host and trade ZRC20 tokens, ZMAPS, and Zerdinal inscriptions on Zcash.",
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
      <body style={{ fontFamily: "'VCR OSD Mono', monospace" }}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
