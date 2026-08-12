import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { FORMA_PAGAMENTO_LABEL, type FormaPagamento } from '@/data/pagamentos'
import { formatBRL } from '@/lib/money'
import type { FiltroPeriodo } from '@/data/relatorios'

// Leitura crua de TUDO que já foi gravado em `eventos` — diferente de
// `notificacoes.ts`, que é uma curadoria de só 3 tipos "que precisam de
// atenção de gestão". Aqui é o registro completo (inclusive os 2 tipos
// gerados automaticamente pelo trigger fn_log_entrega, que nunca tiveram
// UI nenhuma antes: entrega_criada, status_alterado), separável por
// filial. "quem realizou" sempre vem do join com profiles (agora que
// eventos.user_id tem FK — migration 20260809220000), não do payload —
// diferente de notificacoes.ts, que usa o snapshot autor_nome porque foi
// escrito antes dessa FK existir.

export type TipoEvento =
  | 'entrega_criada'
  | 'status_alterado'
  | 'pagamento_alterado'
  | 'falta_receita'
  | 'insucesso_detalhado'
  | 'entrega_cancelada'
  | (string & {})

export const TIPO_EVENTO_LABEL: Record<string, string> = {
  entrega_criada: 'Entrega criada',
  status_alterado: 'Status alterado',
  pagamento_alterado: 'Divergência de pagamento',
  falta_receita: 'Falta de receita',
  insucesso_detalhado: 'Insucesso detalhado',
  entrega_cancelada: 'Vale cancelado',
}

export type EventoAuditoria = {
  id: number
  tipo: TipoEvento
  numeroVale: string | null
  clienteNome: string | null
  lojaId: string | null
  lojaNome: string | null
  resumo: string
  detalhe: string | null
  autorNome: string
  ocorridoEm: string
}

const STATUS_ENTREGA_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  insucesso: 'Insucesso',
  cancelada: 'Cancelada',
}
const STATUS_FINANCEIRO_LABEL: Record<string, string> = {
  na_ordem: 'Na ordem',
  divergente: 'Divergente',
  conferido: 'Conferido',
}
const STATUS_DOCUMENTAL_LABEL: Record<string, string> = {
  nao_aplica: 'Não aplica',
  pendente: 'Pendente',
  recebido: 'Recebido',
  extraviado: 'Extraviado',
}

type StatusTrio = { entrega: string; financeiro: string; documental: string }

function resumoStatusAlterado(de: StatusTrio, para: StatusTrio): string {
  const linhas: string[] = []
  if (de.entrega !== para.entrega) {
    linhas.push(`entrega ${STATUS_ENTREGA_LABEL[de.entrega] ?? de.entrega} → ${STATUS_ENTREGA_LABEL[para.entrega] ?? para.entrega}`)
  }
  if (de.financeiro !== para.financeiro) {
    linhas.push(
      `financeiro ${STATUS_FINANCEIRO_LABEL[de.financeiro] ?? de.financeiro} → ${STATUS_FINANCEIRO_LABEL[para.financeiro] ?? para.financeiro}`
    )
  }
  if (de.documental !== para.documental) {
    linhas.push(
      `documental ${STATUS_DOCUMENTAL_LABEL[de.documental] ?? de.documental} → ${STATUS_DOCUMENTAL_LABEL[para.documental] ?? para.documental}`
    )
  }
  return linhas.length > 0 ? linhas.join('; ') : 'sem mudança detectável'
}

type EventoAuditoriaRow = {
  id: number
  tipo: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any
  ocorrido_em: string
  entregas: {
    loja_id: string
    numero_vale: string
    cliente_nome: string
    lojas: { nome: string } | null
  } | null
  profiles: { nome: string } | null
}

// resumo/detalhe por tipo — cobre os 6 conhecidos; qualquer tipo novo que
// apareça no futuro (mudança de código, teste manual etc.) ainda mostra
// alguma coisa em vez de quebrar a tela.
function resumoEDetalhe(row: EventoAuditoriaRow): { resumo: string; detalhe: string | null } {
  switch (row.tipo) {
    case 'entrega_criada':
      return { resumo: `Compra de ${formatBRL(row.payload.valor_compra_cents)}`, detalhe: null }
    case 'status_alterado':
      return { resumo: resumoStatusAlterado(row.payload.de, row.payload.para), detalhe: null }
    case 'pagamento_alterado': {
      const de = FORMA_PAGAMENTO_LABEL[row.payload.de as FormaPagamento] ?? row.payload.de
      const paraRaw = row.payload.para as FormaPagamento | Array<{ forma: FormaPagamento; valor_cents: number }>
      const para = Array.isArray(paraRaw)
        ? paraRaw.map((p) => `${FORMA_PAGAMENTO_LABEL[p.forma] ?? p.forma} (${formatBRL(p.valor_cents)})`).join(' + ')
        : (FORMA_PAGAMENTO_LABEL[paraRaw] ?? paraRaw)
      return { resumo: `Era ${de}, virou ${para}`, detalhe: row.payload.justificativa ?? null }
    }
    case 'falta_receita':
      return { resumo: 'Receita não retornou com o motoboy', detalhe: row.payload.justificativa ?? null }
    case 'insucesso_detalhado':
      return { resumo: 'Insucesso — motivo "outro"', detalhe: row.payload.motivo_detalhe ?? null }
    case 'entrega_cancelada':
      // o rótulo do tipo já diz "Vale cancelado" — aqui vale dizer o que
      // ele acrescenta: em que ponto do ciclo o cancelamento aconteceu.
      return { resumo: 'Cancelado antes de entrar em corrida', detalhe: row.payload.motivo ?? null }
    default:
      return { resumo: row.tipo, detalhe: row.payload ? JSON.stringify(row.payload) : null }
  }
}

function mapEvento(row: EventoAuditoriaRow): EventoAuditoria {
  const { resumo, detalhe } = resumoEDetalhe(row)
  return {
    id: row.id,
    tipo: row.tipo,
    numeroVale: row.entregas?.numero_vale ?? null,
    clienteNome: row.entregas?.cliente_nome ?? null,
    lojaId: row.entregas?.loja_id ?? null,
    lojaNome: row.entregas?.lojas?.nome ?? null,
    resumo,
    detalhe,
    autorNome: row.profiles?.nome ?? '—',
    ocorridoEm: row.ocorrido_em,
  }
}

const LIMITE_EVENTOS = 300

async function buscarEventosAuditoria(filtro: FiltroPeriodo): Promise<EventoAuditoria[]> {
  const inicio = new Date(`${filtro.dataInicio}T00:00:00`)
  const fim = new Date(`${filtro.dataFim}T00:00:00`)
  fim.setDate(fim.getDate() + 1)

  const { data, error } = await supabase
    .from('eventos')
    .select(
      // entregas tem duas FKs pra lojas (loja_id de origem, loja_destino_id
      // da transferência) — sem o hint !entregas_loja_id_fkey o PostgREST
      // não sabe qual usar e recusa o embed (erro PGRST201, ambiguidade).
      'id, tipo, payload, ocorrido_em, entregas(loja_id, numero_vale, cliente_nome, lojas!entregas_loja_id_fkey(nome)), profiles(nome)'
    )
    .gte('ocorrido_em', inicio.toISOString())
    .lt('ocorrido_em', fim.toISOString())
    .order('ocorrido_em', { ascending: false })
    .limit(LIMITE_EVENTOS)

  if (error) throw error
  return (data as unknown as EventoAuditoriaRow[]).map(mapEvento)
}

// `habilitado` existe porque este componente fica SEMPRE montado — ele é
// quem desenha o botão do cabeçalho. Sem isso, a query mais cara do app
// (eventos + join de entregas, lojas e profiles) rodava a cada carga de
// página pra todo admin/gerente, mesmo que ninguém abrisse o dialog.
//
// `staleTime` de 1 minuto pra abrir e fechar o dialog em seguida não
// disparar refetch: log de auditoria não muda de segundo em segundo, e a
// fila offline invalida a chave quando algo de fato acontece.
export function useEventosAuditoria(filtro: FiltroPeriodo, habilitado = true) {
  return useQuery({
    queryKey: ['eventos-auditoria', filtro],
    queryFn: () => buscarEventosAuditoria(filtro),
    enabled: habilitado,
    staleTime: 60_000,
  })
}
