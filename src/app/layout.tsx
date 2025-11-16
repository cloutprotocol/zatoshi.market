import type { Metadata } from "next";
import "./globals.css";

// For now using system monospace - add VCR_OSD_MONO.woff2 to /src/app/fonts/ to enable custom font
// Download from: https://www.dafont.com/vcr-osd-mono.font
const vcrOsdMono = {
  className: "font-mono",
};

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
      <body className={vcrOsdMono.className}>{children}</body>
    </html>
  );
}
