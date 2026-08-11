import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Cadastros administrativos (agência, mototaxista, convênio) — telas de
// admin/gerente, uso ocasional, nunca competem com o teste dos 25 segundos
// do caixa. Por isso não entram na fila offline: mutation direta, sem
// upsert/id determinístico (essas tabelas nunca são reenviadas por retry).
// `id` fica a cargo do banco (default gen_random_uuid()), mesmo padrão de
// `lojas`/`tenants`/`profiles`.

// Teto explícito (nosso, não o `max-rows` do servidor) pras listas de
// cadastro. São limitadas pela realidade — a farmácia tem 17 filiais e
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
  ativo: boolean
}

async function buscarAgenciasCadastro(): Promise<AgenciaCadastro[]> {
  const { data, error } = await supabase
    .from('agencias')
    .select('id, nome, cnpj, contato, ativo')
    .order('ativo', { ascending: false })
    .order('nome')
    .limit(LIMITE_CADASTRO)

  if (error) throw error
  return data as unknown as AgenciaCadastro[]
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
}

// insert quando não tem id, update quando tem — uma função só, mesmo botão
// "Salvar" serve pra criar e editar.
async function salvarAgencia(input: SalvarAgenciaInput) {
  if (input.id) {
    const { error } = await supabase
      .from('agencias')
      .update({ nome: input.nome, cnpj: input.cnpj, contato: input.contato })
      .eq('id', input.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('agencias').insert({
    tenant_id: input.tenantId,
    nome: input.nome,
    cnpj: input.cnpj,
    contato: input.contato,
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

// =====================================================================
// Convênios
// =====================================================================

export type ConvenioCadastro = {
  id: string
  nome: string
  cnpj: string | null
  exigeAssinatura: boolean
  // convênio em que a farmácia banca a entrega inteira, inclusive o vale
  // extra de endereço distante (caso do Minerva) — ver migration
  // 20260810180000. Sem essa flag o cliente paga o extra em mãos.
  farmaciaPagaEntregaIntegral: boolean
  ativo: boolean
}

type ConvenioCadastroRow = {
  id: string
  nome: string
  cnpj: string | null
  exige_assinatura: boolean
  farmacia_paga_entrega_integral: boolean
  ativo: boolean
}

async function buscarConveniosCadastro(): Promise<ConvenioCadastro[]> {
  const { data, error } = await supabase
    .from('convenios')
    .select('id, nome, cnpj, exige_assinatura, farmacia_paga_entrega_integral, ativo')
    .order('ativo', { ascending: false })
    .order('nome')
    .limit(LIMITE_CADASTRO)

  if (error) throw error
  return (data as unknown as ConvenioCadastroRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    cnpj: row.cnpj,
    exigeAssinatura: row.exige_assinatura,
    farmaciaPagaEntregaIntegral: row.farmacia_paga_entrega_integral,
    ativo: row.ativo,
  }))
}

export function useConveniosCadastro() {
  return useQuery({ queryKey: ['convenios-cadastro'], queryFn: buscarConveniosCadastro })
}

export type SalvarConvenioInput = {
  id?: string
  tenantId: string
  nome: string
  cnpj: string | null
  exigeAssinatura: boolean
  farmaciaPagaEntregaIntegral: boolean
}

async function salvarConvenio(input: SalvarConvenioInput) {
  if (input.id) {
    const { error } = await supabase
      .from('convenios')
      .update({
        nome: input.nome,
        cnpj: input.cnpj,
        exige_assinatura: input.exigeAssinatura,
        farmacia_paga_entrega_integral: input.farmaciaPagaEntregaIntegral,
      })
      .eq('id', input.id)
    if (error) throw error
    return
  }

  const { error } = await supabase.from('convenios').insert({
    tenant_id: input.tenantId,
    nome: input.nome,
    cnpj: input.cnpj,
    exige_assinatura: input.exigeAssinatura,
    farmacia_paga_entrega_integral: input.farmaciaPagaEntregaIntegral,
  })
  if (error) throw error
}

export function useSalvarConvenio() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: salvarConvenio,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['convenios-cadastro'] })
    },
  })
}

async function alternarAtivoConvenio(input: { id: string; ativo: boolean }) {
  const { error } = await supabase.from('convenios').update({ ativo: input.ativo }).eq('id', input.id)
  if (error) throw error
}

export function useAlternarAtivoConvenio() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: alternarAtivoConvenio,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['convenios-cadastro'] })
    },
  })
}
