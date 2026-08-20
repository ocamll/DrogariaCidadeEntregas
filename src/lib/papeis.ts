// O cargo de quem assinou pelo lado da farmácia, no INSTANTE da
// assinatura (`assinaturas.papel_no_momento`, gravado desde 2026-08-19).
//
// Mora em `lib/` e não importa nada porque a PÁGINA do romaneio e o PDF
// do romaneio precisam dizer exatamente a mesma coisa — e eles já
// divergiram uma vez: o PDF sabia mostrar os relógios da corrida e a
// página não, então o mesmo documento contava duas histórias conforme
// onde se olhasse. Duas cópias deste mapa seriam o mesmo defeito, com um
// rótulo no lugar de um relógio. (Não importar nada é também o que
// permite o `romaneio-pdf.spec.mts` rodar em `npx tsx`, fora do Vite.)
//
// NÃO confundir com `PAPEL_USUARIO_LABEL` (`data/usuarios.ts`), que é o
// cargo de HOJE e é editável no painel, nem com o mapa do `AppLayout`,
// que inclui `agencia` e `superadmin` — papéis que não selam romaneio.
// Este cobre só o que a coluna aceita.
export type PapelNoMomento = 'caixa' | 'gerente' | 'admin'

export const PAPEL_NO_MOMENTO_LABEL: Record<PapelNoMomento, string> = {
  caixa: 'Caixa',
  gerente: 'Gerente',
  admin: 'Administrador',
}

/**
 * Nulo nas assinaturas anteriores a 2026-08-19, e aí o certo é a tela não
 * dizer nada: derivar de `profiles.papel` mostraria o cargo de hoje para
 * um ato de meses atrás, que é exatamente o que a coluna existe pra
 * evitar. Valor desconhecido volta cru em vez de sumir.
 */
export function rotuloDoPapelNoMomento(papel: string | null | undefined): string | null {
  if (!papel) return null
  return PAPEL_NO_MOMENTO_LABEL[papel as PapelNoMomento] ?? papel
}
