// Forma canônica do Romaneio de Retorno — os bytes que viram o
// `document_hash` do DCRR1.
//
// ATENÇÃO: este arquivo é a implementação GÊMEA de
// `public.romaneio_retorno_canonico` (etapa 2A item 5, ainda não
// escrita). As duas precisam produzir os MESMOS BYTES, sempre. Se
// divergirem, o sintoma não é erro claro — é "o retorno offline nunca
// sincroniza", meses depois.
//
// O CONTRATO MANDA, ESTA FUNÇÃO OBEDECE. Os oito vetores válidos e os
// doze inválidos de `scripts/dcrr1-vetores.mts` foram escritos à mão a
// partir da especificação ANTES desta implementação existir. Se ela
// discordar de um vetor, **o vetor ganha** até se demonstrar erro na
// especificação.
//
// Mora em `lib/` e não importa nada — nem o cliente Supabase, nem React,
// nem Dexie. É isso que permite testá-la isolada, que é a única defesa
// real contra a divergência.
//
// ---------------------------------------------------------------------
// TRÊS RESPONSABILIDADES, DE PROPÓSITO SEPARADAS
// ---------------------------------------------------------------------
//
//     validar    →  a entrada pode virar documento?
//     normalizar →  qual é a forma única desta entrada?
//     serializar →  quais bytes essa forma produz?
//
// Não é gosto por camadas: os vetores provam que são conceitos
// diferentes, e que a resposta certa muda entre eles.
//
//   V004  `entregue` com motivo sujo   → NORMALIZA (força '-')
//   I005  `insucesso` sem motivo       → RECUSA
//   I009  pagamento em vale de insucesso → RECUSA, não descarta
//
// A regra que os separa: **normaliza-se quando o valor correto é
// dedutível sem ambiguidade; recusa-se quando seria preciso inventar
// fato.** `entregue` não tem motivo por definição, então `-` é dedução.
// Um insucesso sem motivo não tem valor que se possa deduzir. E
// descartar um pagamento em silêncio seria sumir com dinheiro que
// alguém digitou.
//
// ---------------------------------------------------------------------
// O FORMATO
// ---------------------------------------------------------------------
//
//     DCRR1
//     saida        <uuid>
//     saida_hash   <document_hash da saída>
//     motoboy      <uuid>
//     responsavel  <uuid>
//     v   <entrega_id>  <desfecho>  <motivo>  <detalhe>
//     pr  <entrega_id>  <pagamento_id>  <forma>  <valor_cents>  <troco_cents>
//
// O retorno assina só o que ele ACRESCENTA: tenant, loja, corrida,
// número do vale, cliente e valores ficam de fora porque a saída já os
// selou, e `saida` + `saida_hash` a identificam inequivocamente.
// Repetir criaria uma segunda fonte que pode discordar da primeira.
//
// NENHUM RELÓGIO ENTRA AQUI. O canônico é o que o navegador assina, e
// offline não há servidor a consultar — se o cliente não sabe antes de
// selar, não pertence ao documento.

const TAB = '\t'

// Espelha `texto_para_canonico`: translate(texto, E'\t\n\r', '   ') com
// coalesce pra '-'. Nada de trim, nada de normalizar Unicode —
// normalização é justamente a "melhoria" que faria os dois lados
// divergirem em silêncio.
//
// CUIDADO COM `valor || '-'`: isso engole a string vazia junto com o
// nulo. Aqui `''` continua `''` e só NULO vira `-` (vetor V007).
//
// A regra NÃO É INJETIVA: "a\tb" e "a b" produzem o mesmo canônico.
// Então o hash cobre a forma sanitizada, não a original — que é o que o
// snapshot guarda. Escape reversível seria injetivo e foi recusado: uma
// segunda convenção de escaping num projeto cujo risco nº 1 é
// divergência de gêmeos.
function textoCanonico(valor: string | null | undefined): string {
  if (valor === null || valor === undefined) return '-'
  return valor.replace(/[\t\n\r]/g, ' ')
}

// `uuid::text` do Postgres sai sempre em minúscula.
function idCanonico(valor: string | null | undefined): string {
  return valor ? valor.toLowerCase() : '-'
}

// Ordenação por code unit, igual ao `collate "C"` do lado SQL.
// NUNCA trocar por localeCompare: ele depende do locale do navegador,
// que é exatamente a variável que o collate "C" foi posto lá pra
// eliminar. Só UUID em hex é ordenado — acima do BMP a ordem UTF-16 e a
// UTF-8 divergem, e o DCRR1 não precisa saber ordenar linguagem humana.
function ordemBinaria(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export const FORMAS_PAGAMENTO = [
  'dinheiro',
  'credito',
  'debito',
  'pix',
  'convenio',
  'vale',
  'outro',
] as const
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number]

export const MOTIVOS_INSUCESSO = ['ausente', 'endereco_errado', 'recusou', 'outro'] as const
export type MotivoInsucesso = (typeof MOTIVOS_INSUCESSO)[number]

export type PagamentoRealizadoCanonico = {
  pagamentoId: string
  forma: FormaPagamento
  valorCents: number
  trocoCents: number
}

// O pagamento é ANINHADO no vale, e isso não é organização: é o que
// torna INDESCRITÍVEL um pagamento apontando pra um vale que não está no
// documento. O `entrega_id` da linha `pr` vem do pai, então não há como
// os dois discordarem. Tornar um erro impossível de representar vale
// mais que rejeitá-lo — e é por isso que o lado SQL tem que ESPELHAR o
// aninhamento em vez de achatar `pagamentos` num select só.
export type ValeRetornoCanonico = {
  entregaId: string
  desfecho: 'entregue' | 'insucesso'
  motivo: MotivoInsucesso | null
  detalhe: string | null
  pagamentosRealizados: PagamentoRealizadoCanonico[]
}

export type EntradaRetorno = {
  saidaRomaneioId: string
  saidaDocumentHash: string
  motoboyId: string
  responsavelId: string
  vales: ValeRetornoCanonico[]
}

// ---------------------------------------------------------------------
// 1. VALIDAR
// ---------------------------------------------------------------------

export type MotivoRejeicao =
  | 'sem_vales'
  | 'saida_hash_invalido'
  | 'desfecho_invalido'
  | 'motivo_invalido'
  | 'insucesso_sem_motivo'
  | 'motivo_sem_detalhe'
  | 'entrega_duplicada'
  | 'pagamento_duplicado'
  | 'pagamento_em_insucesso'
  | 'forma_invalida'
  | 'valor_negativo'
  | 'valor_nao_inteiro'

export class RetornoInvalido extends Error {
  // Campo declarado à parte em vez de parameter property: o projeto roda
  // com `erasableSyntaxOnly`, que proíbe `constructor(readonly x)` porque
  // aquilo emite código em vez de só apagar tipo.
  readonly motivo: MotivoRejeicao

  constructor(motivo: MotivoRejeicao) {
    super(`Retorno inválido: ${motivo}`)
    this.name = 'RetornoInvalido'
    this.motivo = motivo
  }
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * Devolve o motivo da recusa, ou `null` se a entrada pode virar
 * documento.
 *
 * **A ORDEM DAS CHECAGENS FAZ PARTE DO CONTRATO.** Uma entrada pode
 * violar várias regras ao mesmo tempo, e os dois gêmeos precisam
 * reportar o MESMO motivo — senão a tela diz uma coisa e o servidor
 * outra para a mesma entrada. A ordem é: estrutura do documento, depois
 * vale a vale na ordem em que vieram, depois pagamento a pagamento.
 *
 * Não valida formato de UUID: os ids vêm do banco ou do gerador uuidv7,
 * e um id inexistente morre na FK dentro da transação do selo. Somar um
 * motivo aqui alargaria um contrato que já está congelado.
 */
export function validarRetorno(entrada: EntradaRetorno): MotivoRejeicao | null {
  if (entrada.vales.length === 0) return 'sem_vales'
  if (!HEX64.test(entrada.saidaDocumentHash)) return 'saida_hash_invalido'

  const entregas = new Set<string>()
  const pagamentos = new Set<string>()

  for (const vale of entrada.vales) {
    if (vale.desfecho !== 'entregue' && vale.desfecho !== 'insucesso') {
      return 'desfecho_invalido'
    }
    if (entregas.has(vale.entregaId)) return 'entrega_duplicada'
    entregas.add(vale.entregaId)

    if (vale.desfecho === 'insucesso') {
      if (vale.motivo === null || vale.motivo === undefined) return 'insucesso_sem_motivo'
      if (!(MOTIVOS_INSUCESSO as readonly string[]).includes(vale.motivo)) {
        return 'motivo_invalido'
      }
      // Só espaços conta como vazio: senão a regra se contorna com a
      // barra de espaço, e o documento volta a assinar "outro" sozinho.
      if (vale.motivo === 'outro' && (vale.detalhe ?? '').trim() === '') {
        return 'motivo_sem_detalhe'
      }
      // Descartar em silêncio seria sumir com dinheiro que alguém
      // digitou. Recusa, pra a tela poder perguntar.
      if (vale.pagamentosRealizados.length > 0) return 'pagamento_em_insucesso'
    } else if (
      vale.motivo !== null &&
      vale.motivo !== undefined &&
      !(MOTIVOS_INSUCESSO as readonly string[]).includes(vale.motivo)
    ) {
      // Vale entregue com motivo LIXO ainda é recusado. Normalizar só
      // alcança valor do domínio: forçar '-' num valor desconhecido
      // esconderia que alguém mandou algo que ninguém entende.
      return 'motivo_invalido'
    }

    for (const pagamento of vale.pagamentosRealizados) {
      if (pagamentos.has(pagamento.pagamentoId)) return 'pagamento_duplicado'
      pagamentos.add(pagamento.pagamentoId)

      if (!(FORMAS_PAGAMENTO as readonly string[]).includes(pagamento.forma)) {
        return 'forma_invalida'
      }
      // REGRA 1: dinheiro é inteiro em centavos. `String(12.5)` produz
      // "12.5", e o lado SQL com `integer` jamais produziria isso —
      // divergência de gêmeos nascida de dinheiro em float.
      if (
        !Number.isInteger(pagamento.valorCents) ||
        !Number.isInteger(pagamento.trocoCents)
      ) {
        return 'valor_nao_inteiro'
      }
      if (pagamento.valorCents < 0 || pagamento.trocoCents < 0) return 'valor_negativo'
    }
  }

  return null
}

// ---------------------------------------------------------------------
// 2. NORMALIZAR
// ---------------------------------------------------------------------

type ValeNormalizado = {
  entregaId: string
  desfecho: string
  motivo: string
  detalhe: string
  pagamentos: { entregaId: string; pagamentoId: string; forma: string; valor: string; troco: string }[]
}

export type RetornoNormalizado = {
  saida: string
  saidaHash: string
  motoboy: string
  responsavel: string
  vales: ValeNormalizado[]
}

/**
 * A forma única de uma entrada: valores resolvidos e ordem fixada.
 *
 * Normalizar ANTES de serializar é o que faz "mesma entrada em qualquer
 * ordem" produzir os mesmos bytes — e é aqui que mora a regra do V004.
 *
 * **Presume entrada já validada.** Chamar com entrada inválida é erro de
 * programação, não caso de uso: use `montarCanonicoRetorno`.
 */
export function normalizarRetorno(entrada: EntradaRetorno): RetornoNormalizado {
  const vales = entrada.vales
    .map((vale): ValeNormalizado => {
      // V004: `entregue` não tem motivo nem detalhe POR DEFINIÇÃO, então
      // '-' é dedução, não invenção. Vale mesmo que a entrada traga
      // outra coisa — a fila offline pode carregar payload antigo, e o
      // canônico não pode depender de quem chamou ter se comportado.
      const entregue = vale.desfecho === 'entregue'
      return {
        entregaId: idCanonico(vale.entregaId),
        desfecho: vale.desfecho,
        motivo: entregue ? '-' : textoCanonico(vale.motivo),
        detalhe: entregue ? '-' : textoCanonico(vale.detalhe),
        pagamentos: vale.pagamentosRealizados
          .map((pagamento) => ({
            entregaId: idCanonico(vale.entregaId),
            pagamentoId: idCanonico(pagamento.pagamentoId),
            forma: pagamento.forma,
            valor: String(pagamento.valorCents),
            troco: String(pagamento.trocoCents),
          }))
          .sort((a, b) => ordemBinaria(a.pagamentoId, b.pagamentoId)),
      }
    })
    .sort((a, b) => ordemBinaria(a.entregaId, b.entregaId))

  return {
    saida: idCanonico(entrada.saidaRomaneioId),
    saidaHash: entrada.saidaDocumentHash,
    motoboy: idCanonico(entrada.motoboyId),
    responsavel: idCanonico(entrada.responsavelId),
    vales,
  }
}

// ---------------------------------------------------------------------
// 3. SERIALIZAR
// ---------------------------------------------------------------------

/**
 * Os bytes. Pura renderização: nenhuma decisão acontece aqui, o que faz
 * dela a parte mais fácil de conferir contra o lado SQL.
 */
export function serializarRetorno(n: RetornoNormalizado): string {
  const linhas: string[] = [
    'DCRR1',
    `saida${TAB}${n.saida}`,
    `saida_hash${TAB}${n.saidaHash}`,
    `motoboy${TAB}${n.motoboy}`,
    `responsavel${TAB}${n.responsavel}`,
  ]

  for (const vale of n.vales) {
    linhas.push([`v`, vale.entregaId, vale.desfecho, vale.motivo, vale.detalhe].join(TAB))
  }

  // TODOS os pagamentos DEPOIS de todos os vales, em bloco próprio — o
  // lado SQL faz dois laços separados, então intercalar aqui já mudaria
  // os bytes. Os vales já vêm ordenados e os pagamentos de cada um
  // também, então achatar preserva a ordem (entrega_id, pagamento_id).
  for (const vale of n.vales) {
    for (const p of vale.pagamentos) {
      linhas.push(['pr', p.entregaId, p.pagamentoId, p.forma, p.valor, p.troco].join(TAB))
    }
  }

  // Sem \n no fim — o array_to_string do lado SQL também não põe.
  return linhas.join('\n')
}

// ---------------------------------------------------------------------

/**
 * O caminho normal: valida, normaliza, serializa.
 *
 * Levanta `RetornoInvalido` com o motivo — que é parte do contrato, não
 * texto de erro: o lado SQL precisa recusar a mesma entrada pelo mesmo
 * motivo, senão a tela mostra uma coisa e o servidor outra.
 */
export function montarCanonicoRetorno(entrada: EntradaRetorno): string {
  const motivo = validarRetorno(entrada)
  if (motivo) throw new RetornoInvalido(motivo)
  return serializarRetorno(normalizarRetorno(entrada))
}
