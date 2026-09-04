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

import { centsFromDigits, formatBRL } from '@/lib/money'

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

/**
 * O VALOR DE CADA LINHA, com a que o caixa não digitou absorvendo o
 * resto.
 *
 * O caixa tem fila no balcão. Dividindo R$ 137,43 em Pix e Dinheiro, ele
 * digitava o valor de uma forma e calculava a outra DE CABEÇA — e é
 * justamente no número quebrado, que é quando a divisão costuma
 * acontecer, que a subtração custa mais. A tela sabe fazer essa conta.
 *
 * **A regra generaliza o que o E4 já fazia com uma forma só.** Lá o
 * valor previsto É o da compra e o campo nem aparece, porque não há o
 * que dividir: com uma linha, ela está determinada. Com N linhas, as
 * N-1 que o caixa preencheu determinam a última do mesmo jeito — a soma
 * bater com a compra é regra dura (`validarFormasPrevistas`), não
 * preferência, então o resto não é palpite.
 *
 * ```
 * Pix       R$ 100,00   ← digitado
 * Dinheiro  R$  37,43   ← daqui
 * ```
 *
 * **Vazio é o sinal, e ele não precisa de estado paralelo.** `digitos`
 * já distingue "ainda não preenchi" de "é zero" — é o mesmo contrato do
 * `CampoMoeda`, que mostra campo vazio em vez de "0,00" exatamente pra
 * essa distinção existir. Apagar o campo devolve a linha à derivação,
 * que é o gesto certo pra "recalcule pra mim".
 *
 * **Só deriva com EXATAMENTE uma linha vazia**, e as duas exclusões
 * importam:
 *
 *   - com duas ou mais vazias o resto não teria como ser repartido sem
 *     a tela inventar uma divisão que ninguém pediu;
 *   - com nenhuma vazia o caixa determinou tudo, e conferir a soma volta
 *     a ser de `validarFormasPrevistas` — que continua sendo quem
 *     recusa. Aqui não se valida nada.
 *
 * **Resto zero ou negativo NÃO é derivado.** Preencher R$ 0,00 daria uma
 * linha que a validação recusa logo em seguida, e negativo é
 * irrepresentável num campo de dígitos. Nos dois casos a linha fica
 * vazia e quem explica é a tela, que tem vocabulário pra isso.
 *
 * Puro e sem opinião de tela: devolve os valores e QUAL índice foi
 * calculado. Quem exibe decide o que dizer.
 */
export function resolverValoresDasFormas(
  digitosPorLinha: string[],
  totalCents: number
): { valoresCents: number[]; indiceDerivado: number | null } {
  const valoresCents = digitosPorLinha.map((digitos) => centsFromDigits(digitos))

  const vazias = digitosPorLinha.reduce<number[]>(
    (indices, digitos, i) => (digitos === '' ? [...indices, i] : indices),
    []
  )
  if (vazias.length !== 1) return { valoresCents, indiceDerivado: null }

  // A linha vazia contribui com 0, então o resto é o total menos a soma
  // de TODAS — não é preciso somar "as outras" em separado.
  const resto = totalCents - valoresCents.reduce((soma, cents) => soma + cents, 0)
  if (resto <= 0) return { valoresCents, indiceDerivado: null }

  const indiceDerivado = vazias[0]
  const comResto = [...valoresCents]
  comResto[indiceDerivado] = resto
  return { valoresCents: comResto, indiceDerivado }
}

/**
 * Os dígitos que o campo derivado exibe.
 *
 * `centsFromDigits` e esta função são inversas sobre inteiro positivo
 * (`'3743'` ↔ `3743`), então a linha calculada atravessa o `CampoMoeda`
 * pela MESMA porta que a digitada — sem um segundo caminho de formatação
 * que pudesse divergir do primeiro.
 */
export function digitosDoValor(cents: number): string {
  return cents > 0 ? String(cents) : ''
}

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

// =====================================================================
// E4 — O PAGAMENTO PREVISTO PASSA A SER 1:N
//
// Até aqui um vale tinha UMA forma prevista, e ela valia a compra
// inteira. O E3 tirou a premissa do modelo (o id do previsto deixou de
// ser derivado da entrega); o E4 é quem passa a usar.
//
// As duas regras abaixo moram aqui, e não na tela, pelo motivo de
// sempre: **regra que decide o que a tela AFIRMA não pode depender de
// navegador pra ser exercitada.** A primeira versão do helper do E3.A
// nasceu em `data/pagamentos.ts` e morreu na primeira execução do spec,
// porque aquele arquivo importa o cliente Supabase, que lê
// `import.meta.env`.
// =====================================================================

/**
 * Quantas formas o cadastro aceita prever.
 *
 * TRÊS, e o número vem do CLAUDE.md — *"o cliente pode pagar em até 3
 * formas na porta"*.
 *
 * **O dialog de divergência aceita QUATRO, e a diferença é deliberada.**
 * Não são o mesmo tipo de afirmação: aqui se PREVÊ o que vai acontecer,
 * lá se REGISTRA o que aconteceu. Ser mais permissivo no registro é o
 * lado seguro de errar — recusar um fato consumado empurraria a
 * correção pra fora do sistema, que é o que a regra 7 existe pra
 * impedir. Recusar uma previsão só custa um clique.
 */
export const MAX_FORMAS_PREVISTAS = 3

/**
 * Valida as formas previstas de um cadastro de entrega.
 *
 * Devolve a mensagem de erro, ou `null` quando está tudo certo — mesma
 * convenção do resto do projeto (`romaneio_retorno_validar` no SQL faz
 * igual).
 *
 * **FORMA REPETIDA É RECUSADA**, e não é preciosismo:
 *
 *   - `entregas.convenio_id` é UMA coluna. Duas linhas de convênio
 *     seriam dois acordos diferentes disputando o mesmo campo, e o
 *     sistema não teria como dizer qual deles vale;
 *   - "dinheiro + dinheiro" não é pagamento em duas formas, é um
 *     pagamento só — e viraria duas linhas `p` no DCR1 dizendo a mesma
 *     coisa com ids diferentes, dentro de um documento assinado;
 *   - o caso real que isso pega é banal: o caixa clica "+ outra forma",
 *     não troca o select, e o padrão fica valendo duas vezes.
 *
 * A SOMA TEM QUE BATER com o valor da compra — mesma regra que o dialog
 * de divergência já aplica, e a que o caixa já conhece.
 */
export function validarFormasPrevistas(
  formas: FormaComValor[],
  valorCompraCents: number
): string | null {
  if (formas.length === 0) return 'Informe ao menos uma forma de pagamento.'
  if (formas.length > MAX_FORMAS_PREVISTAS) {
    return `No máximo ${MAX_FORMAS_PREVISTAS} formas de pagamento.`
  }
  if (formas.some((f) => f.valor_cents <= 0)) {
    return 'Toda forma precisa de um valor maior que zero.'
  }

  const vistas = new Set<FormaPagamento>()
  for (const f of formas) {
    if (vistas.has(f.forma)) {
      return `${FORMA_PAGAMENTO_LABEL[f.forma] ?? f.forma} aparece duas vezes — use uma linha por forma.`
    }
    vistas.add(f.forma)
  }

  const soma = formas.reduce((acc, f) => acc + f.valor_cents, 0)
  if (soma !== valorCompraCents) {
    return `A soma (${formatBRL(soma)}) não bate com o valor da compra (${formatBRL(valorCompraCents)}).`
  }

  return null
}

/**
 * O previsto e o realizado divergem?
 *
 * **ESTE É UM GÊMEO**, e o outro lado está em
 * `selar_romaneio_retorno_interno`:
 *
 * ```sql
 * select coalesce(array_agg(pg.forma || '|' || pg.valor_cents
 *                           order by pg.forma || '|' || pg.valor_cents), '{}')
 *   into v_previsto ...
 * v_divergiu := v_previsto is distinct from v_realizado;
 * ```
 *
 * Ele nasceu porque os dois lados DISCORDAVAM. O cliente decidia por
 * contagem — `linhas.length > 1 || linhas[0].forma !== formaEsperada` —
 * o que só estava certo enquanto existisse um previsto só. Com dois, um
 * vale previsto `pix + dinheiro` e pago exatamente `pix + dinheiro`
 * seria fiel para o servidor e divergente para a tela: os dois
 * escritores do mesmo fato afirmando coisas diferentes.
 *
 * **A ordenação não precisa casar com a do Postgres, e isso merece ser
 * dito** porque parece que precisa. Cada lado ordena os DOIS conjuntos
 * dele com o MESMO comparador e compara um com o outro — nunca o array
 * ordenado de um lado com o do outro. Igualdade de multiconjunto é
 * independente da ordem total escolhida, então collation nenhuma muda o
 * resultado. O que precisa casar é a CHAVE (`forma|valor_cents`) e o
 * fato de duplicata contar (multiconjunto, não conjunto).
 */
export function divergiuDoPrevisto(
  previstos: FormaComValor[],
  realizados: FormaComValor[]
): boolean {
  const chaves = (lista: FormaComValor[]) =>
    lista.map((f) => `${f.forma}|${f.valor_cents}`).sort()

  const a = chaves(previstos)
  const b = chaves(realizados)
  return a.length !== b.length || a.some((chave, i) => chave !== b[i])
}

// =====================================================================
// A REFERÊNCIA INFORMADA — E4.1
//
// `de` significa UMA coisa só, e é o servidor quem fixa esse significado:
//
//     'de', (select jsonb_agg(...) from public.pagamentos pg
//             where pg.entrega_id = ... and pg.momento = 'previsto')
//
// **Estado persistido anterior.** Nada mais.
//
// Até o E4.1, quando o caixa marcava ocorrência num vale sem previsto, o
// cliente CRIAVA um previsto retroativo e mandava aquela forma como
// `de` — o que fechava o círculo por construção, mas ao custo de
// fabricar história: uma suposição feita 28 minutos depois virava um
// pagamento previsto histórico.
//
// O fallback parou de escrever em `pagamentos` (ver `marcarDivergencia`).
// Com isso, a forma que o operador informa deixa de ter onde caber em
// `de` — e NÃO PODE caber, porque ali ela se passaria por estado
// persistido. Ela ganhou campo próprio:
//
//     de                     [] / null   — não havia previsto, e é isso
//     referencia_informada   [{...}]     — o que o operador DECLAROU
//     origem_referencia      'informada_pelo_operador'
//
// São fatos de naturezas diferentes, e a distinção sobrevive no dado:
//
//     previsto      conhecido no cadastro do vale, pelo sistema
//     referência    declarada depois, por uma pessoa, com autor e hora
//
// **Ausência de histórico não se corrige inventando histórico.**
// =====================================================================

/** O carimbo de origem, escrito por extenso no payload append-only. */
export const ORIGEM_INFORMADA = 'informada_pelo_operador'

/**
 * A referência que o operador informou, ou `null`.
 *
 * Tolera o payload legado — eventos anteriores ao E4.1 não têm o campo, e
 * `eventos` é append-only (regra 6), então essa ausência é permanente.
 * Nesses, o palpite do operador está em `de` mesmo, indistinguível do
 * estado persistido: é uma ambiguidade histórica que não dá pra desfazer
 * e que este campo existe pra não criar de novo.
 */
export function referenciaInformadaDoEvento(
  payload: Record<string, unknown> | null | undefined
): FormaComValor[] | null {
  const bruto = payload?.['referencia_informada']
  if (!Array.isArray(bruto) || bruto.length === 0) return null
  return bruto as FormaComValor[]
}

/**
 * O texto da referência informada, já rotulado — ou `null`.
 *
 * O rótulo é parte do valor: sem ele a tela mostraria "Pix" do lado de
 * "Era", e o leitor concluiria que o sistema sabia. Ele não sabia.
 */
export function textoDaReferenciaInformada(
  payload: Record<string, unknown> | null | undefined
): string | null {
  const formas = referenciaInformadaDoEvento(payload)
  if (!formas) return null
  return `informado pelo operador: ${textoDoPagamentoAlterado(formas)}`
}
