import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { FORMA_PAGAMENTO_LABEL, type FormaPagamento } from '@/data/pagamentos'
import { formatBRL } from '@/lib/money'

// Leitura agregada dos eventos que viram "notificação" pra gestão — 3
// tipos hoje (pagamento_alterado, falta_receita, insucesso_detalhado),
// escritos cada um no seu domínio (pagamentos.ts, documentos.ts,
// corridas.ts) mas lidos juntos aqui porque quem vê o cabeçalho não quer
// saber a origem, só "o que precisa de atenção".

export type TipoNotificacao = 'pagamento_alterado' | 'falta_receita' | 'insucesso_detalhado'

export type Notificacao = {
  id: number
  tipo: TipoNotificacao
  entregaId: string | null
  numeroVale: string | null
  clienteNome: string | null
  resumo: string
  justificativa: string
  autorNome: string
  ocorridoEm: string
}

type PayloadPagamentoAlterado = {
  de: FormaPagamento
  para: FormaPagamento | Array<{ forma: FormaPagamento; valor_cents: number }>
  justificativa: string
  autor_nome: string
}

type PayloadFaltaReceita = {
  justificativa: string
  autor_nome: string
}

type PayloadInsucessoDetalhado = {
  numero_vale: string
  motivo_detalhe: string
  autor_nome: string
}

type EventoNotificacaoRow = {
  id: number
  tipo: TipoNotificacao
  entrega_id: string | null
  payload: PayloadPagamentoAlterado | PayloadFaltaReceita | PayloadInsucessoDetalhado
  ocorrido_em: string
  entregas: { numero_vale: string; cliente_nome: string } | null
}

function resumoEJustificativa(row: EventoNotificacaoRow): { resumo: string; justificativa: string; autorNome: string } {
  switch (row.tipo) {
    case 'pagamento_alterado': {
      const payload = row.payload as PayloadPagamentoAlterado
      const de = FORMA_PAGAMENTO_LABEL[payload.de]
      // eventos antigos (antes da divisão em várias formas) gravaram
      // `para` como string única — normaliza pra sempre tratar como lista.
      const paraTexto = Array.isArray(payload.para)
        ? payload.para.map((p) => `${FORMA_PAGAMENTO_LABEL[p.forma]} (${formatBRL(p.valor_cents)})`).join(' + ')
        : FORMA_PAGAMENTO_LABEL[payload.para]
      return {
        resumo: `Divergência de pagamento — era ${de}, virou ${paraTexto}.`,
        justificativa: payload.justificativa,
        autorNome: payload.autor_nome,
      }
    }
    case 'falta_receita': {
      const payload = row.payload as PayloadFaltaReceita
      return {
        resumo: 'Receita não retornou com o motoboy.',
        justificativa: payload.justificativa,
        autorNome: payload.autor_nome,
      }
    }
    case 'insucesso_detalhado': {
      const payload = row.payload as PayloadInsucessoDetalhado
      return {
        resumo: 'Insucesso na entrega — motivo "outro".',
        justificativa: payload.motivo_detalhe,
        autorNome: payload.autor_nome,
      }
    }
  }
}

function mapNotificacao(row: EventoNotificacaoRow): Notificacao {
  const { resumo, justificativa, autorNome } = resumoEJustificativa(row)
  return {
    id: row.id,
    tipo: row.tipo,
    entregaId: row.entrega_id,
    numeroVale: row.entregas?.numero_vale ?? null,
    clienteNome: row.entregas?.cliente_nome ?? null,
    resumo,
    justificativa,
    autorNome,
    ocorridoEm: row.ocorrido_em,
  }
}

const TIPOS_NOTIFICACAO: TipoNotificacao[] = ['pagamento_alterado', 'falta_receita', 'insucesso_detalhado']
const NOTIFICACAO_SELECT = 'id, tipo, entrega_id, payload, ocorrido_em, entregas(numero_vale, cliente_nome)'

async function buscarNotificacoesHoje(): Promise<Notificacao[]> {
  const inicioDoDia = new Date()
  inicioDoDia.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('eventos')
    .select(NOTIFICACAO_SELECT)
    .in('tipo', TIPOS_NOTIFICACAO)
    .gte('ocorrido_em', inicioDoDia.toISOString())
    .order('ocorrido_em', { ascending: false })

  if (error) throw error
  return (data as unknown as EventoNotificacaoRow[]).map(mapNotificacao)
}

export function useNotificacoesHoje() {
  return useQuery({ queryKey: ['notificacoes-hoje'], queryFn: buscarNotificacoesHoje })
}

const LIMITE_NOTIFICACOES = 200

// Sem filtro de data — registro permanente do "porquê" de cada ocorrência,
// pra gestão poder consultar depois. A notificação do cabeçalho é só o
// aviso do dia; essa é a fonte de verdade.
async function buscarTodasNotificacoes(): Promise<Notificacao[]> {
  const { data, error } = await supabase
    .from('eventos')
    .select(NOTIFICACAO_SELECT)
    .in('tipo', TIPOS_NOTIFICACAO)
    .order('ocorrido_em', { ascending: false })
    .limit(LIMITE_NOTIFICACOES)

  if (error) throw error
  return (data as unknown as EventoNotificacaoRow[]).map(mapNotificacao)
}

export function useTodasNotificacoes() {
  return useQuery({ queryKey: ['notificacoes-todas'], queryFn: buscarTodasNotificacoes })
}
