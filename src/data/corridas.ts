import { useQuery } from '@tanstack/react-query'
import { supabase, isDuplicateKeyError } from '@/lib/supabase'
import { sha256Hex } from '@/lib/hash'
import { inserirEventoIdempotente } from '@/data/eventos'

// Tetos explícitos (nossos, não o `max-rows` do servidor). Dropdown de
// cadastro é limitado pela realidade; as duas listas operacionais
// (pendentes sem corrida, corridas abertas) deveriam viver perto do
// zero — se encostarem nesses números, o problema não é a query, é que
// tem coisa parada há muito tempo.
const LIMITE_DROPDOWN = 500
const LIMITE_OPERACIONAL = 500

export type Agencia = { id: string; nome: string; cidadeId: string | null }

type AgenciaRow = { id: string; nome: string; cidade_id: string | null }

async function buscarAgencias(): Promise<Agencia[]> {
  const { data, error } = await supabase
    .from('agencias')
    .select('id, nome, cidade_id')
    .eq('ativo', true)
    .order('nome')
    .limit(LIMITE_DROPDOWN)

  if (error) throw error
  return (data as unknown as AgenciaRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    cidadeId: row.cidade_id,
  }))
}

export function useAgencias() {
  return useQuery({ queryKey: ['agencias'], queryFn: buscarAgencias })
}

// Em cada cidade uma agência de tele atende todas as filiais dali, e uma
// agência de outra cidade não pode aparecer pra elas — é isso que este
// filtro garante na hora de abrir a corrida.
//
// Agência sem cidade fica de fora: no dado real toda agência tem cidade
// (o cadastro exige), e deixá-la passar traria de volta justamente a
// mistura que a cidade veio resolver. Ela aparece marcada "sem cidade" em
// Cadastros, que é onde o problema se conserta.
export function useAgenciasDaCidade(cidadeId: string | null | undefined) {
  const query = useAgencias()
  return {
    ...query,
    data: cidadeId ? query.data?.filter((a) => a.cidadeId === cidadeId) : query.data,
  }
}

export type Mototaxista = { id: string; nome: string; agenciaId: string | null }

async function buscarMototaxistas(): Promise<Mototaxista[]> {
  const { data, error } = await supabase
    .from('mototaxistas')
    .select('id, nome, agencia_id')
    .eq('ativo', true)
    .order('nome')
    .limit(LIMITE_DROPDOWN)

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
    .limit(LIMITE_OPERACIONAL)

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
  // gerado uma única vez por quem monta o payload (antes de enfileirar) —
  // assinaturas não tem policy de UPDATE, então o insert abaixo depende de
  // um id determinístico pra poder tratar reenvio como no-op.
  assinaturaId: string
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
// assinatura) — sem transação, então cada uma precisa sobreviver a reenvio
// da fila offline por conta própria. corridas tem policy de UPDATE (upsert
// funciona); assinaturas não (insert + trata 23505 como já aplicado). A
// imutabilidade de valor/cliente/vale só passa a valer DEPOIS que a
// assinatura existir — o trigger no banco cuida disso sozinho.
export async function criarCorridaComAssinatura(
  input: NovaCorridaComAssinatura
): Promise<{ numeroVales: string[] }> {
  const { error: corridaError } = await supabase.from('corridas').upsert({
    id: input.corridaId,
    tenant_id: input.tenantId,
    loja_id: input.lojaId,
    agencia_id: input.agenciaId,
    mototaxista_id: input.mototaxistaId,
    status: 'aberta',
    saida_por: input.criadoPor,
    // só o relógio do dispositivo — saida_em (relógio do servidor) é
    // carimbado pela trigger fn_corrida_registrar_saida, que preserva o
    // valor original se a fila offline reenviar isso depois.
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
    id: input.assinaturaId,
    tenant_id: input.tenantId,
    corrida_id: input.corridaId,
    strokes: input.strokes,
    hash_sha256: hashSha256,
    user_agent: navigator.userAgent,
  })
  if (assinaturaError && !isDuplicateKeyError(assinaturaError)) throw assinaturaError

  const rows = entregasAtualizadas as unknown as Array<{ numero_vale: string }>
  return { numeroVales: rows.map((r) => r.numero_vale) }
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
    // A ÚLTIMA que saiu vem PRIMEIRO, a pedido do usuário em 2026-08-20.
    // Mesma razão da lista de vales para saída: quem está no balcão
    // procura o que acabou de acontecer, e o resto da fila desce.
    //
    // Trocar a direção aqui é seguro porque `LIMITE_OPERACIONAL` é 500 e
    // corridas abertas simultâneas são poucas — não há truncamento
    // silencioso a considerar, que é o que tornaria a ordem uma decisão
    // sobre o que se PERDE em vez de sobre o que se vê primeiro.
    .order('saida_em', { ascending: false })
    .limit(LIMITE_OPERACIONAL)

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
  tenantId: string
  retornoPor: string
  autorNome: string
  // relógio do dispositivo, capturado antes de enfileirar — retorno_em
  // (relógio do servidor) é preenchido pelo trigger fn_corrida_registrar_retorno
  // no instante em que o UPDATE é de fato aplicado (dois relógios, regra 8).
  retornoEmLocal: string
  entregas: Array<{
    entregaId: string
    numeroVale: string
    statusEntrega: 'entregue' | 'insucesso'
    insucessoMotivo: InsucessoMotivo | null
    // só quando motivo === 'outro' — reaproveita entregas.observacoes
    // (coluna já existia, nunca usada em lugar nenhum antes disso).
    insucessoDetalhe: string | null
    // gerado no componente, só quando tem detalhe — mesmo padrão de
    // idempotência dos outros eventos (fecharCorrida passa pela fila
    // offline, pode reenviar depois de falha parcial).
    eventoIdempotencyKey: string | null
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
        // só toca observacoes quando há detalhe de verdade — mandar o
        // null do caso "entregue" apagaria qualquer observação que a
        // entrega já tivesse.
        ...(entrega.insucessoDetalhe ? { observacoes: entrega.insucessoDetalhe } : {}),
      })
      .eq('id', entrega.entregaId)
    if (error) throw error

    if (entrega.insucessoDetalhe && entrega.eventoIdempotencyKey) {
      await inserirEventoIdempotente({
        tenantId: input.tenantId,
        entregaId: entrega.entregaId,
        tipo: 'insucesso_detalhado',
        idempotencyKey: entrega.eventoIdempotencyKey,
        payload: {
          numero_vale: entrega.numeroVale,
          motivo_detalhe: entrega.insucessoDetalhe,
          autor_nome: input.autorNome,
        },
        registradoPor: input.retornoPor,
        ocorridoEmLocal: input.retornoEmLocal,
      })
    }
  }

  const { error: corridaError } = await supabase
    .from('corridas')
    .update({
      status: 'fechada',
      retorno_em_local: input.retornoEmLocal,
      retorno_por: input.retornoPor,
    })
    .eq('id', input.corridaId)
  if (corridaError) throw corridaError
}

