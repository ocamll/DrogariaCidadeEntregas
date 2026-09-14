// npx tsx scripts/patch-receita-no-documento.mts
//
// A RECEITA NO DOCUMENTO ASSINADO — 2026-09-14. Gera a migration
// `20260914120000_receita_no_documento_assinado.sql`.
//
// Decisão do usuário, em duas partes (item 111 do NOTAS): a receita é
// conferida no retorno, DENTRO do documento assinado; e a expectativa dela
// sai da SAÍDA, que passa a afirmá-la numa linha `r`. Cinco funções mudam
// juntas, porque formam um contrato só:
//
//   romaneio_canonico               + bloco `r` no DCR1
//   fn_entrega_imutavel             + tem_receita congela com o documento
//   romaneio_retorno_validar        + 'receita' no domínio do bloco `d`
//   romaneio_documentos_esperados   + a expectativa lida da linha `r`
//   selar_romaneio_retorno_interno  receita FORA do status_documental, e a
//                                   recebida no retorno entra na custódia
//
// Mesmo método das outras `patch-*.mts`: extrair a definição VIGENTE, fazer
// a troca mínima e PROVAR que, tirando os trechos trocados, cada função volta
// byte a byte à original. Duas das cinco são as mais críticas do projeto —
// reescrevê-las à mão é a forma mais provável de mover o que não devia. Não
// edite o SQL gerado: rode este script.
//
// As trocas usam `split/join`, NUNCA `String.replace` com texto: no
// `replace`, o `$$` do SQL vira `$` em silêncio.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { VETORES, VETORES_INVALIDOS } from './dcrr1-vetores.mts'

const RAIZ = new URL('../', import.meta.url)
const PASTA = 'supabase/migrations/'
const SAIDA = PASTA + '20260914120000_receita_no_documento_assinado.sql'

const ler = (p: string) => readFileSync(new URL(p, RAIZ), 'utf8').replace(/\r\n/g, '\n')
const contar = (texto: string, trecho: string) => texto.split(trecho).length - 1
const trocar = (texto: string, de: string, para: string) => texto.split(de).join(para)
const linhas = (...l: string[]) => l.join('\n')

let falhas = 0
function prova(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const MIGRATIONS = readdirSync(new URL(PASTA, RAIZ))
  .filter((f) => f.endsWith('.sql') && PASTA + f !== SAIDA)
  .sort()

/** A definição VIGENTE: a da última migration, em ordem de nome, que a define. */
function vigente(nome: string, esperado: string) {
  const cabecalhos = [`create or replace function public.${nome}(`, `create function public.${nome}(`]
  const onde = MIGRATIONS.filter((f) => cabecalhos.some((c) => ler(PASTA + f).includes(c)))
  prova(`${nome}: a vigente está em ${esperado}`, onde[onde.length - 1] === esperado, onde.join(', '))
  const fonte = ler(PASTA + esperado)
  const cabecalho = cabecalhos.find((c) => fonte.includes(c)) ?? '<<nenhum>>'
  prova(`${nome}: definida uma vez nesse arquivo`, contar(fonte, cabecalho) === 1)
  const i = fonte.indexOf(cabecalho)
  const j = fonte.indexOf('\n$$;', i)
  // `create function` (a vigente do selo nasceu depois de um `drop`) vira
  // `create or replace`: a assinatura é a mesma, então a função é TROCADA em
  // vez de ganhar sobrecarga — e o gate da migration prova que não ganhou.
  const original = trocar(
    fonte.slice(i, j + '\n$$;'.length),
    `create function public.${nome}(`,
    `create or replace function public.${nome}(`
  )
  return { fonte, original }
}

function aplicar(nome: string, original: string, trocas: Array<[string, string]>) {
  let proposta = original
  for (const [k, [de, para]] of trocas.entries()) {
    prova(`${nome}: o trecho ${k + 1} aparece uma vez na vigente`, contar(original, de) === 1)
    proposta = trocar(proposta, de, para)
  }
  let semAntes = original
  let semDepois = proposta
  for (const [k, [de, para]] of trocas.entries()) {
    prova(`${nome}: o trecho novo ${k + 1} aparece uma vez na proposta`, contar(proposta, para) === 1)
    semAntes = trocar(semAntes, de, `<<troca ${k + 1}>>`)
    semDepois = trocar(semDepois, para, `<<troca ${k + 1}>>`)
  }
  prova(`${nome}: tirando os trechos trocados, volta byte a byte à vigente`, semAntes === semDepois)
  const cabecalho = (t: string) => t.slice(0, t.indexOf('as $$') + 'as $$'.length)
  prova(`${nome}: assinatura, language e security idênticos`, cabecalho(proposta) === cabecalho(original))
  return proposta
}

function grants(nome: string, fonte: string, texto: string) {
  prova(`${nome}: os grants originais estão na migration de origem, e são reproduzidos iguais`, fonte.includes(texto))
  return texto
}

// ------------------------------------------------ (1) o canônico da saída
const canonico = vigente('romaneio_canonico', '20260816140000_romaneio_de_saida.sql')
prova('canônico: `tem_receita` não aparecia', !canonico.original.includes('tem_receita'))
const RETURN_CANONICO = "  return array_to_string(v_linhas, e'\\n');"
const canonicoNovo = aplicar('canônico', canonico.original, [
  [
    RETURN_CANONICO,
    linhas(
      '  -- O bloco `r` — a receita que tem que VOLTAR —, depois de TODOS os',
      '  -- pagamentos. 2026-09-14. Uma linha por vale com `tem_receita`, nenhuma',
      '  -- sem: bloco vazio é ausência de linha, então toda saída sem receita',
      '  -- continua produzindo os mesmos bytes. Gêmeo do laço de `canonico.ts`.',
      '  --',
      '  -- Só a PRESENÇA: nada de medicamento nem de tipo de receita (regra 9).',
      '  for v_registro in',
      '    select e.id',
      '      from public.entregas e',
      '     where e.id = any(p_entrega_ids)',
      '       and e.tem_receita',
      '     order by e.id::text collate "C"',
      '  loop',
      "    v_linhas := v_linhas || ('r' || e'\\t' || v_registro.id::text);",
      '  end loop;',
      '',
      RETURN_CANONICO
    ),
  ],
])
prova('canônico: o laço `r` vem depois do laço `p`',
  canonicoNovo.indexOf("('r' || e'\\t'") > canonicoNovo.indexOf("'p' || e'\\t'"))
const REVOKE_CANONICO = grants('canônico', canonico.fonte,
  'revoke all on function public.romaneio_canonico(uuid, uuid, uuid, uuid, uuid, uuid[])\n  from public, anon, authenticated;')

// ------------------------------------------ (2) a trava de imutabilidade
const imutavel = vigente('fn_entrega_imutavel', '20260816140000_romaneio_de_saida.sql')
const coluna = (c: string) => `  or new.${c.padEnd(28)}is distinct from old.${c}\n`
prova('trava: `tem_receita` não era congelada', !imutavel.original.includes('tem_receita'))
const imutavelNovo = aplicar('trava', imutavel.original, [
  [
    coluna('corrida_id'),
    coluna('corrida_id') +
      '  -- 2026-09-14: a receita entrou no documento assinado (linha `r` do DCR1).\n' +
      coluna('tem_receita'),
  ],
])

// -------------------------------------------- (3) o validador do retorno
const validar = vigente('romaneio_retorno_validar', '20260910120000_outro_sai_das_formas_de_pagamento.sql')
const validarNovo = aplicar('validador', validar.original, [
  [
    linhas(
      '  -- E ESTA NÃO É AQUELA. Só convênio e crediário geram papel físico;',
      '  -- `convcard` está de fora de propósito.',
      "  v_tipos_ok    text[] := array['convenio', 'crediario'];"
    ),
    linhas(
      '  -- E ESTA NÃO É AQUELA. Só convênio e crediário geram papel físico;',
      '  -- `convcard` está de fora de propósito.',
      '  --',
      '  -- `receita` entrou em 2026-09-14: é conferida no retorno, dentro do',
      '  -- documento assinado, e a expectativa dela vem da linha `r` da saída.',
      "  v_tipos_ok    text[] := array['convenio', 'crediario', 'receita'];"
    ),
  ],
])
const recusas = (t: string) => (t.match(/return '/g) ?? []).length
prova('validador: os mesmos motivos de recusa',
  recusas(validar.original) === recusas(validarNovo), `${recusas(validar.original)} → ${recusas(validarNovo)}`)
const GRANTS_VALIDAR = grants('validador', validar.fonte,
  'revoke all on function public.romaneio_retorno_validar(text, jsonb) from public, anon;\n' +
    'grant execute on function public.romaneio_retorno_validar(text, jsonb) to authenticated;')

// ------------------------------------------------------ (4) a expectativa
const esperados = vigente('romaneio_documentos_esperados', '20260820160000_retorno_documentos_esperados.sql')
const esperadosNovo = aplicar('expectativa', esperados.original, [
  [
    linhas(
      '  select distinct',
      "         (split_part(linha, e'\\t', 2))::uuid as entrega_id,",
      "         split_part(linha, e'\\t', 4)          as tipo_documento"
    ),
    linhas(
      '  select distinct',
      "         (split_part(linha, e'\\t', 2))::uuid as entrega_id,",
      '         -- 2026-09-14: a linha `r` da saída espera a RECEITA de volta.',
      "         case split_part(linha, e'\\t', 1)",
      "           when 'r' then 'receita'",
      "           else split_part(linha, e'\\t', 4)",
      '         end                                  as tipo_documento'
    ),
  ],
  [
    linhas(
      '     -- linha `p` da saída: p <entrega_id> <pagamento_id> <forma> <valor> <troco>',
      "     and split_part(linha, e'\\t', 1) = 'p'",
      '     -- SÓ estas duas formas geram papel. `convcard` fica de fora.',
      "     and split_part(linha, e'\\t', 4) in ('convenio', 'crediario');"
    ),
    linhas(
      '     and (',
      '       -- linha `p` da saída: p <entrega_id> <pagamento_id> <forma> <valor> <troco>',
      "       (split_part(linha, e'\\t', 1) = 'p'",
      '        -- SÓ estas duas formas geram papel. `convcard` fica de fora.',
      "        and split_part(linha, e'\\t', 4) in ('convenio', 'crediario'))",
      '       -- linha `r` da saída: r <entrega_id> — a receita que tem que voltar',
      "       or split_part(linha, e'\\t', 1) = 'r'",
      '     );'
    ),
  ],
])
prova('expectativa: continua lendo SÓ o canônico assinado',
  !/public\.(entregas|pagamentos|convenios)/.test(esperadosNovo))
const REVOKE_ESPERADOS = grants('expectativa', esperados.fonte,
  'revoke all on function public.romaneio_documentos_esperados(uuid)\n  from public, anon, authenticated;')

// ---------------------------------------------------- (5) o selo do retorno
const selo = vigente('selar_romaneio_retorno_interno', '20260912120000_selo_do_retorno_versao_2.sql')
prova('selo: `receita_recebida` não aparecia', !selo.original.includes('receita_recebida'))
const RECEITA_RECEBIDA_AQUI = linhas(
  '                  and exists (select 1',
  "                                from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value)",
  "                               where doc.value ->> 'tipo' = 'receita'",
  "                                 and doc.value ->> 'situacao' = 'recebido')"
)
const seloNovo = aplicar('selo', selo.original, [
  [
    linhas(
      "    select count(*), count(*) filter (where doc.value ->> 'situacao' = 'recebido')",
      '      into v_esperados_do_vale, v_recebidos_do_vale',
      "      from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value);"
    ),
    linhas(
      '    --',
      '    -- 2026-09-14: a RECEITA fica FORA desta conta. É documento distinto do',
      '    -- convênio e do crediário, com custódia própria (`receita_recebida_*`,',
      '    -- logo abaixo): recebê-la não quita o papel do convênio, e a falta',
      '    -- dela não o deixa pendente.',
      "    select count(*), count(*) filter (where doc.value ->> 'situacao' = 'recebido')",
      '      into v_esperados_do_vale, v_recebidos_do_vale',
      "      from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value)",
      "     where doc.value ->> 'tipo' <> 'receita';"
    ),
  ],
  [
    linhas(
      '           status_documental = case',
      "             when v_esperados_do_vale = 0                       then 'nao_aplica'",
      "             when v_recebidos_do_vale = v_esperados_do_vale     then 'recebido'",
      "             else 'pendente'",
      '           end',
      '     where id = v_entrega_id;'
    ),
    linhas(
      '           status_documental = case',
      "             when v_esperados_do_vale = 0                       then 'nao_aplica'",
      "             when v_recebidos_do_vale = v_esperados_do_vale     then 'recebido'",
      "             else 'pendente'",
      '           end,',
      '           -- 2026-09-14: a receita declarada RECEBIDA neste retorno entra na',
      '           -- custódia dela, e só se ninguém a recebeu antes — o primeiro',
      '           -- recebedor não é sobrescrito. O relógio do servidor',
      '           -- (`receita_recebida_em`) é carimbado por `trg_entregas_custodia`',
      '           -- a partir do `_local`. `faltante` não escreve nada: a pendência',
      '           -- continua, e o `documento_faltante` logo abaixo a anuncia.',
      '           receita_recebida_em_local = case',
      '             when receita_recebida_em is null and receita_recebida_em_local is null',
      RECEITA_RECEBIDA_AQUI,
      '             then p_ocorrido_em_local',
      '             else receita_recebida_em_local',
      '           end,',
      '           receita_recebida_por = case',
      '             when receita_recebida_em is null and receita_recebida_em_local is null',
      RECEITA_RECEBIDA_AQUI,
      '             then p_responsavel_id',
      '             else receita_recebida_por',
      '           end',
      '     where id = v_entrega_id;'
    ),
  ],
])
const quantas = (t: string, re: RegExp) => (t.match(re) ?? []).length
for (const [rotulo, re] of [
  ['expressões digest()', /digest\(/g],
  ['chamadas ao canônico do retorno', /romaneio_retorno_canonico/g],
  ['inserts em eventos', /insert into public\.eventos/g],
  ['on conflict', /on conflict/gi],
  ['inserts em pagamentos', /insert into public\.pagamentos/g],
] as Array<[string, RegExp]>) {
  prova(`selo: o mesmo número de ${rotulo}`,
    quantas(selo.original, re) === quantas(seloNovo, re), `${quantas(selo.original, re)} → ${quantas(seloNovo, re)}`)
}
const REVOKE_SELO = grants('selo', selo.fonte, linhas(
  'revoke all on function public.selar_romaneio_retorno_interno(',
  '  uuid, uuid, uuid, text, uuid, jsonb, text, uuid, timestamptz, text, inet, jsonb',
  ') from public, anon, authenticated;'
))

if (falhas > 0) {
  console.log(`\n${falhas} FALHA(S) — a migration NÃO foi escrita`)
  process.exit(1)
}

// ------------------------------------------------------------- migration
const conferencias = VETORES.length * 3 + VETORES_INVALIDOS.length

const FOTO = `  select coalesce(jsonb_agg(to_jsonb(v) order by v.tipo, v.numero, v.romaneio_id), '[]'::jsonb)
    into v_placar
    from public.verificar_romaneios_selados() v;

  select coalesce(jsonb_agg(jsonb_build_array(r.id, d.entrega_id, d.tipo_documento)
                            order by r.id, d.entrega_id, d.tipo_documento), '[]'::jsonb)
    into v_esperados
    from public.romaneios r
    cross join lateral public.romaneio_documentos_esperados(r.id) d
   where r.tipo = 'saida' and r.status = 'selado';`

const migracao = `-- =====================================================================
-- A RECEITA NO DOCUMENTO ASSINADO — 2026-09-14
--
-- Decisão do usuário (item 111 do NOTAS), em duas partes:
--
--   1. a receita é conferida no RETORNO, dentro do documento assinado —
--      confirmada com cartão e PIN, como convênio e crediário;
--   2. a expectativa dela sai da SAÍDA, que passa a afirmá-la numa linha
--      \`r\`. Até aqui \`tem_receita\` não estava em documento nenhum e mudava
--      depois da saída — e a expectativa do retorno só lê documento assinado.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA
-- ---------------------------------------------------------------------
--   romaneio_canonico               DCR1 ganha o bloco \`r\`, depois dos \`p\`:
--                                   uma linha \`r <entrega_id>\` por vale com
--                                   receita, nenhuma sem
--   fn_entrega_imutavel             \`tem_receita\` congela com o documento
--                                   (regra 7: tudo que entrou nele)
--   romaneio_retorno_validar        'receita' entra no domínio do bloco \`d\`
--   romaneio_documentos_esperados   a linha \`r\` espera d/receita — a MESMA
--                                   função serve o selo e o contexto da tela
--   selar_romaneio_retorno_interno  a receita fica FORA do
--                                   \`status_documental\` (recebê-la não quita
--                                   o convênio), e a declarada recebida
--                                   entra em \`receita_recebida_*\`, sem
--                                   sobrescrever quem recebeu antes
--
-- Assinaturas idênticas: ninguém que chama estas funções é reaberto.
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA, e por que é seguro
-- ---------------------------------------------------------------------
--   * NENHUM DOCUMENTO GRAVADO. O verificador confere \`digest(canonico)\`
--     sobre os bytes armazenados, e nenhum canônico existente tem linha \`r\`
--     — logo nenhuma saída selada passa a esperar receita. Os dois gates no
--     fim desta transação provam as duas coisas antes do commit.
--   * NENHUMA SAÍDA SEM RECEITA muda um byte: bloco vazio é ausência de
--     linha (vetor S001 de \`scripts/dcr1-vetores.mts\`, conferido contra a
--     implementação anterior).
--   * NENHUM RETORNO SEM RECEITA muda um byte: o bloco \`d\` só ganha um
--     valor de domínio.
--
-- ---------------------------------------------------------------------
-- ANTES DE APLICAR — a transição
-- ---------------------------------------------------------------------
--   * nenhuma SAÍDA OFFLINE pendente nas filas dos navegadores. Uma saída
--     com vale de receita assinada pelo código antigo chegaria sem a linha
--     \`r\` e seria recusada na sincronização;
--   * recarregar as abas com o código novo. Online, a Nova Corrida compara
--     o canônico local com o do servidor ANTES do cartão e do PIN — com
--     código antigo ela recusa ali, de forma legível;
--   * retorno pendente de uma saída ANTERIOR a esta migration não é
--     afetado: aquela saída não tem linha \`r\` e não espera receita.
--
-- Gerada por scripts/patch-receita-no-documento.mts, que extrai as
-- definições vigentes e PROVA que, tirando os trechos trocados, cada uma
-- volta byte a byte à original. Não edite à mão: rode o script.
-- =====================================================================

begin;

-- O BASELINE: o placar do verificador e a expectativa de TODA saída selada.
do $$
declare
  v_placar    jsonb;
  v_esperados jsonb;
begin
${FOTO}

  perform set_config('app.receita_placar_antes', v_placar::text, true);
  perform set_config('app.receita_esperados_antes', v_esperados::text, true);
  raise notice 'Antes: % documento(s) no placar, % documento(s) esperado(s).',
    jsonb_array_length(v_placar), jsonb_array_length(v_esperados);
end $$;


-- (1) O CANÔNICO DA SAÍDA — gerado pelo script -------------------------
${canonicoNovo}

${REVOKE_CANONICO}


-- (2) A TRAVA DE IMUTABILIDADE — gerada pelo script ---------------------
${imutavelNovo}


-- (3) O VALIDADOR DO RETORNO — gerado pelo script -----------------------
${validarNovo}

${GRANTS_VALIDAR}


-- (4) A EXPECTATIVA — gerada pelo script ---------------------------------
${esperadosNovo}

${REVOKE_ESPERADOS}


-- (5) O SELO DO RETORNO — gerado pelo script -----------------------------
${seloNovo}

${REVOKE_SELO}


-- OS GATES: nenhuma sobrecarga nasceu, e nada existente se moveu.
do $$
declare
  v_placar_antes    jsonb := nullif(current_setting('app.receita_placar_antes', true), '')::jsonb;
  v_esperados_antes jsonb := nullif(current_setting('app.receita_esperados_antes', true), '')::jsonb;
  v_placar          jsonb;
  v_esperados       jsonb;
  v_funcoes         int;
begin
  if v_placar_antes is null or v_esperados_antes is null then
    raise exception 'Baseline não encontrado — o bloco do começo não rodou nesta transação.';
  end if;

  select count(*) into v_funcoes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('romaneio_canonico', 'fn_entrega_imutavel', 'romaneio_retorno_validar',
                       'romaneio_documentos_esperados', 'selar_romaneio_retorno_interno');
  if v_funcoes <> 5 then
    raise exception 'Esperava 5 funções, uma de cada; achei %. Alguma virou sobrecarga — transação desfeita.',
      v_funcoes;
  end if;

${FOTO}

  if v_placar is distinct from v_placar_antes then
    raise exception 'O placar do verificador MOVEU — transação desfeita. antes: %  depois: %',
      v_placar_antes, v_placar;
  end if;

  if v_esperados is distinct from v_esperados_antes then
    raise exception 'A expectativa de documentos de uma saída selada MUDOU — transação desfeita. antes: %  depois: %',
      v_esperados_antes, v_esperados;
  end if;

  raise notice 'Gates ok: % documento(s) no placar, % documento(s) esperado(s), nada movido.',
    jsonb_array_length(v_placar), jsonb_array_length(v_esperados);
end $$;

commit;


-- =====================================================================
-- CONFERÊNCIAS — no SQL Editor, depois de aplicar
--
-- (a) as cinco funções, uma de cada
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('romaneio_canonico', 'fn_entrega_imutavel', 'romaneio_retorno_validar',
--                        'romaneio_documentos_esperados', 'selar_romaneio_retorno_interno')
--    order by p.proname;
--   -- esperado: 5 linhas
--
-- (b) nenhuma saída já selada passou a esperar receita
--
--   select r.numero, d.entrega_id
--     from public.romaneios r
--     cross join lateral public.romaneio_documentos_esperados(r.id) d
--    where r.tipo = 'saida' and r.status = 'selado' and d.tipo_documento = 'receita';
--   -- esperado: zero linhas
--
-- (c) a trava recusa mudar a receita de um vale já selado. O bloco termina
--     SEMPRE em erro, de propósito, para desfazer o que tentou:
--
--   do $$
--   declare
--     v_id        uuid;
--     v_resultado text;
--   begin
--     select re.entrega_id into v_id
--       from public.romaneio_entregas re
--       join public.romaneios r on r.id = re.romaneio_id
--      where r.status = 'selado' and r.tipo = 'saida'
--      limit 1;
--     begin
--       update public.entregas set tem_receita = not tem_receita where id = v_id;
--       v_resultado := 'ACEITOU — a trava NÃO congela tem_receita';
--     exception when check_violation then
--       v_resultado := 'recusou, como esperado';
--     end;
--     raise exception 'RESULTADO — %', v_resultado;
--   end $$;
--   -- esperado: ERROR: RESULTADO — recusou, como esperado
--
-- (d) o validador contra os golden vectors do DCRR1, que agora trazem a
--     receita (V017 e V018):
--
--       npx tsx scripts/dcrr1-sql.spec.mts > conferir.sql
--
--     e colar no SQL Editor. Esperado: ${conferencias} de ${conferencias}, e nenhuma linha
--     com \`ok = false\`.
--
-- (e) o canônico da saída, TS × SQL, em dado real: marcar "Precisa de
--     receita" num vale pendente e rodar
--     \`scripts/conferir-canonico-no-console.js\` no console do app. Esperado:
--     "OK — os dois lados concordam", com uma linha \`r\` no fim.
--
-- (f) o placar, o mesmo de antes de aplicar:
--
--   select * from public.verificar_integridade_resumo();
-- =====================================================================
`

writeFileSync(new URL(SAIDA, RAIZ), migracao)
const escrita = ler(SAIDA)
for (const [rotulo, trecho] of [
  ['canônico', canonicoNovo],
  ['trava', imutavelNovo],
  ['validador', validarNovo],
  ['expectativa', esperadosNovo],
  ['selo', seloNovo],
] as Array<[string, string]>) {
  prova(`a migration contém a proposta provada do ${rotulo}, uma vez`, contar(escrita, trecho) === 1)
}

console.log(
  falhas > 0
    ? `\n${falhas} FALHA(S)`
    : `\nmigration escrita: ${SAIDA}  (${conferencias} conferências DCRR1 esperadas)`
)
if (falhas > 0) process.exit(1)
