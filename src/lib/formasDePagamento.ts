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

/**
 * AS FORMAS ACEITAS EM OPERAÇÃO NOVA — e elas não são o domínio inteiro.
 *
 * `outro` saiu em 2026-09-10 (decisão de 2026-09-08). Ele CONTINUA em
 * `FormaPagamento` e em `FORMA_PAGAMENTO_LABEL`, de propósito: os dois
 * são o vocabulário de LEITURA, e um pagamento antigo gravado como
 * `outro` tem que continuar aparecendo como "Outro". Duas telas indexam
 * o rótulo sem fallback (`EntregasTable`, `Fechamento`), e tirar a chave
 * faria o histórico renderizar `undefined`.
 *
 * Escolher e ler são perguntas diferentes: o que se OFERECE sai daqui, o
 * que se EXIBE sai do rótulo.
 *
 * `outro` como MOTIVO DE INSUCESSO é outro campo com o mesmo nome, e não
 * foi tocado — ver `MOTIVOS_INSUCESSO` em `canonicoRetorno.ts`.
 */
export const FORMAS_ACEITAS: readonly FormaPagamento[] = [
  'dinheiro',
  'credito',
  'debito',
  'pix',
  'convenio',
  'convcard',
  'crediario',
]

export function formaAceita(forma: string): boolean {
  return (FORMAS_ACEITAS as readonly string[]).includes(forma)
}

export const FORMA_PAGAMENTO_OPTIONS = FORMAS_ACEITAS.map(
  (forma) => [forma, FORMA_PAGAMENTO_LABEL[forma]] as [FormaPagamento, string]
)

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
 *   - (histórico) `entregas.convenio_id` é UMA coluna, e duas linhas de
 *     convênio seriam dois acordos disputando o mesmo campo. Esta razão
 *     caducou no passo 1 — o convênio deixou de ser identificado e a
 *     coluna nasce nula —, mas a REGRA continua, sustentada pelas duas
 *     abaixo, que nunca dependeram dela;
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

  // A SEGUNDA TRAVA DO CLIENTE. A tela já não oferece `outro`; isto pega
  // um valor que chegue por outro caminho. Quem recusa de verdade é o
  // CHECK de `pagamentos.forma`.
  const foraDeUso = formas.find((f) => !formaAceita(f.forma))
  if (foraDeUso) {
    return `${FORMA_PAGAMENTO_LABEL[foraDeUso.forma] ?? foraDeUso.forma} não é mais forma de pagamento — escolha a forma usada.`
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
  // O TROCO NÃO ENTRA NA CHAVE — ver "O contrato dos valores" abaixo.
  // `valor_cents` já é o líquido aplicado à compra; somar ou subtrair troco
  // aqui misturaria bruto com líquido, e o gêmeo SQL também não o faz.
  const chaves = (lista: FormaComValor[]) =>
    lista.map((f) => `${f.forma}|${f.valor_cents}`).sort()

  const a = chaves(previstos)
  const b = chaves(realizados)
  return a.length !== b.length || a.some((chave, i) => chave !== b[i])
}

// =====================================================================
// O CONTRATO DOS VALORES — valor aplicado, troco e recebido (2026-09-12)
//
// Escrito porque o sistema já o pressupunha sem dizer: o cadastro exige
// que a soma dos previstos bata com a compra, e o selo do retorno compara
// `forma|valor_cents`. As duas regras só fazem sentido se `valor_cents` for
// o LÍQUIDO. O retorno, porém, pedia "Valor" e "Troco" sem dizer isso, e o
// V-000063 entrou com o dinheiro RECEBIDO no campo do valor.
//
//     pagamentos.valor_cents   parte da COMPRA paga por aquela forma
//     pagamentos.troco_cents   dinheiro devolvido ao cliente naquela linha
//                              (só em dinheiro; 0 nas outras formas)
//     recebido / "troco para"  valor_cents + troco_cents — DERIVADO, nunca
//                              gravado em coluna própria
//
// PREVISTO (cadastro)
//
//     compra 100, dinheiro, "troco para" vazio   valor 10000  troco     0
//     compra 100, dinheiro, "troco para" 200     valor 10000  troco 10000
//     compra 100, pix 40 + dinheiro 60           pix 4000/0 · dinheiro 6000/0
//     o mesmo, "troco para" 100                  pix 4000/0 · dinheiro 6000/4000
//                                                (o "troco para" considera SÓ a
//                                                parcela em dinheiro — decidido
//                                                pelo usuário em 2026-09-13)
//
// REALIZADO (retorno)
//
//     pagou o valor exato                        valor 10000  troco     0
//     entregou 200, levou 100 de troco           valor 10000  troco 10000
//     entregou só 90                             valor  9000  troco     0
//     misto: pix 40, entregou 100 em espécie     pix 4000/0 · dinheiro 6000/4000
//
// COMPARAÇÃO: multiconjunto de `forma|valor_cents`. Troco certo, ou outra
// nota com a mesma forma e o mesmo líquido, NÃO é divergência; 90 contra
// 100, ou dinheiro virando pix, é.
//
// O HISTÓRICO não é reinterpretado para caber: o V-000063 (200 no valor, 100
// no troco) afirma 200 aplicados sob este contrato, e é exatamente a
// divergência que o servidor gravou na época. Ninguém o corrige por UPDATE.
// =====================================================================

/** Um pagamento lido do banco, com o troco junto — só pra exibir. */
export type PagamentoLido = FormaComValor & { troco_cents: number }

/**
 * O que a tela pode AFIRMAR sobre o pagamento de um vale.
 *
 *   sem_realizado   ninguém conferiu ainda (vale sem retorno, por exemplo)
 *   confere         conferido, e bate com o previsto
 *   divergiu        conferido, e não bate
 *
 * **Existência de realizado NÃO é divergência.** Era o critério da lista e
 * do fechamento até 2026-09-12, de antes do Romaneio de Retorno — quando só
 * a "Notificar ocorrência" gravava realizado. O selo do retorno grava o
 * realizado de todo vale entregue, e todo retorno virou "(divergiu)".
 *
 * **Lista vazia não é comparada**: previsto contra nada divergiria sempre,
 * e um vale que ainda não voltou apareceria como problema.
 *
 * É apresentação, e só: não escreve `status_financeiro`. A pendência de
 * gestão continua sendo o status, que o servidor marca e a conferência nunca
 * sobrescreve — recalcular esta situação não reabre nem fecha nada.
 *
 * Com realizados de mais de uma origem (retorno e, depois, uma ocorrência),
 * o multiconjunto inteiro é comparado: a ocorrência só é gravada quando
 * diverge, então as linhas dela sempre tornam o conjunto diferente do
 * previsto.
 */
export type SituacaoDoPagamento = 'sem_realizado' | 'confere' | 'divergiu'

export function situacaoDoPagamento(
  previstos: FormaComValor[],
  realizados: FormaComValor[]
): SituacaoDoPagamento {
  if (realizados.length === 0) return 'sem_realizado'
  return divergiuDoPrevisto(previstos, realizados) ? 'divergiu' : 'confere'
}

/**
 * A linha da PARCELA EM DINHEIRO — o índice dela, ou `null`.
 *
 * Decidido pelo usuário em 2026-09-13: no pagamento misto o "troco para"
 * considera SÓ a parcela em dinheiro. Compra 100, pix 40, dinheiro 60, troco
 * para 100 → troco 40. Com uma forma só, a parcela é a compra inteira.
 *
 * `null` sem dinheiro, ou com dinheiro repetido — que a validação recusa, e
 * onde não existe "a" parcela sobre a qual calcular.
 */
export function indiceDaParcelaEmDinheiro(formas: ReadonlyArray<{ forma: string }>): number | null {
  const indices = formas.flatMap((f, i) => (f.forma === 'dinheiro' ? [i] : []))
  return indices.length === 1 ? indices[0] : null
}

/** "Troco para" aparece no cadastro? Quando há UMA parcela em dinheiro. */
export function trocoParaAplicavel(formas: ReadonlyArray<{ forma: string }>): boolean {
  return indiceDaParcelaEmDinheiro(formas) !== null
}

export type ResultadoDoTroco = { ok: true; trocoCents: number } | { ok: false; erro: string }

/**
 * O troco a levar, a partir do "Troco para" digitado no cadastro.
 *
 * `valorEmDinheiroCents` é a PARCELA em dinheiro — a compra inteira com uma
 * forma só, a linha de dinheiro no misto (`indiceDaParcelaEmDinheiro`).
 *
 * Vazio é resposta legítima — não há troco a preparar. Preenchido, tem que
 * ser ESTRITAMENTE maior que a parcela em dinheiro: igual seria "troco zero",
 * que é o campo vazio dito de um jeito que confunde.
 *
 * O "troco para" NÃO é gravado: vira `troco_cents` do previsto, e o valor da
 * compra continua sendo o `valor_cents`. Não aumenta venda nem cobrança.
 */
export function trocoDoPrevisto(
  valorEmDinheiroCents: number,
  trocoParaDigitos: string
): ResultadoDoTroco {
  if (trocoParaDigitos === '') return { ok: true, trocoCents: 0 }
  const trocoParaCents = centsFromDigits(trocoParaDigitos)
  if (trocoParaCents <= 0) {
    return {
      ok: false,
      erro: '“Troco para” precisa de um valor — ou deixe o campo vazio se não houver troco.',
    }
  }
  if (valorEmDinheiroCents <= 0) {
    return { ok: false, erro: 'Informe o valor em dinheiro antes do “Troco para”.' }
  }
  if (trocoParaCents <= valorEmDinheiroCents) {
    return {
      ok: false,
      erro: `“Troco para” precisa ser maior que a parcela em dinheiro (${formatBRL(valorEmDinheiroCents)}). Se o cliente vai pagar o valor exato, deixe o campo vazio.`,
    }
  }
  return { ok: true, trocoCents: trocoParaCents - valorEmDinheiroCents }
}

/**
 * O troco devolvido no retorno, a partir do dinheiro RECEBIDO.
 *
 * Vazio significa valor exato. Recebido MENOR que o aplicado é recusado, e a
 * mensagem diz o que fazer: se entrou menos dinheiro, o aplicado é o que
 * entrou — e aí o selo registra a divergência. O cálculo não pode esconder
 * falta de dinheiro atrás de um troco negativo.
 */
export function trocoDoRecebido(aplicadoCents: number, recebidoDigitos: string): ResultadoDoTroco {
  if (recebidoDigitos === '') return { ok: true, trocoCents: 0 }
  const recebidoCents = centsFromDigits(recebidoDigitos)
  if (recebidoCents <= 0) {
    return {
      ok: false,
      erro: 'Informe o dinheiro recebido — ou deixe o campo vazio se o cliente pagou o valor exato.',
    }
  }
  if (recebidoCents < aplicadoCents) {
    return {
      ok: false,
      erro: `O recebido (${formatBRL(recebidoCents)}) é menor que o aplicado à compra (${formatBRL(aplicadoCents)}). Se o cliente pagou só ${formatBRL(recebidoCents)}, informe esse valor como aplicado — fica registrado como divergência.`,
    }
  }
  return { ok: true, trocoCents: recebidoCents - aplicadoCents }
}

/** Uma linha de pagamento realizado como o retorno a guarda em dígitos. */
export type LinhaRealizadaDigitada = {
  forma: string
  /** Parte da compra paga por esta forma — vira `valor_cents`. */
  aplicadoDigitos: string
  /**
   * Só dinheiro: o que o cliente entregou em espécie PARA ESTA PARCELA. No
   * misto, é o dinheiro da parcela, não a compra. Vazio = valor exato.
   */
  recebidoDigitos: string
}

export type ResultadoDaLinha =
  | { ok: true; valorCents: number; trocoCents: number }
  | { ok: false; erro: string }

/**
 * A CONVERSÃO ÚNICA da tela do retorno para `valor_cents` e `troco_cents`.
 *
 * A validação e o payload chamam a mesma função, então a tela não consegue
 * aceitar uma coisa e gravar outra.
 *
 *   - forma que não é dinheiro: troco sempre 0, mesmo que sobre dígito no
 *     estado — nada de valor escondido indo pro documento;
 *   - dinheiro: troco = recebido − aplicado, com uma forma ou no misto. No
 *     misto o aplicado é a PARCELA em dinheiro (decisão de 2026-09-13), então
 *     pix 40 + dinheiro 60 recebendo 100 em espécie dá 60 líquidos e 40 de
 *     troco — e a comparação reconhece `dinheiro|6000` + `pix|4000`.
 *
 * Não há mais troco digitado à mão: era o tratamento provisório do misto.
 */
export function realizadoDaLinha(linha: LinhaRealizadaDigitada): ResultadoDaLinha {
  const valorCents = linha.aplicadoDigitos === '' ? 0 : centsFromDigits(linha.aplicadoDigitos)
  if (valorCents <= 0) return { ok: false, erro: 'falta o valor aplicado à compra.' }
  if (linha.forma !== 'dinheiro') return { ok: true, valorCents, trocoCents: 0 }
  const troco = trocoDoRecebido(valorCents, linha.recebidoDigitos)
  return troco.ok ? { ok: true, valorCents, trocoCents: troco.trocoCents } : troco
}

/**
 * O CLIENTE ENTREGOU MENOS DINHEIRO QUE O APLICADO? Devolve quanto entrou e
 * quanto faltou — ou `null`.
 *
 * Existe por um defeito relatado e reproduzido em 2026-09-13: registrar falta
 * em dinheiro exigia mexer em DOIS campos (o recebido e o aplicado, que vem
 * pré-preenchido com o previsto), e a tela só recusava. Com pix bastava um.
 *
 * Esta função NÃO muda nada: ela só diz o que a tela pode OFERECER. Quem
 * aceita é o caixa, com um clique, e aí a linha vira `aplicado = recebido` —
 * que diverge do previsto e fica registrada no selo. A falta nunca some.
 *
 * `null` quando não é dinheiro, quando o recebido está vazio (valor exato) ou
 * quando ele cobre o aplicado (há troco, ou é exato).
 */
export function faltaEmDinheiro(
  linha: LinhaRealizadaDigitada
): { recebidoCents: number; faltaCents: number } | null {
  if (linha.forma !== 'dinheiro' || linha.recebidoDigitos === '') return null
  const aplicadoCents = linha.aplicadoDigitos === '' ? 0 : centsFromDigits(linha.aplicadoDigitos)
  const recebidoCents = centsFromDigits(linha.recebidoDigitos)
  if (recebidoCents <= 0 || recebidoCents >= aplicadoCents) return null
  return { recebidoCents, faltaCents: aplicadoCents - recebidoCents }
}

/**
 * O recebido sugerido no retorno, a partir do previsto: o "troco para" do
 * cadastro. Sem troco previsto, o campo nasce vazio — valor exato.
 */
export function digitosDoRecebidoPrevisto(valorCents: number, trocoCents: number): string {
  return trocoCents > 0 ? String(valorCents + trocoCents) : ''
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

// =====================================================================
// DE ONDE VEIO O `pagamento_alterado` — 2026-09-13
//
// O evento tem dois escritores, e eles afirmam coisas de natureza
// diferente:
//
//     o selo do retorno     CALCULA: comparou o previsto com o que o
//                           balcão confirmou ao selar
//     "Notificar ocorrência" INFORMA: uma pessoa declarou o que descobriu
//                           depois, com a justificativa dela
//
// A tela precisa distinguir os dois, e **só o dado estruturado decide**.
// O texto da justificativa é livre — e o do selo, que dizia que ninguém o
// digitou, era a única pista que a tela tinha até aqui.
//
// O selo grava os DOIS marcadores desde a primeira versão
// (`20260820130000`): `origem: 'romaneio_retorno'` e
// `romaneio_retorno_id`. Desde a migration `20260913120000` o cliente não
// consegue gravar nenhum dos dois. Exigir os dois JUNTOS é o que impede um
// só, alegado, de bastar.
//
// Isto LÊ o que está gravado. Não reescreve o histórico nem certifica o
// passado; e "informada" não quer dizer "comprovada" — é uma declaração,
// com autor.
// =====================================================================

export type OrigemDoPagamentoAlterado = 'calculada_no_retorno' | 'informada'

export function origemDoPagamentoAlterado(
  payload: Record<string, unknown> | null | undefined
): OrigemDoPagamentoAlterado {
  const retornoId = payload?.['romaneio_retorno_id']
  return payload?.['origem'] === 'romaneio_retorno' &&
    typeof retornoId === 'string' &&
    retornoId.length > 0
    ? 'calculada_no_retorno'
    : 'informada'
}
