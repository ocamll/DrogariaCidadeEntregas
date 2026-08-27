// O VOCABULÁRIO DAS FORMAS DE PAGAMENTO, e a leitura do evento
// `pagamento_alterado`.
//
// Este arquivo NÃO IMPORTA NADA além de `money.ts`, que também não
// importa nada. Mesma disciplina de `texto.ts`, `papeis.ts`,
// `canonico.ts` e `estadoDeConsulta.ts`.
//
// ELE SAIU DE `data/pagamentos.ts` NO E3.A, e o motivo é o de sempre
// neste projeto: `data/pagamentos.ts` importa o cliente Supabase, que lê
// `import.meta.env` — e isso não existe sob `tsx`. Enquanto a regra
// morava lá, ela não tinha como ser exercitada fora do navegador.
//
// `data/pagamentos.ts` reexporta tudo, então nenhum importador mudou.
//
// ---------------------------------------------------------------------
// AS DUAS FORMAS DO EVENTO, E POR QUE ELAS SÃO PERMANENTES
//
//   `para`  string única  →  lista   quando a divergência passou a
//                                    aceitar mais de uma forma na porta
//   `de`    string única  →  lista   no E3, porque um vale pode ter mais
//                                    de um pagamento previsto
//
// `eventos` é APPEND-ONLY (regra 6). Os antigos nunca vão ser
// reescritos, então ler as duas formas não é janela de compatibilidade
// como a da fila — é o histórico, e é para sempre.
//
// A ordem do E3 é reader-first: os leitores aprendem a nova forma
// (E3.A) ANTES de o SQL passar a escrevê-la (E3.B). Inverter faria um
// cliente antigo receber um payload que ele não sabe interpretar, e o
// sintoma apareceria numa tela de auditoria.

import { formatBRL } from '@/lib/money'

export type FormaPagamento =
  | 'dinheiro'
  | 'credito'
  | 'debito'
  | 'pix'
  | 'convenio'
  | 'convcard'
  | 'crediario'
  | 'outro'

export const FORMA_PAGAMENTO_LABEL: Record<FormaPagamento, string> = {
  dinheiro: 'Dinheiro',
  credito: 'Crédito',
  debito: 'Débito',
  pix: 'Pix',
  convenio: 'Convênio',
  convcard: 'ConvCard',
  crediario: 'Crediário',
  outro: 'Outro',
}

export const FORMA_PAGAMENTO_OPTIONS = Object.entries(FORMA_PAGAMENTO_LABEL) as Array<
  [FormaPagamento, string]
>

/** Uma forma com valor, como o evento novo grava. */
export type FormaComValor = { forma: FormaPagamento; valor_cents: number }

/** O que cada lado do evento pode ser — hoje e no histórico. */
export type LadoDoPagamentoAlterado = FormaPagamento | FormaComValor[] | null | undefined

/** Marca a forma legada, que não carrega valor. Ver `formasDoEvento`. */
const SEM_VALOR = -1

/**
 * Normaliza qualquer uma das formas numa lista.
 *
 * A string legada NÃO carrega valor, e isso é fato do histórico, não
 * lacuna a preencher: inventar um `valor_cents` faria o Registro de
 * Auditoria afirmar um número que ninguém gravou.
 */
export function formasDoEvento(lado: LadoDoPagamentoAlterado): FormaComValor[] {
  if (lado == null) return []
  if (Array.isArray(lado)) return lado
  return [{ forma: lado, valor_cents: SEM_VALOR }]
}

/**
 * O texto de um lado do evento: `"Pix (R$ 10,00) + Dinheiro (R$ 5,00)"`.
 *
 * Forma fora do enum sai CRUA em vez de sumir: o CHECK de `forma` já
 * mudou uma vez no banco (`vale` saiu, `convcard` e `crediario`
 * entraram — §64), e um evento antigo com a forma antiga precisa
 * continuar legível.
 */
export function textoDoPagamentoAlterado(lado: LadoDoPagamentoAlterado): string {
  const formas = formasDoEvento(lado)
  if (formas.length === 0) return '—'
  return formas
    .map((f) => {
      const rotulo = FORMA_PAGAMENTO_LABEL[f.forma] ?? f.forma
      return f.valor_cents === SEM_VALOR ? rotulo : `${rotulo} (${formatBRL(f.valor_cents)})`
    })
    .join(' + ')
}
