import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { inserirEventoIdempotente } from '@/data/eventos'

// Custódia de papel — convênio (documento que a agência/convênio exige de
// volta) e receita (controlada, precisa retornar com o motoboy). As duas
// já nascem no cadastro de entrega (convenio_id + status_documental,
// tem_receita) — aqui é só a leitura do que ainda tá pendente e a ação de
// marcar como recebido. Não é fluxo de balcão correndo, então mutation
// direta, sem fila offline (mesma lógica de src/data/cadastros.ts).

export type DocumentoConvenioPendente = {
  id: string
  numeroVale: string
  clienteNome: string
  convenioNome: string | null
  ocorridoEmLocal: string
}

type DocumentoConvenioPendenteRow = {
  id: string
  numero_vale: string
  cliente_nome: string
  ocorrido_em_local: string
  convenios: { nome: string } | null
}

async function buscarDocumentosConvenioPendentes(): Promise<DocumentoConvenioPendente[]> {
  const { data, error } = await supabase
    .from('entregas')
    .select('id, numero_vale, cliente_nome, ocorrido_em_local, convenios(nome)')
    .eq('status_documental', 'pendente')
    .order('ocorrido_em_local', { ascending: true })

  if (error) throw error
  return (data as unknown as DocumentoConvenioPendenteRow[]).map((row) => ({
    id: row.id,
    numeroVale: row.numero_vale,
    clienteNome: row.cliente_nome,
    convenioNome: row.convenios?.nome ?? null,
    ocorridoEmLocal: row.ocorrido_em_local,
  }))
}

export function useDocumentosConvenioPendentes() {
  return useQuery({
    queryKey: ['documentos-convenio-pendentes'],
    queryFn: buscarDocumentosConvenioPendentes,
  })
}

async function marcarDocumentoConvenioRecebido(input: { entregaId: string; recebidoPor: string }) {
  const { error } = await supabase
    .from('entregas')
    .update({
      status_documental: 'recebido',
      documento_recebido_em: new Date().toISOString(),
      documento_recebido_por: input.recebidoPor,
    })
    .eq('id', input.entregaId)
  if (error) throw error
}

export function useMarcarDocumentoConvenioRecebido() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: marcarDocumentoConvenioRecebido,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentos-convenio-pendentes'] })
    },
  })
}

export type ReceitaPendente = {
  id: string
  numeroVale: string
  clienteNome: string
  ocorridoEmLocal: string
}

type ReceitaPendenteRow = {
  id: string
  numero_vale: string
  cliente_nome: string
  ocorrido_em_local: string
}

async function buscarReceitasPendentes(): Promise<ReceitaPendente[]> {
  const { data, error } = await supabase
    .from('entregas')
    .select('id, numero_vale, cliente_nome, ocorrido_em_local')
    .eq('tem_receita', true)
    .is('receita_recebida_em', null)
    .order('ocorrido_em_local', { ascending: true })

  if (error) throw error
  return (data as unknown as ReceitaPendenteRow[]).map((row) => ({
    id: row.id,
    numeroVale: row.numero_vale,
    clienteNome: row.cliente_nome,
    ocorridoEmLocal: row.ocorrido_em_local,
  }))
}

export function useReceitasPendentes() {
  return useQuery({ queryKey: ['receitas-pendentes'], queryFn: buscarReceitasPendentes })
}

async function marcarReceitaRecebida(input: { entregaId: string; recebidoPor: string }) {
  const { error } = await supabase
    .from('entregas')
    .update({
      receita_recebida_em: new Date().toISOString(),
      receita_recebida_por: input.recebidoPor,
    })
    .eq('id', input.entregaId)
  if (error) throw error
}

export function useMarcarReceitaRecebida() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: marcarReceitaRecebida,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['receitas-pendentes'] })
    },
  })
}

export type NotificarFaltaReceitaInput = {
  tenantId: string
  entregaId: string
  justificativa: string
  registradoPor: string
  autorNome: string
  eventoIdempotencyKey: string
}

// Mesma dialog/botão que "divergência de pagamento" — por isso passa pela
// fila offline igual ela (ver src/data/filaOffline.ts, tipo
// 'falta_receita'). Não muda status da entrega sozinha: é a escalada
// ativa ("isso realmente sumiu"), separada da lista passiva de pendentes
// acima.
export async function notificarFaltaReceita(input: NotificarFaltaReceitaInput) {
  await inserirEventoIdempotente({
    tenantId: input.tenantId,
    entregaId: input.entregaId,
    tipo: 'falta_receita',
    idempotencyKey: input.eventoIdempotencyKey,
    payload: {
      justificativa: input.justificativa,
      autor_nome: input.autorNome,
    },
    registradoPor: input.registradoPor,
  })
}
