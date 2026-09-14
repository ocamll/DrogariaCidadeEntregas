import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  textoDoPagamentoAlterado,
  textoDaReferenciaInformada,
  type LadoDoPagamentoAlterado,
} from '@/data/pagamentos'
import {
  origemDoPagamentoAlterado,
  type OrigemDoPagamentoAlterado,
} from '@/lib/formasDePagamento'

// Leitura agregada dos eventos que viram "notificação" pra gestão — 4
// tipos hoje (pagamento_alterado, falta_receita, falta_documento_convenio,
// insucesso_detalhado), escritos cada um no seu domínio (pagamentos.ts,
// documentos.ts, corridas.ts) mas lidos juntos aqui porque quem vê o
// cabeçalho não quer saber a origem, só "o que precisa de atenção".

export type TipoNotificacao =
  | 'pagamento_alterado'
  | 'falta_receita'
  | 'falta_documento_convenio'
  | 'insucesso_detalhado'

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
  /**
   * Só na divergência de pagamento: calculada no selo do retorno ou
   * informada por alguém. Sai dos marcadores gravados, nunca do texto.
   * Nulo nos outros tipos.
   */
  origem: OrigemDoPagamentoAlterado | null
}

type PayloadPagamentoAlterado = {
  // `LadoDoPagamentoAlterado` nos DOIS: string no histórico, lista hoje.
  de: LadoDoPagamentoAlterado
  para: LadoDoPagamentoAlterado
  justificativa: string
  autor_nome: string
}

// falta_receita e falta_documento_convenio compartilham a forma: os dois
// são "o papel não voltou", com justificativa escrita por quem conferiu.
type PayloadFaltaPapel = {
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
  payload: PayloadPagamentoAlterado | PayloadFaltaPapel | PayloadInsucessoDetalhado
  ocorrido_em: string
  entregas: { numero_vale: string; cliente_nome: string } | null
}

function resumoEJustificativa(row: EventoNotificacaoRow): {
  resumo: string
  justificativa: string
  autorNome: string
  origem: OrigemDoPagamentoAlterado | null
} {
  switch (row.tipo) {
    case 'pagamento_alterado': {
      const payload = row.payload as PayloadPagamentoAlterado
      // OS DOIS LADOS SÃO BICOMPATÍVEIS, e por razões diferentes:
      //
      //   `para`  virou lista quando a divergência passou a aceitar mais
      //           de uma forma na porta;
      //   `de`    vira lista no E3, porque um vale pode ter mais de um
      //           pagamento previsto.
      //
      // Os antigos nunca vão ser reescritos — `eventos` é append-only
      // (regra 6) —, então isto não é janela: é o histórico.
      const de = textoDoPagamentoAlterado(payload.de)
      const paraTexto = textoDoPagamentoAlterado(payload.para)
      // E4.1 — vale sem previsto NÃO ganha mais um previsto retroativo, e
      // a forma que o operador informou vive em campo próprio. Ela é
      // exibida ROTULADA: sem o rótulo, "Pix" apareceria do lado de "era"
      // e o leitor concluiria que o sistema sabia. Ele não sabia.
      const informado = textoDaReferenciaInformada(payload as unknown as Record<string, unknown>)
      const ladoAnterior = informado ? `${de} (${informado})` : de
      // De onde veio, pelos MARCADORES gravados — nunca pelo texto da
      // justificativa, que é livre. Ver `origemDoPagamentoAlterado`.
      const origem = origemDoPagamentoAlterado(payload as unknown as Record<string, unknown>)
      return {
        resumo:
          origem === 'calculada_no_retorno'
            ? `Divergência calculada no Romaneio de Retorno — era ${ladoAnterior}, virou ${paraTexto}.`
            : `Divergência informada — era ${ladoAnterior}, virou ${paraTexto}.`,
        justificativa: payload.justificativa,
        autorNome: payload.autor_nome,
        origem,
      }
    }
    case 'falta_receita': {
      const payload = row.payload as PayloadFaltaPapel
      return {
        resumo: 'Receita não retornou com o motoboy.',
        justificativa: payload.justificativa,
        autorNome: payload.autor_nome,
        origem: null,
      }
    }
    case 'falta_documento_convenio': {
      const payload = row.payload as PayloadFaltaPapel
      return {
        resumo: 'Documento de convênio não voltou assinado.',
        justificativa: payload.justificativa,
        autorNome: payload.autor_nome,
        origem: null,
      }
    }
    case 'insucesso_detalhado': {
      const payload = row.payload as PayloadInsucessoDetalhado
      return {
        resumo: 'Insucesso na entrega — motivo "outro".',
        justificativa: payload.motivo_detalhe,
        autorNome: payload.autor_nome,
        origem: null,
      }
    }
  }
}

function mapNotificacao(row: EventoNotificacaoRow): Notificacao {
  const { resumo, justificativa, autorNome, origem } = resumoEJustificativa(row)
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
    origem,
  }
}

const TIPOS_NOTIFICACAO: TipoNotificacao[] = [
  'pagamento_alterado',
  'falta_receita',
  'falta_documento_convenio',
  'insucesso_detalhado',
]
const NOTIFICACAO_SELECT = 'id, tipo, entrega_id, payload, ocorrido_em, entregas(numero_vale, cliente_nome)'

// Teto nosso, não o `max-rows` do servidor. Vale pras duas consultas
// abaixo: o aviso do dia e o registro permanente da aba "Ocorrências".
const LIMITE_NOTIFICACOES = 200

async function buscarNotificacoesHoje(): Promise<Notificacao[]> {
  const inicioDoDia = new Date()
  inicioDoDia.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('eventos')
    .select(NOTIFICACAO_SELECT)
    .in('tipo', TIPOS_NOTIFICACAO)
    .gte('ocorrido_em', inicioDoDia.toISOString())
    .order('ocorrido_em', { ascending: false })
    .limit(LIMITE_NOTIFICACOES)

  if (error) throw error
  return (data as unknown as EventoNotificacaoRow[]).map(mapNotificacao)
}

export function useNotificacoesHoje() {
  // Esta não dá pra adiar como a de auditoria: o contador do botão precisa
  // do número antes de alguém abrir o dialog. O que dá é não refazer a
  // query a cada remontagem — a fila offline invalida a chave quando uma
  // ocorrência nova é gravada, então 1 minuto de frescor não atrasa aviso.
  return useQuery({
    queryKey: ['notificacoes-hoje'],
    queryFn: buscarNotificacoesHoje,
    staleTime: 60_000,
  })
}

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
