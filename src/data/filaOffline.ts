import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ItemFilaOperacao, type PayloadPorTipo, type TipoOperacaoFila } from '@/lib/db'
import { queryClient } from '@/lib/queryClient'
import { criarEntrega, criarTransferencia } from '@/data/entregas'
import { criarCorridaComAssinatura, fecharCorrida } from '@/data/corridas'
import { marcarDivergencia } from '@/data/pagamentos'
import { notificarFaltaReceita } from '@/data/documentos'

// Query keys invalidadas por tipo de operação, depois de sincronizar com
// sucesso — mesmas listas que cada tela já invalidava quando escrevia direto
// (ver histórico de src/data/entregas.ts, corridas.ts, pagamentos.ts).
//
// `eventos-auditoria` entra em TODAS: o Registro de Auditoria mostra os
// eventos crus, e toda operação daqui gera pelo menos um (nem que seja o
// `entrega_criada`/`status_alterado` do trigger). Ele fica sempre montado
// — o componente é quem desenha o botão do cabeçalho —, então a query
// carrega junto com a página e não recarrega sozinha depois. Sem isso o
// registro fica velho até alguém dar refresh, que foi como esse esquecimento
// apareceu: cancelei um vale e ele não surgiu na tela.
const QUERY_KEYS_POR_TIPO: Record<TipoOperacaoFila, string[]> = {
  entrega: ['entregas-hoje', 'eventos-auditoria'],
  // transferência não aparece mais em 'entregas-hoje' (aba própria desde
  // 2026-08-12), mas a corrida e o fechamento mexem nos dois tipos.
  transferencia: ['transferencias', 'eventos-auditoria'],
  corrida: [
    'entregas-hoje',
    'transferencias',
    'entregas-pendentes-sem-corrida',
    'entregas-historico',
    'eventos-auditoria',
  ],
  divergencia: [
    'entregas-hoje',
    'entregas-historico',
    'notificacoes-hoje',
    'notificacoes-todas',
    'eventos-auditoria',
  ],
  fechamento_corrida: [
    'entregas-hoje',
    'transferencias',
    'entregas-historico',
    'corridas-abertas',
    'notificacoes-hoje',
    'notificacoes-todas',
    'eventos-auditoria',
  ],
  falta_receita: ['notificacoes-hoje', 'notificacoes-todas', 'eventos-auditoria'],
}

async function executarOperacao(item: ItemFilaOperacao): Promise<void> {
  switch (item.tipo) {
    case 'entrega':
      await criarEntrega(item.payload)
      return
    case 'transferencia':
      await criarTransferencia(item.payload)
      return
    case 'corrida':
      await criarCorridaComAssinatura(item.payload)
      return
    case 'divergencia':
      await marcarDivergencia(item.payload)
      return
    case 'fechamento_corrida':
      await fecharCorrida(item.payload)
      return
    case 'falta_receita':
      await notificarFaltaReceita(item.payload)
      return
  }
}

// Grava local primeiro (sempre funciona, mesmo sem rede), tenta enviar em
// seguida. Todo id relevante já vem determinístico dentro do payload (gerado
// por quem chama, regra 5 do CLAUDE.md) — reenvio é sempre seguro, nunca
// duplicata, mesmo depois de falha parcial.
export async function enfileirarOperacao<T extends TipoOperacaoFila>(
  tipo: T,
  id: string,
  payload: PayloadPorTipo[T]
) {
  await db.filaOperacoes.put({
    id,
    tipo,
    payload,
    status: 'pendente',
    criadoEm: new Date().toISOString(),
    tentativas: 0,
  } as ItemFilaOperacao)
  void processarFilaOperacoes()
}

let processando = false

export async function processarFilaOperacoes() {
  if (processando) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  processando = true
  try {
    const pendentes = await db.filaOperacoes.toArray()
    for (const item of pendentes) {
      try {
        await executarOperacao(item)
        await db.filaOperacoes.delete(item.id)
        for (const chave of QUERY_KEYS_POR_TIPO[item.tipo]) {
          queryClient.invalidateQueries({ queryKey: [chave] })
        }
      } catch (error) {
        await db.filaOperacoes.update(item.id, {
          status: 'erro',
          tentativas: item.tentativas + 1,
          erro: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    processando = false
  }
}

export function useFilaOperacoesPendentes(): ItemFilaOperacao[] {
  return useLiveQuery(() => db.filaOperacoes.toArray(), [], [])
}

// Dispara sync ao voltar internet e uma vez ao abrir o app — sem isso a
// fila só esvazia na próxima vez que alguém enfileirar algo novo.
export function useSincronizarFilaOffline() {
  useEffect(() => {
    void processarFilaOperacoes()
    window.addEventListener('online', processarFilaOperacoes)
    return () => window.removeEventListener('online', processarFilaOperacoes)
  }, [])
}
