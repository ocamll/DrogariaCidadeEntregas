// npx tsx scripts/patch-selar-saida-e10.mts
//
// E10 — a QUARTA definição de `selar_romaneio_interno`, obtida por
// PATCH da terceira.
//
// Esta função sela a saída online e também a offline, esta última chamada
// pela Edge Function como `service_role`. Por isso a competência sobre a
// filial precisa vir do perfil de `p_caixa_id`: `auth.uid()` é NULL na
// sincronização e não pode participar da decisão.
//
//     extrai a 3ª  →  patch mínimo  →  diff  →  prova as invariantes
//                                            →  só então vira migration

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const ORIGEM = 'supabase/migrations/20260819160000_papel_no_momento_na_saida.sql'
const SAIDA = 'scripts/.e10-proposta.sql'
const MIGRACAO = 'supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

function umaOcorrencia(fonte: string, alvo: string, nome: string) {
  const ocorrencias = fonte.split(alvo).length - 1
  checa(nome, ocorrencias === 1, `achei ${ocorrencias}`)
  return ocorrencias === 1
}

// ---------------------------------------------------------------------
// E10.1 — extrai somente a definição mais recente
// ---------------------------------------------------------------------
const fonte = readFileSync(ORIGEM, 'utf8')
const inicio = fonte.indexOf('create or replace function public.selar_romaneio_interno')
checa('E10.1 — achou a 3ª definição', inicio >= 0)

const marcadorFim = '\n$$;'
const fim = fonte.indexOf(marcadorFim, inicio)
checa('E10.1 — achou o fim da definição', fim >= 0)

const anterior = inicio >= 0 && fim >= 0
  ? fonte.slice(inicio, fim + marcadorFim.length)
  : ''

// ---------------------------------------------------------------------
// E10.2 — três substituições locais, uma única mudança de autorização
// ---------------------------------------------------------------------
const DECLARACAO_ANTES = `  v_tenant uuid;
  v_papel text;              -- NOVO: o cargo no instante da selagem
  v_existente record;`

const DECLARACAO_DEPOIS = `  v_tenant uuid;
  v_papel text;
  v_loja_do_ator uuid;
  v_existente record;`

const PERFIL_ANTES = `  -- O \`papel\` entra nesta busca que já existia — uma consulta, não duas.
  -- A VALIDAÇÃO dele fica lá embaixo, junto do INSERT da assinatura; ver
  -- o cabeçalho pra por quê.
  select p.tenant_id, p.papel into v_tenant, v_papel from public.profiles p
   where p.id = p_caixa_id and p.ativo;`

const PERFIL_DEPOIS = `  -- O ator é \`p_caixa_id\`, não a sessão. A porta sincronizada é chamada
  -- como service_role e, nela, auth.uid() é NULL.
  select p.tenant_id, p.papel, p.loja_id
    into v_tenant, v_papel, v_loja_do_ator
    from public.profiles p
   where p.id = p_caixa_id and p.ativo;`

const POS_PERFIL_ANTES = `  if v_tenant is null then
    raise exception 'Caixa inexistente ou inativo.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(array_length(p_entrega_ids, 1), 0) = 0 then`

const POS_PERFIL_DEPOIS = `  if v_tenant is null then
    raise exception 'Caixa inexistente ou inativo.' using errcode = 'insufficient_privilege';
  end if;

  -- A filial precisa existir dentro do tenant antes até do caminho de
  -- conflito: esse caminho grava um romaneio e não pode receber a dupla
  -- tenant/loja inconsistente.
  if not exists (
    select 1
      from public.lojas l
     where l.id = p_loja_id
       and l.tenant_id = v_tenant
  ) then
    raise exception 'Filial inválida para este tenant.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Admin opera em qualquer filial do próprio tenant. Caixa e gerente
  -- continuam presos à filial do perfil. Não usar is_admin() nem
  -- current_loja_id(): ambos leem auth.uid() e quebrariam o selo offline.
  if v_papel <> 'admin'
     and p_loja_id is distinct from v_loja_do_ator then
    raise exception 'Sem competência sobre esta filial.'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(array_length(p_entrega_ids, 1), 0) = 0 then`

umaOcorrencia(anterior, DECLARACAO_ANTES,
  'E10.2 — a declaração alvo aparece UMA vez')
umaOcorrencia(anterior, PERFIL_ANTES,
  'E10.2 — a leitura do perfil aparece UMA vez')
umaOcorrencia(anterior, POS_PERFIL_ANTES,
  'E10.2 — o ponto da guarda aparece UMA vez')

const proposta = anterior
  .replace(DECLARACAO_ANTES, DECLARACAO_DEPOIS)
  .replace(PERFIL_ANTES, PERFIL_DEPOIS)
  .replace(POS_PERFIL_ANTES, POS_PERFIL_DEPOIS)

// ---------------------------------------------------------------------
// E10.3 — o diff
// ---------------------------------------------------------------------
const linhasAntes = anterior.split('\n')
const linhasDepois = proposta.split('\n')
const conjuntoAntes = new Set(linhasAntes)
const conjuntoDepois = new Set(linhasDepois)
const removidas = linhasAntes.filter((l) => !conjuntoDepois.has(l))
const acrescentadas = linhasDepois.filter((l) => !conjuntoAntes.has(l))

console.log('\n--- E10.3 — o diff ---')
console.log(`  ${removidas.length} linha(s) removida(s), ${acrescentadas.length} acrescentada(s)`)
for (const linha of removidas) console.log(`  - ${linha.trim()}`)
for (const linha of acrescentadas) console.log(`  + ${linha.trim()}`)

// ---------------------------------------------------------------------
// E10.4 — as invariantes
// ---------------------------------------------------------------------
console.log('\n--- E10.4 — as invariantes ---')

// 1. As quatro expressões de hash não mudam um byte.
const digests = (sql: string) => sql.match(/encode\(digest\([\s\S]*?\), 'hex'\)/g) ?? []
const digestsAntes = digests(anterior)
const digestsDepois = digests(proposta)
checa('há 4 expressões digest()', digestsAntes.length === 4,
  `achei ${digestsAntes.length}`)
checa('e elas continuam byte a byte idênticas',
  digestsAntes.length === digestsDepois.length
    && digestsAntes.every((digest, i) => digest === digestsDepois[i]))

// 2. Documento, conflito, autorização, escrita e auditoria ficam literais.
const entre = (sql: string, de: string, ate: string) => {
  const a = sql.indexOf(de)
  const b = sql.indexOf(ate, a)
  return a >= 0 && b >= 0 ? sql.slice(a, b) : ''
}

const blocosIntactos = [
  ['locks e conflito', '-- ---- trava os vales ANTES', '  -- ---- o hash tem que bater'],
  ['canônico e document hash', '-- ---- o hash tem que bater', '  -- ---- consome a autorização'],
  ['autorização de uso único', '-- ---- consome a autorização', '  -- ---- ORDEM DAQUI PRA BAIXO'],
  ['corrida, vales e romaneio', '-- ---- ORDEM DAQUI PRA BAIXO', '  -- ---- assinaturas'],
  ['assinaturas e final hash', '  -- ---- assinaturas', '  insert into public.eventos'],
  ['evento e retorno', '  insert into public.eventos', 'end;\n$$;'],
] as const

for (const [nome, de, ate] of blocosIntactos) {
  const antes = entre(anterior, de, ate)
  const depois = entre(proposta, de, ate)
  checa(`${nome} intacto`, antes.length > 0 && antes === depois)
}

// O delimitador seguinte ao reenvio é justamente um dos comentários
// alterados pelo patch. Compare o bloco com um limite próprio de cada
// versão, em vez de fazer a ferramenta confundir o novo comentário com
// mudança na lógica anterior.
const reenvioAntes = entre(
  anterior,
  '-- ---- reenvio da fila offline',
  '  -- O `papel` entra nesta busca',
)
const reenvioDepois = entre(
  proposta,
  '-- ---- reenvio da fila offline',
  '  -- O ator é `p_caixa_id`',
)
checa('reenvio idempotente intacto',
  reenvioAntes.length > 0 && reenvioAntes === reenvioDepois)

// 3. A guarda usa o ator explícito e continua compatível com service_role.
checa('a leitura da filial usa o perfil de p_caixa_id',
  proposta.includes('where p.id = p_caixa_id and p.ativo;')
    && proposta.includes('into v_tenant, v_papel, v_loja_do_ator'))
checa('a filial é provada dentro do tenant do ator',
  proposta.includes('l.id = p_loja_id')
    && proposta.includes('l.tenant_id = v_tenant'))
checa('admin é decidido por v_papel',
  proposta.includes("if v_papel <> 'admin'"))
const semComentarios = proposta.replace(/--.*$/gm, '')
checa('nenhuma dependência da sessão entrou',
  !semComentarios.includes('is_admin()')
    && !semComentarios.includes('current_loja_id()')
    && !semComentarios.includes('auth.uid()'))

// 4. A validação acontece antes do primeiro digest/canônico.
const posGuarda = proposta.indexOf("if v_papel <> 'admin'")
const posCanonico = proposta.indexOf('v_canonico := public.romaneio_canonico')
const posDigest = proposta.indexOf('encode(digest(')
checa('a competência é validada antes do canônico',
  posGuarda >= 0 && posGuarda < posCanonico)
checa('e antes de qualquer digest()',
  posGuarda >= 0 && posGuarda < posDigest)

// 5. A assinatura e os atributos da função não mudam.
const cabecalho = (sql: string) => sql.slice(0, sql.indexOf('declare'))
checa('assinatura e atributos da função intactos',
  cabecalho(anterior) === cabecalho(proposta))

// 6. Depois de o arquivo final existir, ele precisa carregar EXATAMENTE
// a proposta já provada. Esta checagem não participou da primeira rodada
// (quando a migration ainda não existia); passa a proteger as seguintes.
if (existsSync(MIGRACAO)) {
  const migration = readFileSync(MIGRACAO, 'utf8')
  const inicioMigration = migration.indexOf(
    'create or replace function public.selar_romaneio_interno',
  )
  const fimMigration = migration.indexOf(marcadorFim, inicioMigration)
  const definicaoMigration = inicioMigration >= 0 && fimMigration >= 0
    ? migration.slice(inicioMigration, fimMigration + marcadorFim.length)
    : ''

  checa('a migration contém exatamente a proposta provada',
    definicaoMigration === proposta)

  const captura = migration.indexOf("set_config('app.e10_verificador_antes'")
  const troca = inicioMigration
  const comparacao = migration.indexOf('if v_antes is distinct from v_depois')
  checa('o gate captura antes, troca e compara depois, nesta ordem',
    captura >= 0 && captura < troca && troca < comparacao)
}

// ---------------------------------------------------------------------
// E10.5 — grava a proposta (NÃO é a migration ainda)
// ---------------------------------------------------------------------
if (falhas === 0) {
  writeFileSync(SAIDA, proposta + '\n', 'utf8')
  console.log(`\nproposta gravada em ${SAIDA} (${linhasDepois.length} linhas)`)
} else {
  console.log('\nproposta NÃO gravada porque uma invariante falhou')
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
