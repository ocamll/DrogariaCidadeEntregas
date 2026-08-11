import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Gestão de usuários (admin). Duas metades com caminhos diferentes:
//
// - CRIAR passa pela Edge Function `criar-usuario`, porque mexer no
//   Supabase Auth exige a `service_role` — que nunca pode rodar no
//   navegador. É a única chamada de backend do projeto.
// - EDITAR / ATIVAR / DESATIVAR é UPDATE comum em `profiles`, resolvido
//   pela RLS (policy profiles_update_admin) + o trigger
//   fn_profiles_protege_campos, que barra não-admin de mexer em papel,
//   loja, nome e acesso mesmo na própria linha.
//
// Não entra na fila offline: tela de admin, uso ocasional, não compete
// com o teste dos 25 segundos do caixa — mesmo critério de cadastros.ts.
//
// Senha não aparece aqui de propósito. Definir a inicial faz parte da
// criação; trocar depois é feito direto no Supabase pelo dono do
// projeto, decisão consciente pra não ter rota de reset no app.

export type PapelUsuario = 'caixa' | 'gerente' | 'admin'

export const PAPEL_USUARIO_LABEL: Record<PapelUsuario, string> = {
  caixa: 'Caixa',
  gerente: 'Gerente',
  admin: 'Administrador',
}

export const PAPEL_USUARIO_OPTIONS = Object.entries(PAPEL_USUARIO_LABEL) as Array<
  [PapelUsuario, string]
>

export type Usuario = {
  id: string
  nome: string
  email: string | null
  papel: PapelUsuario
  lojaId: string | null
  lojaNome: string | null
  ativo: boolean
}

// TODO: substituir por Database['public']['Tables']['profiles']['Row']
// quando `supabase gen types typescript` estiver configurado.
type UsuarioRow = {
  id: string
  nome: string
  email: string | null
  papel: PapelUsuario
  loja_id: string | null
  ativo: boolean
  lojas: { nome: string } | null
}

// Time real da farmácia é de 3 a 5 pessoas hoje e não passa de dezenas
// nem com 17 filiais — teto nosso, só pra nenhuma query depender do
// `max-rows` do servidor.
const LIMITE_USUARIOS = 500

async function buscarUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nome, email, papel, loja_id, ativo, lojas(nome)')
    .order('ativo', { ascending: false })
    .order('nome')
    .limit(LIMITE_USUARIOS)

  if (error) throw error

  return (data as unknown as UsuarioRow[]).map((row) => ({
    id: row.id,
    nome: row.nome,
    email: row.email,
    papel: row.papel,
    lojaId: row.loja_id,
    lojaNome: row.lojas?.nome ?? null,
    ativo: row.ativo,
  }))
}

export function useUsuarios() {
  return useQuery({ queryKey: ['usuarios'], queryFn: buscarUsuarios })
}

export type NovoUsuario = {
  email: string
  senha: string
  nome: string
  papel: PapelUsuario
  lojaId: string | null
}

// O Authorization vai EXPLÍCITO com o token da sessão. Parece redundante
// (o `functions.invoke` deveria anexar sozinho), mas na prática ele
// mandava a anon key: a função recebia uma chamada sem usuário, não
// achava perfil de admin e devolvia 403 mesmo com admin logado. Achado
// testando — chamada idêntica via fetch com o header na mão passava.
// É com esse token que a função confere, do lado do servidor, que quem
// chamou é admin de verdade. O tenant nunca vai no corpo: a função pega
// do perfil de quem chamou, pra não dar pra criar usuário em outro
// tenant.
async function criarUsuario(input: NovoUsuario): Promise<void> {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('Sessão expirada — entra de novo pra criar usuário.')

  const { data, error } = await supabase.functions.invoke('criar-usuario', {
    headers: { Authorization: `Bearer ${token}` },
    body: {
      email: input.email,
      senha: input.senha,
      nome: input.nome,
      papel: input.papel,
      lojaId: input.lojaId,
    },
  })

  // Erro de função vem em dois formatos: falha de transporte (`error`) e
  // recusa da própria função com motivo no corpo. O segundo é o que traz
  // mensagem útil ("e-mail já existe", "papel inválido"), então tem que
  // ser lido — senão o admin vê "erro" e não sabe o que fazer.
  if (error) {
    const detalhe = await lerMensagemDeErro(error)
    throw new Error(detalhe ?? error.message)
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }
}

async function lerMensagemDeErro(error: unknown): Promise<string | null> {
  const contexto = (error as { context?: unknown }).context
  if (!(contexto instanceof Response)) return null
  try {
    const corpo = await contexto.json()
    return typeof corpo?.error === 'string' ? corpo.error : null
  } catch {
    return null
  }
}

export function useCriarUsuario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: criarUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
  })
}

export type EdicaoUsuario = {
  id: string
  nome: string
  papel: PapelUsuario
  lojaId: string | null
}

// UPDATE direto: não precisa de service_role pra editar quem já existe.
// Quem garante que só admin passa por aqui é a RLS + o trigger, não a
// tela.
async function editarUsuario(input: EdicaoUsuario): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ nome: input.nome, papel: input.papel, loja_id: input.lojaId })
    .eq('id', input.id)
  if (error) throw error
}

export function useEditarUsuario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: editarUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
  })
}

// Desativar é o "remover" daqui — nunca DELETE, mesmo princípio da regra
// 4. Um perfil inativo faz `current_tenant_id()` devolver null, então a
// pessoa não enxerga mais nada mesmo que a sessão dela ainda esteja
// aberta no navegador.
async function alternarAtivoUsuario(input: { id: string; ativo: boolean }): Promise<void> {
  const { error } = await supabase.from('profiles').update({ ativo: input.ativo }).eq('id', input.id)
  if (error) throw error
}

export function useAlternarAtivoUsuario() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: alternarAtivoUsuario,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['usuarios'] }),
  })
}
