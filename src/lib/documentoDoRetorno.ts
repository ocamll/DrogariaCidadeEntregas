// O Romaneio de Retorno, lido para a PÁGINA e para o PDF.
//
// Mora em `lib/` e só importa `formasDePagamento.ts` e `money.ts`, que não
// importam nada. É a disciplina de `papeis.ts`: página e PDF precisam contar
// a mesma história do mesmo documento, e o spec roda em `tsx`, fora do Vite.
//
// ---------------------------------------------------------------------
// DE ONDE VEM CADA FATO — e nada vem de `entregas`
//
//   payload (`romaneio_retorno_payload`, congelado no selo)
//       número, tipo e nome do vale; desfecho, motivo e detalhe já
//       normalizados como no canônico; pagamentos previstos e realizados
//
//   canônico DCRR1 (os bytes que as duas partes confirmaram)
//       os DOCUMENTOS: linhas `d <entrega_id> <tipo> <situacao>`
//
// Os documentos saem do canônico porque o payload não os guarda. Isso não é
// uma segunda fonte: o canônico É o documento. Ler o estado atual do vale
// (`status_documental`) mostraria um papel que voltou DEPOIS como se tivesse
// voltado no retorno — a regra 7 dizendo que não.
//
// ---------------------------------------------------------------------
// O RETORNO EM CONFLITO
//
// `registrar_conflito_retorno` grava `{ retorno_declarado }` cru, sem join, e
// não tem canônico. Ele é lido como o que foi DECLARADO: sem número nem nome
// de vale (o conflito pode ser justamente um vale que não é daquela saída),
// e com os documentos vindos da própria declaração.

import { situacaoDoPagamento, FORMA_PAGAMENTO_LABEL } from './formasDePagamento'
import type { FormaPagamento, PagamentoLido, SituacaoDoPagamento } from './formasDePagamento'
import { formatBRL } from './money'

/**
 * Rótulo do motivo de insucesso. Mora aqui, e não só em `data/corridas.ts`,
 * porque o PDF não pode importar da camada de dados (ela carrega o cliente
 * Supabase). `data/corridas.ts` reexporta este mesmo mapa: continua havendo
 * um só.
 */
export const INSUCESSO_MOTIVO_LABEL = {
  ausente: 'Cliente ausente',
  endereco_errado: 'Endereço errado',
  recusou: 'Cliente recusou',
  outro: 'Outro',
} as const

export const DOCUMENTO_FISICO_LABEL: Record<string, string> = {
  convenio: 'Convênio',
  crediario: 'Crediário',
}

export type DocumentoDeclarado = { tipo: string; situacao: string }

export type ValeDoRetorno = {
  entregaId: string
  /** Nulo só no retorno em conflito, que não tem snapshot. */
  numeroVale: string | null
  tipo: 'cliente' | 'transferencia' | null
  clienteNome: string | null
  desfecho: 'entregue' | 'insucesso' | null
  motivo: string | null
  detalhe: string | null
  previstos: PagamentoLido[]
  realizados: PagamentoLido[]
  situacaoPagamento: SituacaoDoPagamento
  documentos: DocumentoDeclarado[]
}

export type LeituraDoRetorno = {
  /** `true` no conflito: o que foi declarado, não um documento selado. */
  declarado: boolean
  saidaRomaneioId: string | null
  vales: ValeDoRetorno[]
  entregues: number
  insucessos: number
  documentosRecebidos: number
  documentosFaltantes: number
  pagamentosDivergentes: number
}

type PagamentoDoPayload = {
  forma?: unknown
  valor_cents?: unknown
  troco_cents?: unknown
}

function pagamentos(lista: unknown): PagamentoLido[] {
  if (!Array.isArray(lista)) return []
  return (lista as PagamentoDoPayload[]).map((p) => ({
    forma: String(p.forma) as FormaPagamento,
    valor_cents: Number(p.valor_cents),
    troco_cents: Number(p.troco_cents ?? 0),
  }))
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null
}

/**
 * As linhas `d` do DCRR1, por vale.
 *
 * O canônico usa TAB e não escapa nada além de TAB/CR/LF, e as três colunas
 * de `d` são uuid e vocabulário fechado — então `split` é exato aqui. Linha
 * que não tem as quatro colunas é ignorada em vez de inventada.
 */
export function documentosDoCanonicoRetorno(
  canonico: string | null
): Map<string, DocumentoDeclarado[]> {
  const porVale = new Map<string, DocumentoDeclarado[]>()
  if (!canonico || !canonico.startsWith('DCRR1')) return porVale
  for (const linha of canonico.split('\n')) {
    const colunas = linha.split('\t')
    if (colunas[0] !== 'd' || colunas.length !== 4) continue
    const [, entregaId, tipo, situacao] = colunas
    const lista = porVale.get(entregaId) ?? []
    lista.push({ tipo, situacao })
    porVale.set(entregaId, lista)
  }
  return porVale
}

export function lerRetorno(payload: unknown, canonico: string | null): LeituraDoRetorno {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    saida_romaneio_id?: unknown
    vales?: unknown
    retorno_declarado?: unknown
  }

  const declarado = Array.isArray(p.retorno_declarado)
  const documentosAssinados = documentosDoCanonicoRetorno(canonico)
  const brutos = (declarado ? p.retorno_declarado : Array.isArray(p.vales) ? p.vales : []) as Array<
    Record<string, unknown>
  >

  const vales: ValeDoRetorno[] = brutos.map((v) => {
    const entregaId = String(v.entrega_id)
    const desfecho =
      v.desfecho === 'entregue' || v.desfecho === 'insucesso' ? v.desfecho : null
    const previstos = pagamentos(v.pagamentos_previstos)
    const realizados = pagamentos(v.pagamentos_realizados)
    const documentos = declarado
      ? Array.isArray(v.documentos)
        ? (v.documentos as Array<Record<string, unknown>>).map((d) => ({
            tipo: String(d.tipo),
            situacao: String(d.situacao),
          }))
        : []
      : (documentosAssinados.get(entregaId) ?? [])

    return {
      entregaId,
      numeroVale: textoOuNulo(v.numero_vale),
      tipo: v.tipo === 'cliente' || v.tipo === 'transferencia' ? v.tipo : null,
      clienteNome: textoOuNulo(v.cliente_nome),
      desfecho,
      // O desfecho `entregue` não tem motivo nem detalhe por definição — o
      // SQL já normaliza, e a leitura repete para o conflito, que é cru.
      motivo: desfecho === 'insucesso' ? textoOuNulo(v.motivo) : null,
      detalhe: desfecho === 'insucesso' ? textoOuNulo(v.detalhe) : null,
      previstos,
      realizados,
      // No conflito não há previsto no payload, e comparar contra nada
      // afirmaria divergência que ninguém calculou.
      situacaoPagamento: declarado ? 'sem_realizado' : situacaoDoPagamento(previstos, realizados),
      documentos,
    }
  })

  const todosDocumentos = vales.flatMap((v) => v.documentos)
  return {
    declarado,
    saidaRomaneioId: textoOuNulo(p.saida_romaneio_id),
    vales,
    entregues: vales.filter((v) => v.desfecho === 'entregue').length,
    insucessos: vales.filter((v) => v.desfecho === 'insucesso').length,
    documentosRecebidos: todosDocumentos.filter((d) => d.situacao === 'recebido').length,
    documentosFaltantes: todosDocumentos.filter((d) => d.situacao === 'faltante').length,
    pagamentosDivergentes: vales.filter((v) => v.situacaoPagamento === 'divergiu').length,
  }
}

export function textoDoDesfecho(vale: ValeDoRetorno): string {
  if (vale.desfecho === 'entregue') return 'Entregue'
  if (vale.desfecho === 'insucesso') {
    const motivo = vale.motivo
      ? (INSUCESSO_MOTIVO_LABEL[vale.motivo as keyof typeof INSUCESSO_MOTIVO_LABEL] ?? vale.motivo)
      : null
    return motivo ? `Insucesso — ${motivo}` : 'Insucesso'
  }
  return '—'
}

/** `Dinheiro R$ 60,00 · troco R$ 40,00` — o troco só quando existe. */
export function textoDoPagamentoRealizado(pagamento: PagamentoLido): string {
  const rotulo = FORMA_PAGAMENTO_LABEL[pagamento.forma] ?? pagamento.forma
  const troco = pagamento.troco_cents > 0 ? ` · troco ${formatBRL(pagamento.troco_cents)}` : ''
  return `${rotulo} ${formatBRL(pagamento.valor_cents)}${troco}`
}

export function textoDoDocumento(documento: DocumentoDeclarado): string {
  return `${DOCUMENTO_FISICO_LABEL[documento.tipo] ?? documento.tipo}: ${documento.situacao}`
}
