import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Cadastros administrativos (agência, mototaxista, convênio) — telas de
// admin/gerente, uso ocasional, nunca competem com o teste dos 25 segundos
// do caixa. Por isso não entram na fila offline: mutation direta, sem
// upsert/id determinístico (essas tabelas nunca são reenviadas por retry).
// `id` fica a cargo do banco (default gen_random_uuid()), mesmo padrão de
// `lojas`/`tenants`/`profiles`.

// Teto explícito (nosso, não o `max-rows` do servidor) pras listas de
// cadastro. São limitadas pela realidade — a farmácia tem 18 filiais e
// dezenas de motoboys, não milhares —, mas query sem limite nenhum passa
// a depender de um número que ninguém escolheu e que muda no dashboard.
const LIMITE_CADASTRO = 500

// =====================================================================
// Agências
// =====================================================================

export type AgenciaCadastro = {
  id: string
  nome: string
  cnpj: string | null
  contato: string | null
  // cidade que a agência atende. É o que impede uma tele de Alegrete de
  // aparecer pra uma filial de São Gabriel — ver "Cidade, filial e
  // agência" no CLAUDE.md.
  cidadeId: string | null
  ativo: boolean
}

type AgenciaCadastroRow = {
  id: string
  nome: string
  cnpj: string | null
  contato: string | null
  cidade_id: string | null
  ativo: boolean
}

async function buscarAgenciasCadastro(): Promise<AgenciaCadastro[]> {
  const { data, error } = await supabase
    .from('agencias')
    .select('id, nome, cnpj, contato, cidade_id, ativo')
    .order('ativo', { ascending: false })
    .order('nome')
    .limit(LIMITE_CADASTRO)

  if (error) throw error
  return (data as unknown as AgenciaCadastroRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    cnpj: row.cnpj,
    contato: row.contato,
    cidadeId: row.cidade_id,
    ativo: row.ativo,
  }))
}

export function useAgenciasCadastro() {
  return useQuery({ queryKey: ['agencias-cadastro'], queryFn: buscarAgenciasCadastro })
}

export type SalvarAgenciaInput = {
  id?: string
  tenantId: string
  nome: string
  cnpj: string | null
  contato: string | null
  cidadeId: string
}

// insert quando não tem id, update quando tem — uma função só, mesmo botão
// "Salvar" serve pra criar e editar.
async function salvarAgencia(input: SalvarAgenciaInput) {
  if (input.id) {
    const { error } = await supabase
      .from('agencias')
      .update({
        nome: input.nome,
        cnpj: input.cnpj,
        contato: input.contato,
        cidade_id: input.cidadeId,
      })
      .eq('id', input.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('agencias').insert({
    tenant_id: input.tenantId,
    nome: input.nome,
    cnpj: input.cnpj,
    contato: input.contato,
    cidade_id: input.cidadeId,
  })
  if (error) throw error
}

export function useSalvarAgencia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: salvarAgencia,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencias-cadastro'] })
      queryClient.invalidateQueries({ queryKey: ['agencias'] })
    },
  })
}

async function alternarAtivoAgencia(input: { id: string; ativo: boolean }) {
  const { error } = await supabase.from('agencias').update({ ativo: input.ativo }).eq('id', input.id)
  if (error) throw error
}

export function useAlternarAtivoAgencia() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: alternarAtivoAgencia,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencias-cadastro'] })
      queryClient.invalidateQueries({ queryKey: ['agencias'] })
    },
  })
}

// =====================================================================
// Mototaxistas
// =====================================================================

export type MototaxistaCadastro = {
  id: string
  nome: string
  agenciaId: string | null
  cpf: string | null
  telefone: string | null
  ativo: boolean
}

type MototaxistaCadastroRow = {
  id: string
  nome: string
  agencia_id: string | null
  cpf: string | null
  telefone: string | null
  ativo: boolean
}

async function buscarMototaxistasCadastro(): Promise<MototaxistaCadastro[]> {
  const { data, error } = await supabase
    .from('mototaxistas')
    .select('id, nome, agencia_id, cpf, telefone, ativo')
    .order('ativo', { ascending: false })
    .order('nome')
    .limit(LIMITE_CADASTRO)

  if (error) throw error
  return (data as unknown as MototaxistaCadastroRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    agenciaId: row.agencia_id,
    cpf: row.cpf,
    telefone: row.telefone,
    ativo: row.ativo,
  }))
}

export function useMototaxistasCadastro() {
  return useQuery({ queryKey: ['mototaxistas-cadastro'], queryFn: buscarMototaxistasCadastro })
}

export type SalvarMototaxistaInput = {
  id?: string
  tenantId: string
  nome: string
  agenciaId: string
  cpf: string | null
  telefone: string | null
}

async function salvarMototaxista(input: SalvarMototaxistaInput) {
  if (input.id) {
    const { error } = await supabase
      .from('mototaxistas')
      .update({
        nome: input.nome,
        agencia_id: input.agenciaId,
        cpf: input.cpf,
        telefone: input.telefone,
      })
      .eq('id', input.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('mototaxistas').insert({
    tenant_id: input.tenantId,
    nome: input.nome,
    agencia_id: input.agenciaId,
    cpf: input.cpf,
    telefone: input.telefone,
  })
  if (error) throw error
}

export function useSalvarMototaxista() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: salvarMototaxista,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mototaxistas-cadastro'] })
      queryClient.invalidateQueries({ queryKey: ['mototaxistas'] })
    },
  })
}

async function alternarAtivoMototaxista(input: { id: string; ativo: boolean }) {
  const { error } = await supabase.from('mototaxistas').update({ ativo: input.ativo }).eq('id', input.id)
  if (error) throw error
}

export function useAlternarAtivoMototaxista() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: alternarAtivoMototaxista,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mototaxistas-cadastro'] })
      queryClient.invalidateQueries({ queryKey: ['mototaxistas'] })
    },
  })
}

// CONVÊNIOS SAÍRAM DAQUI NO PASSO 1 — 2026-09-08.
//
// A forma de pagamento "Convênio" continua existindo, e continua gerando
// pendência de papel: quem decide isso é a FORMA
// (`GERAM_DOCUMENTO_FISICO` em data/entregas.ts) e, no servidor,
// `romaneio_documentos_esperados` varrendo as linhas `p` do canônico.
// Nada disso passava por este bloco.
//
// O que saiu foi a identificação da EMPRESA — nome, CNPJ e as duas flags
// (`exige_assinatura`, que já não governava comportamento nenhum, e
// `farmacia_paga_entrega_integral`, que existia para o vale extra de
// endereço distante, extinto no mesmo passo). Regra comercial e
// detalhamento ficam no Trier.
//
// A TABELA `convenios` CONTINUA NO BANCO, e `entregas.convenio_id`
// continua sendo FK e integrando a linha `v` do DCR1 — nascendo nula
// daqui em diante. Retirada física é migration própria, no corte, com as
// dependências da saída do romaneio ajustadas.
