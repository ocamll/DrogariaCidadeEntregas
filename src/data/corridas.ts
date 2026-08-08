import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { uuidv7 } from '@/lib/uuid'
import { sha256Hex } from '@/lib/hash'

export type Agencia = { id: string; nome: string }

async function buscarAgencias(): Promise<Agencia[]> {
  const { data, error } = await supabase
    .from('agencias')
    .select('id, nome')
    .eq('ativo', true)
    .order('nome')

  if (error) throw error
  return data as unknown as Agencia[]
}

export function useAgencias() {
  return useQuery({ queryKey: ['agencias'], queryFn: buscarAgencias })
}

export type Mototaxista = { id: string; nome: string; agenciaId: string | null }

async function buscarMototaxistas(): Promise<Mototaxista[]> {
  const { data, error } = await supabase
    .from('mototaxistas')
    .select('id, nome, agencia_id')
    .eq('ativo', true)
    .order('nome')

  if (error) throw error

  const rows = data as unknown as Array<{ id: string; nome: string; agencia_id: string | null }>
  return rows.map((row) => ({ id: row.id, nome: row.nome, agenciaId: row.agencia_id }))
}

export function useMototaxistas() {
  return useQuery({ queryKey: ['mototaxistas'], queryFn: buscarMototaxistas })
}

export type EntregaPendente = {
  id: string
  numeroVale: string
  tipo: 'cliente' | 'transferencia'
  clienteNome: string
  clienteEndereco: string
}

// Só entregas sem corrida ainda — uma vez que entram numa corrida, saem
// dessa lista (RLS já restringe à loja do usuário, exceto admin/gerente).
async function buscarEntregasPendentesSemCorrida(): Promise<EntregaPendente[]> {
  const { data, error } = await supabase
    .from('entregas')
    .select('id, numero_vale, tipo, cliente_nome, cliente_endereco')
    .eq('status_entrega', 'pendente')
    .is('corrida_id', null)
    .order('registrado_em', { ascending: true })

  if (error) throw error

  const rows = data as unknown as Array<{
    id: string
    numero_vale: string
    tipo: 'cliente' | 'transferencia'
    cliente_nome: string
    cliente_endereco: string
  }>

  return rows.map((row) => ({
    id: row.id,
    numeroVale: row.numero_vale,
    tipo: row.tipo,
    clienteNome: row.cliente_nome,
    clienteEndereco: row.cliente_endereco,
  }))
}

export function useEntregasPendentesSemCorrida() {
  return useQuery({
    queryKey: ['entregas-pendentes-sem-corrida'],
    queryFn: buscarEntregasPendentesSemCorrida,
  })
}

export type NovaCorridaComAssinatura = {
  corridaId: string
  tenantId: string
  lojaId: string
  agenciaId: string | null
  mototaxistaId: string
  entregaIds: string[]
  strokes: unknown
  criadoPor: string
  ocorridoEmLocal: string
}

// Três escritas sequenciais (corrida, depois as entregas em lote, depois a
// assinatura) — mesma ressalva das outras telas: sem transação, sem fila
// offline ainda. A imutabilidade de valor/cliente/vale só passa a valer
// DEPOIS que a assinatura existir — o trigger no banco cuida disso sozinho.
export async function criarCorridaComAssinatura(
  input: NovaCorridaComAssinatura
): Promise<{ numeroVales: string[] }> {
  const { error: corridaError } = await supabase.from('corridas').insert({
    id: input.corridaId,
    tenant_id: input.tenantId,
    loja_id: input.lojaId,
    agencia_id: input.agenciaId,
    mototaxista_id: input.mototaxistaId,
    status: 'aberta',
    saida_em: input.ocorridoEmLocal,
    saida_por: input.criadoPor,
    saida_em_local: input.ocorridoEmLocal,
  })
  if (corridaError) throw corridaError

  const { data: entregasAtualizadas, error: entregasError } = await supabase
    .from('entregas')
    .update({ corrida_id: input.corridaId, status_entrega: 'em_rota' })
    .in('id', input.entregaIds)
    .select('numero_vale')
  if (entregasError) throw entregasError

  // hash do JSON canônico da corrida no ato — vincula a assinatura a
  // exatamente quais vales estavam nela no momento de assinar.
  const canonico = JSON.stringify({
    corridaId: input.corridaId,
    mototaxistaId: input.mototaxistaId,
    entregaIds: [...input.entregaIds].sort(),
    assinadoEm: input.ocorridoEmLocal,
  })
  const hashSha256 = await sha256Hex(canonico)

  const { error: assinaturaError } = await supabase.from('assinaturas').insert({
    id: uuidv7(),
    tenant_id: input.tenantId,
    corrida_id: input.corridaId,
    strokes: input.strokes,
    hash_sha256: hashSha256,
    user_agent: navigator.userAgent,
  })
  if (assinaturaError) throw assinaturaError

  const rows = entregasAtualizadas as unknown as Array<{ numero_vale: string }>
  return { numeroVales: rows.map((r) => r.numero_vale) }
}

export function useCriarCorridaComAssinatura() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: criarCorridaComAssinatura,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-pendentes-sem-corrida'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-historico'] })
    },
  })
}

export type InsucessoMotivo = 'ausente' | 'endereco_errado' | 'recusou' | 'outro'

export const INSUCESSO_MOTIVO_LABEL: Record<InsucessoMotivo, string> = {
  ausente: 'Cliente ausente',
  endereco_errado: 'Endereço errado',
  recusou: 'Cliente recusou',
  outro: 'Outro',
}

export const INSUCESSO_MOTIVO_OPTIONS = Object.entries(INSUCESSO_MOTIVO_LABEL) as Array<
  [InsucessoMotivo, string]
>

export type CorridaAberta = {
  id: string
  mototaxistaNome: string
  agenciaNome: string | null
  saidaEm: string | null
  entregas: Array<{
    id: string
    numeroVale: string
    clienteNome: string
    clienteEndereco: string
    statusEntrega: string
  }>
}

// Só corridas com pelo menos uma entrega ainda em_rota valem a pena mostrar
// aqui — uma corrida cujas entregas já foram todas resolvidas não deveria
// existir em estado 'aberta' (mas filtramos por segurança mesmo assim).
async function buscarCorridasAbertas(): Promise<CorridaAberta[]> {
  const { data, error } = await supabase
    .from('corridas')
    .select(
      'id, saida_em, mototaxistas(nome), agencias(nome), entregas(id, numero_vale, cliente_nome, cliente_endereco, status_entrega)'
    )
    .eq('status', 'aberta')
    .order('saida_em', { ascending: true })

  if (error) throw error

  const rows = data as unknown as Array<{
    id: string
    saida_em: string | null
    mototaxistas: { nome: string } | null
    agencias: { nome: string } | null
    entregas: Array<{
      id: string
      numero_vale: string
      cliente_nome: string
      cliente_endereco: string
      status_entrega: string
    }>
  }>

  return rows.map((row) => ({
    id: row.id,
    mototaxistaNome: row.mototaxistas?.nome ?? '—',
    agenciaNome: row.agencias?.nome ?? null,
    saidaEm: row.saida_em,
    entregas: row.entregas.map((e) => ({
      id: e.id,
      numeroVale: e.numero_vale,
      clienteNome: e.cliente_nome,
      clienteEndereco: e.cliente_endereco,
      statusEntrega: e.status_entrega,
    })),
  }))
}

export function useCorridasAbertas() {
  return useQuery({ queryKey: ['corridas-abertas'], queryFn: buscarCorridasAbertas })
}

export type FecharCorridaInput = {
  corridaId: string
  retornoPor: string
  retornoEm: string
  entregas: Array<{
    entregaId: string
    statusEntrega: 'entregue' | 'insucesso'
    insucessoMotivo: InsucessoMotivo | null
  }>
}

// Uma escrita por entrega (status/motivo variam linha a linha) + uma pra
// fechar a corrida — mesma ressalva de sempre: sequencial, sem transação.
export async function fecharCorrida(input: FecharCorridaInput) {
  for (const entrega of input.entregas) {
    const { error } = await supabase
      .from('entregas')
      .update({
        status_entrega: entrega.statusEntrega,
        insucesso_motivo: entrega.insucessoMotivo,
      })
      .eq('id', entrega.entregaId)
    if (error) throw error
  }

  const { error: corridaError } = await supabase
    .from('corridas')
    .update({
      status: 'fechada',
      retorno_em: input.retornoEm,
      retorno_por: input.retornoPor,
    })
    .eq('id', input.corridaId)
  if (corridaError) throw corridaError
}

export function useFecharCorrida() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fecharCorrida,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-historico'] })
      queryClient.invalidateQueries({ queryKey: ['corridas-abertas'] })
    },
  })
}
