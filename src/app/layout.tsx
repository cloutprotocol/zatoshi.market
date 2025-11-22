import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "zatoshi.market",
  description: "Host and trade ZRC20 tokens, ZMAPS, and inscriptions on Zcash.",
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
        {/*
                                                   :
                                                  t#,           .
                                                 ;##W.         ;W.    .      t
                                  .. GEEEEEEEL  :#L:WE        f#EDi   Dt     Ej
       ,##############Wf.        ;W, ,;;L#K;;. .KG  ,#D     .E#f E#i  E#i    E#,
        ........jW##Wt          j##,    t#E    EE    ;#f   iWW;  E#t  E#t    E#t
              tW##Kt           G###,    t#E   f#.     t#i L##LffiE#t  E#t    E#t
            tW##E;           :E####,    t#E   :#G     GK tLLG##L E########f. E#t
          tW##E;            ;W#DG##,    t#E    ;#L   LW.   ,W#i  E#j..K#j... E#t
       .fW##D,             j###DW##,    t#E     t#f f#:   j#E.   E#t  E#t    E#t
     .f###D,              G##i,,G##,    t#E      f#D#;  .D#j     E#t  E#t    E#t
   .f####Gfffffffffff;  :K#K:   L##,    t#E       G#t  ,WK,      f#t  f#t    E#t
  .fLLLLLLLLLLLLLLLLLi ;##D.    L##,     fE        t   EG.        ii   ii    E#t
                       ,,,      .,,       :            ,                     ,;.
        */}
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
