import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

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

// ---------------------------------------------------------------------
// O QUE SAIU DAQUI EM 2026-08-25, E POR QUE NÃO VOLTA
//
// `NovaCorridaComAssinatura` / `criarCorridaComAssinatura` (o fluxo de
// corrida anterior ao romaneio) e `FecharCorridaInput` / `fecharCorrida`
// (o fechamento anterior ao Romaneio de Retorno) foram REMOVIDOS.
//
// Eles já não eram chamados por tela nenhuma desde 16/08 e 21/08; o que
// os mantinha vivos era a promessa de drenar filas antigas no IndexedDB
// das filiais. Essa promessa deixou de ter objeto: o corte para a V1
// zera o Supabase E o estado local dos terminais (Dexie v7), então não
// existe fila antiga para drenar.
//
// **O trigger da 2C.2 FICA**, e não pela compatibilidade: depois que um
// Romaneio de Retorno está selado, nenhum caminho — antigo, novo ou
// bug futuro — pode reescrever aqueles fatos. Virou invariante de
// banco, e é barata.
//
// Com o handler foi junto o reconhecimento do SQLSTATE `DCRR1` no
// cliente. Isso é consequência, não perda: sem escritor legado, não há
// quem receba a recusa. Se algum dia um caminho novo tentar escrever
// desfecho por fora do documento, o banco recusa e o erro aparece cru —
// que é o certo, porque aí seria bug, não compatibilidade.
// ---------------------------------------------------------------------

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
