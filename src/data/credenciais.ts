import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { publicIdDoToken } from '@/lib/tokenCartao'
import { credencialEntraNoCache } from '@/lib/credencialNoCache'
import { supabase } from '@/lib/supabase'
import { db, type CredencialEmCache } from '@/lib/db'

// Credencial física do motoboy: cartão (identifica) + PIN (autentica).
//
// Tudo aqui passa por RPC, e isso não é preferência de estilo: a tabela
// `motoboy_credenciais` não tem grant de INSERT/UPDATE/DELETE pra
// `authenticated`, e as colunas `token_hash`/`pin_hash` ficam de fora até
// do grant de SELECT. Não existe caminho pelo PostgREST — nem se alguém
// tentar. Ver a migration 20260816130000 pro porquê.
//
// Consequência prática que vale lembrar ao mexer: o `select` abaixo LISTA
// as colunas uma a uma. Trocar por `*` faz o PostgREST pedir tudo e voltar
// permission denied.

const LIMITE_CADASTRO = 500

// TODO: substituir por Database['public']['Tables']['motoboy_credenciais']['Row']
// quando `supabase gen types typescript` estiver configurado neste projeto.
type CredencialRow = {
  id: string
  motoboy_id: string | null
  profile_id: string | null
  public_id: string
  ativo: boolean
  tem_pin: boolean
  emitido_em: string
  ultimo_uso_em: string | null
  tentativas_pin: number
  bloqueado_ate: string | null
}

// Um titular, nunca os dois — o CHECK `motoboy_credenciais_um_titular`
// garante isso no banco. Aqui os dois campos existem nulos porque a
// listagem do admin mostra as duas tabelas a partir da mesma consulta.
export type Credencial = {
  id: string
  motoboyId: string | null
  profileId: string | null
  publicId: string
  ativo: boolean
  temPin: boolean
  emitidoEm: string
  ultimoUsoEm: string | null
  tentativasPin: number
  bloqueadoAte: string | null
}

async function buscarCredenciais(): Promise<Credencial[]> {
  const { data, error } = await supabase
    .from('motoboy_credenciais')
    .select(
      'id, motoboy_id, profile_id, public_id, ativo, tem_pin, emitido_em, ultimo_uso_em, tentativas_pin, bloqueado_ate'
    )
    .eq('ativo', true)
    .order('emitido_em', { ascending: false })
    .limit(LIMITE_CADASTRO)

  if (error) throw error

  return (data as unknown as CredencialRow[]).map((row) => ({
    id: row.id,
    motoboyId: row.motoboy_id,
    profileId: row.profile_id,
    publicId: row.public_id,
    ativo: row.ativo,
    temPin: row.tem_pin,
    emitidoEm: row.emitido_em,
    ultimoUsoEm: row.ultimo_uso_em,
    tentativasPin: row.tentativas_pin,
    bloqueadoAte: row.bloqueado_ate,
  }))
}

export function useCredenciais() {
  return useQuery({ queryKey: ['credenciais'], queryFn: buscarCredenciais })
}

// O bloqueio tem prazo, então "bloqueado" é uma pergunta sobre AGORA, não
// um estado guardado. Quem chama precisa reavaliar quando a tela
// re-renderiza — por isso é função, não campo.
export function credencialBloqueada(credencial: Credencial): boolean {
  return credencial.bloqueadoAte !== null && new Date(credencial.bloqueadoAte) > new Date()
}

export type CredencialEmitida = {
  credencialId: string
  publicId: string
  // Existe só nesta resposta e em lugar nenhum mais — o banco guarda só o
  // HMAC. Se a tela perder isso antes de imprimir, o caminho é emitir
  // outra credencial, não "recuperar".
  token: string
}

export function useEmitirCredencial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (motoboyId: string): Promise<CredencialEmitida> => {
      const { data, error } = await supabase.rpc('emitir_credencial', {
        p_motoboy_id: motoboyId,
      })
      if (error) throw error

      const linhas = data as unknown as Array<{
        credencial_id: string
        public_id: string
        token: string
      }>
      if (!linhas || linhas.length === 0) throw new Error('A emissão não devolveu o cartão.')

      return {
        credencialId: linhas[0].credencial_id,
        publicId: linhas[0].public_id,
        token: linhas[0].token,
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credenciais'] })
      queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
    },
  })
}

// O cartão do GERENTE — 4B.1, 2026-09-11.
//
// Mesma emissão, outro titular e outra recusa: o banco barra quem não é
// gerente, quem está bloqueado e quem está sem filial (a autorização é
// conferida contra a filial do documento, então um gerente sem filial
// receberia um cartão que nunca casa com documento nenhum).
//
// A porta é outra função de propósito. Uma só, com dois parâmetros
// nuláveis, deixaria "emitir para ninguém" representável — e o erro
// apareceria no balcão, não aqui.
export function useEmitirCredencialDeGerente() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (profileId: string): Promise<CredencialEmitida> => {
      const { data, error } = await supabase.rpc('emitir_credencial_de_gerente', {
        p_profile_id: profileId,
      })
      if (error) throw error

      const linhas = data as unknown as Array<{
        credencial_id: string
        public_id: string
        token: string
      }>
      if (!linhas || linhas.length === 0) throw new Error('A emissão não devolveu o cartão.')

      return {
        credencialId: linhas[0].credencial_id,
        publicId: linhas[0].public_id,
        token: linhas[0].token,
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credenciais'] })
      queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
    },
  })
}

export function useRevogarCredencial() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (credencialId: string) => {
      const { error } = await supabase.rpc('revogar_credencial', {
        p_credencial_id: credencialId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credenciais'] })
      queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
    },
  })
}

// Não existe "mostrar PIN" e não pode passar a existir. Isto só apaga o
// hash: quem escolhe o novo é o motoboy, no primeiro uso do cartão dele.
export function useRedefinirPin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (credencialId: string) => {
      const { error } = await supabase.rpc('redefinir_pin', { p_credencial_id: credencialId })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credenciais'] })
      queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
    },
  })
}

// =====================================================================
// Identificação e autenticação — usadas pela Nova Corrida (etapa 4)
//
// Ficam aqui, e não em corridas.ts, porque são sobre a credencial. A
// amarração com o Romaneio (autorização de uso único ligada ao
// document_hash) é outra coisa e entra na etapa 3.
// =====================================================================

// UNIÃO, e não campos nuláveis — 4B.1, 2026-09-11.
//
// O cartão do gerente não identifica motoboy nenhum, e um tipo com
// `motoboyNome: string | null` deixaria cada tela decidir sozinha o que
// fazer com o nulo (na prática: mostrar "—" e seguir). Com a união, o
// compilador ENUMERA quem precisa tratar o caso, que é o mesmo mecanismo
// que a 2D.6 usou pra tirar o `fechamento_corrida` da fila.
export type CredencialIdentificada =
  | {
      titular: 'motoboy'
      credencialId: string
      publicId: string
      motoboyId: string
      motoboyNome: string
      agenciaId: string | null
      agenciaNome: string | null
      temPin: boolean
      bloqueadoAte: string | null
    }
  | {
      titular: 'gerente'
      credencialId: string
      publicId: string
      profileId: string
      gerenteNome: string
      lojaId: string | null
      lojaNome: string | null
      temPin: boolean
      bloqueadoAte: string | null
    }

// Zero linhas = cartão desconhecido, revogado, de outro tenant, ou com o
// segredo errado. A tela mostra a mesma coisa nos quatro casos, de
// propósito: dizer qual deles é ajudaria só quem está tentando descobrir.
export async function identificarCredencial(
  token: string
): Promise<CredencialIdentificada | null> {
  const { data, error } = await supabase.rpc('identificar_credencial', { p_token: token })
  if (error) throw error

  const linhas = data as unknown as Array<{
    credencial_id: string
    public_id: string
    titular_tipo: 'motoboy' | 'gerente'
    motoboy_id: string | null
    motoboy_nome: string | null
    agencia_id: string | null
    agencia_nome: string | null
    profile_id: string | null
    titular_nome: string | null
    loja_id: string | null
    loja_nome: string | null
    tem_pin: boolean
    bloqueado_ate: string | null
  }>
  if (!linhas || linhas.length === 0) return null

  const linha = linhas[0]

  if (linha.titular_tipo === 'gerente') {
    return {
      titular: 'gerente',
      credencialId: linha.credencial_id,
      publicId: linha.public_id,
      profileId: linha.profile_id as string,
      gerenteNome: linha.titular_nome ?? '—',
      lojaId: linha.loja_id,
      lojaNome: linha.loja_nome,
      temPin: linha.tem_pin,
      bloqueadoAte: linha.bloqueado_ate,
    }
  }

  return {
    titular: 'motoboy',
    credencialId: linha.credencial_id,
    publicId: linha.public_id,
    motoboyId: linha.motoboy_id as string,
    motoboyNome: linha.motoboy_nome ?? '—',
    agenciaId: linha.agencia_id,
    agenciaNome: linha.agencia_nome,
    temPin: linha.tem_pin,
    bloqueadoAte: linha.bloqueado_ate,
  }
}

export type MotivoFalhaPin = 'credencial_invalida' | 'pin_nao_definido' | 'pin_incorreto' | 'bloqueado'

export type ResultadoAutenticacao =
  | { ok: true; credencialId: string }
  | { ok: false; motivo: MotivoFalhaPin; bloqueadoAte: string | null }

export const MOTIVO_FALHA_PIN_LABEL: Record<MotivoFalhaPin, string> = {
  credencial_invalida: 'Credencial não reconhecida.',
  pin_nao_definido: 'Esta credencial ainda não tem PIN. O motoboy precisa criar o dele.',
  pin_incorreto: 'PIN incorreto.',
  bloqueado: 'Credencial bloqueada por tentativas seguidas de PIN incorreto.',
}

// PIN errado NÃO vira exceção — nem aqui nem no banco. A função SQL
// devolve o resultado justamente pra poder gravar a tentativa antes de
// responder: `raise` faria rollback e o bloqueio progressivo nunca
// subiria de contador. Erro de verdade (rede, sessão sem tenant) continua
// sendo `throw`.
export async function autenticarCredencial(
  token: string,
  pin: string
): Promise<ResultadoAutenticacao> {
  const { data, error } = await supabase.rpc('autenticar_credencial', {
    p_token: token,
    p_pin: pin,
  })
  if (error) throw error

  const linhas = data as unknown as Array<{
    ok: boolean
    motivo: MotivoFalhaPin | null
    bloqueado_ate: string | null
    credencial_id: string | null
  }>
  const linha = linhas?.[0]
  if (!linha) throw new Error('A autenticação não devolveu resposta.')

  if (linha.ok && linha.credencial_id) return { ok: true, credencialId: linha.credencial_id }

  return {
    ok: false,
    motivo: linha.motivo ?? 'credencial_invalida',
    bloqueadoAte: linha.bloqueado_ate,
  }
}

// Só funciona com a credencial sem PIN — recém-emitida, ou recém-redefinida
// pelo admin. Exige o token completo: quem cria o PIN tem que estar com o
// cartão na mão.
export async function definirPin(token: string, pin: string): Promise<void> {
  const { error } = await supabase.rpc('definir_pin', { p_token: token, p_pin: pin })
  if (error) throw error
}

// Mesma regra do banco (`pin_aceitavel`), repetida aqui só pra a tela
// responder sem ida ao servidor. O banco continua sendo quem decide — se
// as duas divergirem, quem vale é lá.
export function pinAceitavel(pin: string): string | null {
  if (!/^[0-9]{6}$/.test(pin)) return 'O PIN precisa ter exatamente 6 dígitos.'
  if (/^(.)\1{5}$/.test(pin)) return 'Esse PIN repete o mesmo dígito seis vezes. Escolha outro.'
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    return 'Esse PIN é uma sequência. Escolha outro.'
  }
  return null
}

// =====================================================================
// Cache local — o que faz bipar funcionar sem rede
//
// Offline o navegador não tem como VALIDAR o cartão (isso exige o HMAC, e
// o segredo dele vive no servidor). O que ele consegue é reconhecer o
// `public_id` e mostrar de quem é aquele cartão, pra o caixa saber que
// bipou o certo.
//
// A diferença precisa aparecer na tela sem sutileza: online é "credencial
// reconhecida", offline é "credencial informada". A segunda é uma
// afirmação do cartão, não do sistema.
// =====================================================================


type LinhaCache = {
  public_id: string
  motoboy_id: string | null
  profile_id: string | null
  tem_pin: boolean
  mototaxistas: { nome: string; agencia_id: string | null; agencias: { nome: string } | null } | null
  // `motoboy_credenciais` tem TRÊS FKs para `profiles` — o titular,
  // `emitido_por` e `revogado_por`. Sem dizer qual, o PostgREST recusa a
  // consulta inteira por ambiguidade (PGRST201), que é o mesmo erro que o
  // Registro de Auditoria pagou com `entregas(lojas(nome))`.
  profiles: { nome: string; loja_id: string | null; lojas: { nome: string } | null } | null
}

// Chamada quando a tela de Nova Corrida monta, e só se houver rede. Se
// falhar, não é erro de tela: o cache anterior continua valendo, e é
// justamente pra isso que ele existe.
//
// A FILIAL DE QUEM ESTÁ NO TERMINAL entra como parâmetro desde o 4B.1:
// ela decide quais cartões de gerente ficam guardados aqui. A regra mora
// em `lib/credencialNoCache.ts`, testável sem banco.
export async function sincronizarCacheDeCredenciais(
  lojaIdDoUsuario: string | null
): Promise<number> {
  const { data, error } = await supabase
    .from('motoboy_credenciais')
    .select(
      'public_id, motoboy_id, profile_id, tem_pin, ' +
        'mototaxistas(nome, agencia_id, agencias(nome)), ' +
        'profiles!motoboy_credenciais_profile_id_fkey(nome, loja_id, lojas(nome))'
    )
    .eq('ativo', true)
    .limit(LIMITE_CADASTRO)

  if (error) throw error

  const agora = new Date().toISOString()
  const linhas = (data as unknown as LinhaCache[])
    .map<CredencialEmCache>((row) => {
      const eMotoboy = row.motoboy_id !== null
      return {
        publicId: row.public_id,
        titular: eMotoboy ? 'motoboy' : 'gerente',
        titularNome: (eMotoboy ? row.mototaxistas?.nome : row.profiles?.nome) ?? '—',
        motoboyId: row.motoboy_id,
        agenciaId: row.mototaxistas?.agencia_id ?? null,
        agenciaNome: row.mototaxistas?.agencias?.nome ?? null,
        profileId: row.profile_id,
        lojaId: row.profiles?.loja_id ?? null,
        lojaNome: row.profiles?.lojas?.nome ?? null,
        temPin: row.tem_pin,
        atualizadoEm: agora,
      }
    })
    .filter((linha) =>
      credencialEntraNoCache(
        { titular: linha.titular, lojaIdDoTitular: linha.lojaId },
        lojaIdDoUsuario
      )
    )

  // Substitui inteiro: cartão revogado tem que SUMIR do cache, senão
  // continuaria identificando alguém offline depois de revogado.
  await db.credenciaisCache.clear()
  await db.credenciaisCache.bulkPut(linhas)
  return linhas.length
}

// O parser do token mora em lib/tokenCartao.ts, sem dependência nenhuma,
// pra poder ser testado fora do app — ele é gêmeo de uma função SQL. Fica
// reexportado aqui porque é daqui que o resto do app sempre o importou
// (`identificarNoCache`, logo abaixo, e a NovaCorrida).
export { publicIdDoToken }

export async function identificarNoCache(token: string): Promise<CredencialEmCache | null> {
  const publicId = publicIdDoToken(token)
  if (!publicId) return null
  return (await db.credenciaisCache.get(publicId)) ?? null
}
