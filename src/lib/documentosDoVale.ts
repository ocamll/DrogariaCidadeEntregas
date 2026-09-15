// RECEBER DOCUMENTO — a leitura e as decisões puras, sem rede.
//
// Migration `20260915140000`. O servidor decide o que está pendente pela
// linha `d … faltante` do DCRR1 selado; aqui mora só:
//
//   documentosDoVale          junta o que o retorno declarou com os
//                             recebimentos posteriores, pra tela
//   tiposQuePodemEstarPendentes
//                             o palpite pela LINHA da lista — decide se o
//                             menu mostra a ação e é a lista do modo sem
//                             rede. NÃO afirma pendência: o servidor confere
//   classificarResultadoDoRecebimento
//                             traduz o jsonb da função pra fila: sucesso,
//                             recusa definitiva ou resposta desconhecida
//
// Só `import type` — é o que permite o spec rodar sem Supabase.

import type { DocumentoDeclarado } from '@/lib/documentoDoRetorno'

export type SituacaoDoDocumentoDoVale = 'recebido_no_retorno' | 'pendente' | 'recebido_depois'

export type RecebimentoDeDocumento = {
  tipo: string
  recebidoPorNome: string | null
  registradoEm: string
}

export type DocumentoDoVale = {
  tipo: string
  situacao: SituacaoDoDocumentoDoVale
  /** Só em `recebido_depois`. */
  recebimento: RecebimentoDeDocumento | null
}

const ORDEM_DOS_TIPOS = ['convenio', 'crediario', 'receita']

function posicao(tipo: string): number {
  const i = ORDEM_DOS_TIPOS.indexOf(tipo)
  return i === -1 ? ORDEM_DOS_TIPOS.length : i
}

/**
 * Os três rótulos do §4 do documento de mudança de escopo. São de
 * apresentação: `recebido_no_retorno` vem do DCRR1, e um recebimento
 * posterior nunca o transforma em "voltou no retorno".
 */
export function documentosDoVale(
  declarados: ReadonlyArray<DocumentoDeclarado>,
  recebimentos: ReadonlyArray<RecebimentoDeDocumento>
): DocumentoDoVale[] {
  return [...declarados]
    .sort((a, b) => posicao(a.tipo) - posicao(b.tipo))
    .map((declarado) => {
      if (declarado.situacao === 'recebido') {
        return { tipo: declarado.tipo, situacao: 'recebido_no_retorno', recebimento: null }
      }
      const recebimento = recebimentos.find((r) => r.tipo === declarado.tipo) ?? null
      return {
        tipo: declarado.tipo,
        situacao: recebimento ? 'recebido_depois' : 'pendente',
        recebimento,
      }
    })
}

export type ValeParaRecebimento = {
  tipo: 'cliente' | 'transferencia'
  statusEntrega: string
  statusDocumental: string
  formasPrevistas: ReadonlyArray<{ forma: string }>
  temReceita: boolean
  receitaRecebidaEm: string | null
}

/**
 * Quais documentos PODEM estar pendentes, olhando só a linha do vale.
 *
 * Antes do retorno (`pendente`, `em_rota`) nada é oferecido: o papel pode
 * estar com o motoboy, e o documento de mudança de escopo proíbe afirmar
 * que ele "não voltou" antes da conferência. Cancelado também não.
 */
export function tiposQuePodemEstarPendentes(vale: ValeParaRecebimento): string[] {
  if (vale.tipo !== 'cliente') return []
  if (vale.statusEntrega !== 'entregue' && vale.statusEntrega !== 'insucesso') return []
  const tipos: string[] = []
  if (vale.statusDocumental === 'pendente') {
    for (const forma of ['convenio', 'crediario']) {
      if (vale.formasPrevistas.some((p) => p.forma === forma)) tipos.push(forma)
    }
  }
  if (vale.temReceita && !vale.receitaRecebidaEm) tipos.push('receita')
  return tipos
}

/** Espelha o gate do servidor: o admin não declara recebimento físico. */
export function cargoRecebeDocumento(papel: string): boolean {
  return papel === 'caixa' || papel === 'gerente'
}

export type ClassificacaoDoRecebimento =
  | { tipo: 'sucesso'; jaRecebidoPorOutro: boolean }
  | { tipo: 'recusa'; mensagem: string }
  | { tipo: 'desconhecido' }

const MENSAGEM_DA_RECUSA: Record<string, string> = {
  sem_pendencia: 'O retorno deste vale não declarou esse documento como faltante.',
  tipo_invalido: 'Tipo de documento inválido.',
}

export function classificarResultadoDoRecebimento(data: unknown): ClassificacaoDoRecebimento {
  const resultado =
    data && typeof data === 'object' ? (data as { resultado?: unknown }).resultado : undefined
  if (resultado === 'recebido') return { tipo: 'sucesso', jaRecebidoPorOutro: false }
  // Outra pessoa recebeu antes. Não é falha e não há o que retentar: o
  // documento está na farmácia, e a tela mostra quem o recebeu.
  if (resultado === 'ja_recebido') return { tipo: 'sucesso', jaRecebidoPorOutro: true }
  // `hasOwnProperty`, nunca `in`: `in` enxerga o protótipo, e um
  // `resultado: 'toString'` viraria recusa DEFINITIVA em vez de retentável.
  if (typeof resultado === 'string' && Object.prototype.hasOwnProperty.call(MENSAGEM_DA_RECUSA, resultado)) {
    return { tipo: 'recusa', mensagem: MENSAGEM_DA_RECUSA[resultado] }
  }
  return { tipo: 'desconhecido' }
}
