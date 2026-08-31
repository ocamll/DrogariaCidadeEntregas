// Primeira peça de backend do projeto. Existe por um motivo só: criar
// usuário no Supabase Auth exige a `service_role`, que ignora RLS
// inteira e por isso NUNCA pode ir pro navegador. Todo o resto do app
// continua sendo frontend puro falando com o Postgres via RLS — inclusive
// editar/desativar usuário, que é UPDATE comum em `profiles`.
//
// Regra de ouro daqui: nada que vem no corpo do request é confiado.
// tenant_id sai do perfil de QUEM CHAMOU, nunca do body; papel é
// validado contra uma lista fechada; a loja precisa ser do mesmo tenant.
//
// Deploy (você, com a CLI logada — eu não tenho e não devo ter acesso):
//   supabase functions deploy criar-usuario
// A SUPABASE_SERVICE_ROLE_KEY já existe como secret nas Edge Functions
// por padrão; não precisa (e não deve) colar chave em lugar nenhum.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const PAPEIS_PERMITIDOS = ['caixa', 'gerente', 'admin'] as const
const SENHA_MINIMA = 6

// =====================================================================
// GÊMEO DE `src/lib/username.ts` — E5
//
// Esta função roda em Deno, fora do bundle do app, então ela é uma
// CÓPIA. Mesmo arranjo de `calcularOfflineEventHash`, que também tem
// cópia na `sync-romaneio`.
//
// **AS DUAS TÊM QUE PRODUZIR OS MESMOS BYTES.** Divergindo, a conta
// nasce com um endereço e o login tenta outro — e o sintoma é "senha
// inválida", sem diagnóstico nenhum: não há verificador, não há canônico
// impresso, só um usuário jurando que a senha está certa.
//
// `scripts/username.spec.mts` lê OS DOIS ARQUIVOS e compara o corpo
// desta função e o valor do domínio. Não é confiança no copiar-colar: é
// medido. Mexeu num lado, mexe no outro e roda o spec.
// =====================================================================

const DOMINIO_TECNICO = 'drogariacidade.invalid'
const USERNAME_MIN = 3
const USERNAME_MAX = 32

function normalizarUsername(bruto: string): string {
  return bruto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    // As marcas combinantes, escritas com escape e NÃO com os caracteres
    // literais: um range de combinantes no fonte é invisível, colide com
    // a letra anterior no editor, e não sobrevive a um copiar-colar
    // descuidado — num arquivo que tem gêmeo, isso é convite a divergir.
    .replace(/[\u0300-\u036f]/g, '')
}

function validarUsername(bruto: string): string | null {
  const u = normalizarUsername(bruto)
  if (!u) return 'Informe o usuário.'
  if (u.length < USERNAME_MIN) return `Usuário precisa de pelo menos ${USERNAME_MIN} caracteres.`
  if (u.length > USERNAME_MAX) return `Usuário passa de ${USERNAME_MAX} caracteres.`
  if (!/^[a-z]/.test(u)) return 'Usuário precisa começar com uma letra.'
  if (!/^[a-z0-9._-]+$/.test(u)) {
    return 'Usuário aceita só letras, números, ponto, hífen e sublinhado.'
  }
  return null
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function responder(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return responder({ error: 'Método não permitido.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return responder({ error: 'Sem credencial.' }, 401)

  // 1. Quem está chamando? Valida o JWT com a chave anônima — nunca
  //    aceita id/papel/tenant vindos do corpo do request.
  const comoUsuario = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: auth, error: authError } = await comoUsuario.auth.getUser()
  if (authError || !auth.user) return responder({ error: 'Credencial inválida.' }, 401)

  // 2. Esse usuário é admin? Lê o profile dele (a RLS já o restringe ao
  //    próprio tenant) e confere o papel no BANCO, não no que veio.
  const { data: quemChamou, error: perfilError } = await comoUsuario
    .from('profiles')
    .select('tenant_id, papel, ativo')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (perfilError) return responder({ error: perfilError.message }, 500)
  if (!quemChamou || !quemChamou.ativo || quemChamou.papel !== 'admin') {
    return responder({ error: 'Só administrador pode criar usuário.' }, 403)
  }

  // 3. Valida o que veio.
  let corpo: Record<string, unknown>
  try {
    corpo = await req.json()
  } catch {
    return responder({ error: 'Corpo inválido.' }, 400)
  }

  // O ENDEREÇO É COMPOSTO AQUI, NUNCA ACEITO DO CLIENTE — E5.
  //
  // Antes isto era `corpo.email`, validado só com `includes('@')`. Com o
  // login por usuário o endereço deixou de ser um dado que alguém digita
  // e virou uma DERIVAÇÃO do username, então aceitá-lo do corpo do
  // request permitiria criar uma conta cujo endereço o login jamais
  // comporia — uma conta que nasce inacessível.
  //
  // É a mesma regra que já vale para `tenant_id` e `papel` nesta função:
  // nada que vem no corpo decide identidade.
  const username = normalizarUsername(String(corpo.username ?? ''))
  const senha = String(corpo.senha ?? '')
  const nome = String(corpo.nome ?? '').trim()
  const papel = String(corpo.papel ?? '')
  const lojaId = corpo.lojaId ? String(corpo.lojaId) : null

  const erroUsername = validarUsername(username)
  if (erroUsername) return responder({ error: erroUsername }, 400)

  const email = `${username}@${DOMINIO_TECNICO}`
  if (senha.length < SENHA_MINIMA) {
    return responder({ error: `Senha precisa de pelo menos ${SENHA_MINIMA} caracteres.` }, 400)
  }
  if (!nome) return responder({ error: 'Nome é obrigatório.' }, 400)
  if (!PAPEIS_PERMITIDOS.includes(papel as (typeof PAPEIS_PERMITIDOS)[number])) {
    return responder({ error: 'Papel inválido.' }, 400)
  }

  const comoServico = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // A loja tem que ser do mesmo tenant de quem chamou — senão um admin
  // conseguiria criar caixa apontando pra filial de outra farmácia.
  if (lojaId) {
    const { data: loja } = await comoServico
      .from('lojas')
      .select('id')
      .eq('id', lojaId)
      .eq('tenant_id', quemChamou.tenant_id)
      .maybeSingle()
    if (!loja) return responder({ error: 'Loja não pertence a este tenant.' }, 400)
  }

  // 4. Cria no Auth. `email_confirm: true` porque não há fluxo de
  //    confirmação por e-mail no MVP (contas são provisionadas com
  //    e-mail curto e fake, ver CLAUDE.md).
  const { data: criado, error: criarError } = await comoServico.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  })
  if (criarError || !criado.user) {
    return responder({ error: criarError?.message ?? 'Não consegui criar o login.' }, 400)
  }

  // 5. Cria o profile. tenant_id vem de quem chamou, não do body.
  const { error: profileError } = await comoServico.from('profiles').insert({
    id: criado.user.id,
    tenant_id: quemChamou.tenant_id,
    loja_id: lojaId,
    nome,
    papel,
    email,
  })

  if (profileError) {
    // Desfaz o usuário do Auth: sem profile ele não entra em lugar
    // nenhum, mas ocuparia o e-mail e travaria uma nova tentativa.
    // (Não conflita com a regra 4 do CLAUDE.md — ela protege entregas,
    // corridas, pagamentos, assinaturas e eventos, não um login órfão
    // de uma operação que falhou pela metade.)
    await comoServico.auth.admin.deleteUser(criado.user.id)
    return responder({ error: profileError.message }, 400)
  }

  return responder({ id: criado.user.id, email, nome, papel, lojaId })
})
