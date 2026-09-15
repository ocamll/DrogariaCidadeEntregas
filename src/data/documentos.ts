import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { buscarComTeto, type ListaComTeto } from '@/lib/paginacao'
import { inserirEventoIdempotente } from '@/data/eventos'
import { ErroTerminalDeSaida } from '@/data/romaneios'
import { documentosDoCanonicoRetorno } from '@/lib/documentoDoRetorno'
import {
  classificarResultadoDoRecebimento,
  documentosDoVale,
  type DocumentoDoVale,
} from '@/lib/documentosDoVale'

// --- RECEBER DOCUMENTO — a chegada posterior do papel, pelo vale ---------
//
// Migration `20260915140000`. Passa pela fila offline (tipo
// `receber_documento`): o `id` nasce na tela e é a chave de idempotência
// no servidor, então reenvio não duplica nem troca o primeiro recebedor.

export type ReceberDocumentoInput = {
  id: string
  entregaId: string
  tipoDocumento: string
  // relógio do dispositivo, capturado no clique (regra 8)
  ocorridoEmLocal: string
}

export async function receberDocumento(input: ReceberDocumentoInput): Promise<void> {
  const { data, error } = await supabase.rpc('receber_documento', {
    p_id: input.id,
    p_entrega_id: input.entregaId,
    p_tipo_documento: input.tipoDocumento,
    p_ocorrido_em_local: input.ocorridoEmLocal,
  })
  if (error) {
    // Sessão, cargo ou filial: repetir dá o mesmo resultado.
    if (error.code === '42501') throw new ErroTerminalDeSaida(error.message, { codigo: error.code })
    throw error
  }
  const classificacao = classificarResultadoDoRecebimento(data)
  if (classificacao.tipo === 'recusa') throw new ErroTerminalDeSaida(classificacao.mensagem, data)
  if (classificacao.tipo === 'desconhecido') {
    throw new Error('Resposta inesperada do servidor ao receber documento.')
  }
}

export type DocumentosDoValeLidos = {
  /** Sem retorno selado não há o que receber: o papel pode estar com o motoboy. */
  retornoSelado: boolean
  documentos: DocumentoDoVale[]
}

type RecebimentoRow = {
  tipo_documento: string
  registrado_em: string
  profiles: { nome: string } | null
}

async function buscarDocumentosDoVale(entregaId: string): Promise<DocumentosDoValeLidos> {
  const { data: entrega, error: erroEntrega } = await supabase
    .from('entregas')
    .select('corrida_id')
    .eq('id', entregaId)
    .single()
  if (erroEntrega) throw erroEntrega
  if (!entrega.corrida_id) return { retornoSelado: false, documentos: [] }

  const { data: retorno, error: erroRetorno } = await supabase
    .from('romaneios')
    .select('canonico')
    .eq('corrida_id', entrega.corrida_id)
    .eq('tipo', 'retorno')
    .eq('status', 'selado')
    .maybeSingle()
  if (erroRetorno) throw erroRetorno
  if (!retorno) return { retornoSelado: false, documentos: [] }

  const { data: recebimentos, error: erroRecebimentos } = await supabase
    .from('recebimentos_documento')
    .select('tipo_documento, registrado_em, profiles(nome)')
    .eq('entrega_id', entregaId)
  if (erroRecebimentos) throw erroRecebimentos

  const declarados = documentosDoCanonicoRetorno(retorno.canonico).get(entregaId) ?? []
  return {
    retornoSelado: true,
    documentos: documentosDoVale(
      declarados,
      (recebimentos as unknown as RecebimentoRow[]).map((r) => ({
        tipo: r.tipo_documento,
        recebidoPorNome: r.profiles?.nome ?? null,
        registradoEm: r.registrado_em,
      }))
    ),
  }
}

export function useDocumentosDoVale(entregaId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ['documentos-do-vale', entregaId],
    queryFn: () => buscarDocumentosDoVale(entregaId),
    enabled: habilitado,
    retry: false,
  })
}

// Pendência de papel é a única lista do app que cresce por inércia: ela
// só encolhe quando alguém marca como recebido. Se a farmácia deixar
// acumular, aqui é onde aparece primeiro — por isso tem teto explícito
// (nosso, não o do servidor) e avisa na tela quando tem mais.
const LIMITE_PENDENCIAS = 300

// Custódia de papel — convênio (documento que a agência/convênio exige de
// volta) e receita (controlada, precisa retornar com o motoboy). As duas
// já nascem no cadastro de entrega (forma de pagamento + status_documental,
// tem_receita) — aqui é só a leitura do que ainda tá pendente e a ação de
// marcar como recebido. Não é fluxo de balcão correndo, então mutation
// direta, sem fila offline (mesma lógica de src/data/cadastros.ts).

export type DocumentoConvenioPendente = {
  id: string
  numeroVale: string
  clienteNome: string
  ocorridoEmLocal: string
}

type DocumentoConvenioPendenteRow = {
  id: string
  numero_vale: string
  cliente_nome: string
  ocorrido_em_local: string
}

async function buscarDocumentosConvenioPendentes(): Promise<
  ListaComTeto<DocumentoConvenioPendente>
> {
  const { itens, temMais } = await buscarComTeto(LIMITE_PENDENCIAS, (limite) =>
    supabase
      .from('entregas')
      .select('id, numero_vale, cliente_nome, ocorrido_em_local')
      .eq('status_documental', 'pendente')
      .order('ocorrido_em_local', { ascending: true })
      .limit(limite)
  )

  return {
    temMais,
    itens: (itens as unknown as DocumentoConvenioPendenteRow[]).map((row) => ({
      id: row.id,
      numeroVale: row.numero_vale,
      clienteNome: row.cliente_nome,
      ocorridoEmLocal: row.ocorrido_em_local,
    })),
  }
}

export function useDocumentosConvenioPendentes() {
  return useQuery({
    queryKey: ['documentos-convenio-pendentes'],
    queryFn: buscarDocumentosConvenioPendentes,
  })
}

// documento_recebido_em (relógio do servidor) é carimbado pela trigger
// fn_entrega_registrar_custodia assim que o `_local` chega — o cliente
// manda só o próprio relógio, nunca o horário "oficial" (regra 8).
async function marcarDocumentoConvenioRecebido(input: {
  entregaId: string
  recebidoPor: string
  ocorridoEmLocal: string
}) {
  const { error } = await supabase
    .from('entregas')
    .update({
      status_documental: 'recebido',
      documento_recebido_em_local: input.ocorridoEmLocal,
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

async function buscarReceitasPendentes(): Promise<ListaComTeto<ReceitaPendente>> {
  const { itens, temMais } = await buscarComTeto(LIMITE_PENDENCIAS, (limite) =>
    supabase
      .from('entregas')
      .select('id, numero_vale, cliente_nome, ocorrido_em_local')
      .eq('tem_receita', true)
      .is('receita_recebida_em', null)
      .order('ocorrido_em_local', { ascending: true })
      .limit(limite)
  )

  return {
    temMais,
    itens: (itens as unknown as ReceitaPendenteRow[]).map((row) => ({
      id: row.id,
      numeroVale: row.numero_vale,
      clienteNome: row.cliente_nome,
      ocorridoEmLocal: row.ocorrido_em_local,
    })),
  }
}

export function useReceitasPendentes() {
  return useQuery({ queryKey: ['receitas-pendentes'], queryFn: buscarReceitasPendentes })
}

// Mesma dupla de relógios do convênio acima: receita_recebida_em vem da
// trigger, o cliente só carimba o `_local`.
async function marcarReceitaRecebida(input: {
  entregaId: string
  recebidoPor: string
  ocorridoEmLocal: string
}) {
  const { error } = await supabase
    .from('entregas')
    .update({
      receita_recebida_em_local: input.ocorridoEmLocal,
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
  // relógio do dispositivo, capturado no dialog antes de enfileirar.
  ocorridoEmLocal: string
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
    ocorridoEmLocal: input.ocorridoEmLocal,
  })
}

// --- notificar que o papel não voltou, da própria aba Documentos --------
//
// Até 2026-08-13 a aba só tinha o caminho feliz: "recebido"/"devolvida".
// Quem conferia a fila e descobria que o convênio não voltou assinado não
// tinha o que fazer ali — e pra receita a saída existia, mas escondida no
// menu "⋮" do vale, na outra aba. Descobrir o problema num lugar e ter que
// registrá-lo em outro é o mesmo descolamento que a conferência do
// fechamento tinha.
//
// NÃO tira o item da fila, por decisão do usuário: convênio e receita
// costumam aparecer dias depois, e a pendência só se encerra com o papel
// na mão. A notificação é o registro pra gestão, não o encerramento.
// Por isso também não escreve `status_documental = 'extraviado'` — aquele
// valor existe no schema desde o início e continua sem quem o escreva.
//
// Mutation direta, sem fila offline: é o padrão desta aba (tela de
// conferência, não fluxo de balcão correndo).
export type NotificarDocumentoInput = {
  tenantId: string
  entregaId: string
  justificativa: string
  registradoPor: string
  autorNome: string
  eventoIdempotencyKey: string
  ocorridoEmLocal: string
}

export async function notificarDocumentoConvenioNaoRetornou(input: NotificarDocumentoInput) {
  await inserirEventoIdempotente({
    tenantId: input.tenantId,
    entregaId: input.entregaId,
    tipo: 'falta_documento_convenio',
    idempotencyKey: input.eventoIdempotencyKey,
    payload: {
      justificativa: input.justificativa,
      autor_nome: input.autorNome,
    },
    registradoPor: input.registradoPor,
    ocorridoEmLocal: input.ocorridoEmLocal,
  })
}

function useNotificar(escrita: (input: NotificarDocumentoInput) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: escrita,
    onSuccess: () => {
      // a fila não muda (o item continua pendente) — o que muda é o que a
      // gestão enxerga
      queryClient.invalidateQueries({ queryKey: ['notificacoes-hoje'] })
      queryClient.invalidateQueries({ queryKey: ['notificacoes-todas'] })
      queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
    },
  })
}

export function useNotificarDocumentoConvenio() {
  return useNotificar(notificarDocumentoConvenioNaoRetornou)
}

export function useNotificarFaltaReceita() {
  return useNotificar(notificarFaltaReceita)
}
