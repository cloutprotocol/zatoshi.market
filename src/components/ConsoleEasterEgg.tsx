'use client';

import { useEffect } from 'react';

export function ConsoleEasterEgg() {
    useEffect(() => {

        // Clear previous logs (Vercel, etc)
        console.clear();

        // Zatoshi ASCII Art
        const art = `
%c
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
    `;

        const style = 'color: #FFD700; font-weight: bold; font-family: monospace;';
        const textStyle = 'color: #FFD700; font-family: monospace; font-size: 12px;';

        console.log(art, style);
        console.log('%cZcash Inscription Marketplace', textStyle);
        console.log('%cIf you are looking for the code, you are in the right place.', 'color: #888; font-size: 10px;');
    }, []);

    return null;
}
