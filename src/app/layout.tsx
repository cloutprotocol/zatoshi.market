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
      <body>{children}</body>
    </html>
  );
}
