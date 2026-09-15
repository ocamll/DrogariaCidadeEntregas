// npx tsx scripts/patch-relato-do-retorno.mts
//
// O RELATO NO SELO DO RETORNO — 2026-09-15. Gera a migration
// `20260915130000_relato_no_selo_do_retorno.sql`.
//
// Decisão do usuário (NOTAS 111): quando um item do retorno diverge —
// pagamento diferente do previsto, ou documento faltante —, quem confirma
// escreve o que aconteceu ou marca "precisa apurar". O relato fica FORA
// do DCRR1 (parâmetro próprio `p_relatos`) e mora em `retorno_relatos`
// (migration `20260915120000`).
//
// QUATRO funções mudam, e as quatro GANHAM UM PARÂMETRO — por isso, ao
// contrário do patch da receita (que só trocava corpo), aqui cada uma
// precisa de `drop function` explícito antes do `create`: acrescentar um
// tipo à lista de argumentos cria uma SOBRECARGA nova em vez de substituir
// a função (Postgres identifica função por nome + tipos dos parâmetros).
// `create or replace` deixaria as duas versões coexistindo, e a antiga
// continuaria aceitando chamadas de um bundle não atualizado.
//
//   registrar_conflito_retorno        + p_relatos no fim; guarda em
//                                     'relatos_declarados' — SEM validar,
//                                     porque num conflito não se sabe se
//                                     a diferença existe
//   selar_romaneio_retorno_interno    + p_relatos antes de p_geolocalizacao
//                                     (nenhum default no meio); valida
//                                     contra o que o PRÓPRIO retorno
//                                     apurou (pagamento divergente,
//                                     documento faltante) e grava
//   selar_romaneio_retorno            + p_relatos ANTES de
//                                     p_geolocalizacao (que tem default —
//                                     Postgres exige que todo parâmetro
//                                     depois de um com default também
//                                     tenha), repassa pra _interno
//   selar_romaneio_retorno_sincronizado + p_relatos ANTES de p_validacao
//                                     (que tem default), repassa pros seis
//                                     `registrar_conflito_retorno` e pra
//                                     _interno
//
// Mesmo método das outras `patch-*.mts`: extrair a definição VIGENTE de
// cada função (não da migration onde ela nasceu — da ÚLTIMA que a
// redefiniu; `selar_romaneio_retorno_interno` foi redefinida ontem pela
// receita), fazer a troca mínima e PROVAR que, tirando os trechos
// trocados, cada uma volta byte a byte à vigente.
//
// `split/join`, nunca `String.replace` com texto: no `replace`, `$$` do
// SQL vira `$` em silêncio.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'

const RAIZ = new URL('../', import.meta.url)
const PASTA = 'supabase/migrations/'
const SAIDA = PASTA + '20260915130000_relato_no_selo_do_retorno.sql'

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
  // Normalizado para `create or replace` só pra comparação/edição — o que
  // de fato vai na migration usa `create function`, depois do `drop`.
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
  return proposta
}

/** A mesma troca aplicada em TODAS as N ocorrências de uma vez — usado só
 *  onde o próprio texto se repete de propósito (as sete recusas do
 *  interno que terminam igual). */
function aplicarTodas(nome: string, original: string, de: string, para: string, esperadas: number) {
  const achadas = contar(original, de)
  prova(`${nome}: o trecho repetido aparece ${esperadas} vez(es)`, achadas === esperadas, `achei ${achadas}`)
  return trocar(original, de, para)
}

/** `create or replace function public.NOME(...)` → o par
 *  `drop function public.NOME(<tipos antigos>);` + `create function ...`
 *  que a migration de fato usa, pra sobrecarga não nascer. */
function paraDropECreate(nome: string, proposta: string, tiposAntigos: string): string {
  const criacao = trocar(
    proposta,
    `create or replace function public.${nome}(`,
    `create function public.${nome}(`
  )
  return `drop function public.${nome}(\n  ${tiposAntigos}\n);\n\n${criacao}`
}

/** Confere que os grants ANTIGOS estão na migration de origem e devolve os
 *  mesmos grants com a lista de tipos NOVA. Reproduzi-los com os tipos
 *  antigos foi o erro da primeira versão desta migration: depois do `drop`,
 *  a assinatura antiga não existe mais, e o `revoke` levanta 42883. */
function grants(nome: string, fonte: string, texto: string, tiposAntigos: string, tiposNovos: string) {
  prova(`${nome}: os grants originais estão na migration de origem`, fonte.includes(texto))
  prova(`${nome}: a lista nova tem um tipo a mais que a antiga`,
    tiposNovos.split(',').length === tiposAntigos.split(',').length + 1)
  const ocorrencias = contar(texto, tiposAntigos)
  prova(`${nome}: os tipos antigos aparecem em cada grant`, ocorrencias >= 1, `achei ${ocorrencias}`)
  return texto.split(tiposAntigos).join(tiposNovos)
}

// ------------------------------------------------ (1) registrar_conflito_retorno
const conflito = vigente('registrar_conflito_retorno', '20260912120000_selo_do_retorno_versao_2.sql')
const TIPOS_CONFLITO = 'uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, inet, jsonb, jsonb, jsonb, jsonb'
prova('conflito: a assinatura tem os 13 tipos esperados',
  conflito.original.includes('p_retorno jsonb, p_validacao jsonb\n)'))
const conflitoNovo = aplicar('conflito', conflito.original, [
  ['p_retorno jsonb, p_validacao jsonb\n)', 'p_retorno jsonb, p_validacao jsonb, p_relatos jsonb\n)'],
  [
    "jsonb_build_object('retorno_declarado', p_retorno),",
    linhas(
      '     -- 2026-09-15: o que foi DECLARADO como relato, no mesmo espírito',
      "     -- do 'retorno_declarado' — um conflito não sabe se a diferença de",
      '     -- verdade existe (pode não ter chegado nem a comparar), então não',
      '     -- valida contra nada; só preserva o que a tela mandou.',
      "     jsonb_build_object('retorno_declarado', p_retorno, 'relatos_declarados', p_relatos),"
    ),
  ],
])
const GRANTS_CONFLITO = grants('conflito', conflito.fonte, linhas(
  `revoke all on function public.registrar_conflito_retorno(`,
  `  ${TIPOS_CONFLITO}`,
  `) from public, anon, authenticated;`
), TIPOS_CONFLITO, `${TIPOS_CONFLITO}, jsonb`)

// -------------------------------------------- (2) selar_romaneio_retorno_interno
// A VIGENTE é a de ONTEM (receita), não a do 4B — a receita reescreveu o
// corpo inteiro desta função.
const interno = vigente('selar_romaneio_retorno_interno', '20260914120000_receita_no_documento_assinado.sql')
const TIPOS_INTERNO = 'uuid, uuid, uuid, text, uuid, jsonb, text, uuid, timestamptz, text, inet, jsonb'
const internoNovo1 = aplicar('interno', interno.original, [
  // (a) assinatura — sem default no meio, então appendar é seguro.
  [
    '  p_geolocalizacao jsonb\n)',
    '  p_geolocalizacao jsonb,\n  p_relatos jsonb\n)',
  ],
  // (b) declare — os quatro locais que a validação de relato usa.
  [
    linhas(
      '  v_esperados_do_vale int;',
      '  v_recebidos_do_vale int;',
      'begin'
    ),
    linhas(
      '  v_esperados_do_vale int;',
      '  v_recebidos_do_vale int;',
      "  -- 2026-09-15: RELATOS — 'o que aconteceu?', fora do canônico. Os",
      '  -- dois arrays abaixo são o que este retorno de fato apurou; um',
      '  -- relato só é aceito se apontar pra algo que está num dos dois.',
      "  v_pagamento_divergente uuid[] := '{}';",
      "  v_documento_faltante   text[] := '{}';",
      '  v_relato               jsonb;',
      '  v_relato_natureza      text;',
      'begin'
    ),
  ],
  // (c) as SETE recusas que terminam igual — troca única, aplicada nas
  //     sete de uma vez (ver aplicarTodas, fora deste array).
  // (d) acumula pagamento divergente, dentro do `if v_divergiu` já
  //     existente.
  [
    linhas(
      '      if v_divergiu then',
      '        update public.entregas',
      "           set status_financeiro = 'divergente'"
    ),
    linhas(
      '      if v_divergiu then',
      '        -- 2026-09-15: para o relato de pagamento exigir diferença de',
      "        -- verdade — a mesma condição que já dispara `pagamento_alterado`.",
      '        v_pagamento_divergente := v_pagamento_divergente || v_entrega_id;',
      '',
      '        update public.entregas',
      "           set status_financeiro = 'divergente'"
    ),
  ],
  // (e) acumula documento faltante, logo depois do evento que já lê a
  //     mesma condição.
  [
    linhas(
      "     where doc.value ->> 'situacao' = 'faltante';",
      '',
      '    for v_pag in'
    ),
    linhas(
      "     where doc.value ->> 'situacao' = 'faltante';",
      '',
      '    -- 2026-09-15: mesmo critério do evento acima, pra validar relato de',
      '    -- documento depois do laço.',
      '    v_documento_faltante := v_documento_faltante || array(',
      "      select lower(v_entrega_id::text) || '|' || (doc.value ->> 'tipo')",
      "        from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value)",
      "       where doc.value ->> 'situacao' = 'faltante'",
      '    );',
      '',
      '    for v_pag in'
    ),
  ],
  // (f) depois do laço de vales: valida e grava os relatos.
  [
    linhas(
      '  end loop;',
      '',
      '  -- =====================================================================',
      "  -- CADA LINHA `pr` ASSINADA = UMA LINHA DE PAGAMENTO PERSISTIDA"
    ),
    linhas(
      '  end loop;',
      '',
      '  -- =====================================================================',
      "  -- RELATOS — 'o que aconteceu?', 2026-09-15. Cada um só é aceito se",
      '  -- referenciar uma diferença de verdade: pagamento que divergiu do',
      '  -- previsto, ou documento que ESTE MESMO retorno declarou faltante.',
      '  -- Fica fora do DCRR1 de propósito — por isso valida e grava aqui, e',
      "  -- não em `romaneio_retorno_validar`, que só conhece os bytes assinados.",
      '  --',
      '  -- Item sem diferença correspondente recusa O SELO INTEIRO, com uma',
      '  -- exceção comum: é bug de tela, não fato físico a preservar — mesma',
      "  -- categoria de `vales_nao_conferem`, não de `registrar_conflito_retorno`.",
      '  -- =====================================================================',
      '  for v_relato in select r.value from jsonb_array_elements(coalesce(p_relatos, \'[]\'::jsonb)) as r(value)',
      '  loop',
      "    v_relato_natureza := v_relato ->> 'natureza';",
      "    if v_relato_natureza = 'pagamento' then",
      "      if not (((v_relato ->> 'entrega_id')::uuid) = any(v_pagamento_divergente)) then",
      "        raise exception 'Relato de pagamento para um vale sem divergência.'",
      "          using errcode = 'check_violation';",
      '      end if;',
      "    elsif v_relato_natureza = 'documento' then",
      "      if not ((lower(v_relato ->> 'entrega_id') || '|' || (v_relato ->> 'tipo_documento'))",
      '              = any(v_documento_faltante)) then',
      "        raise exception 'Relato de documento para um item sem pendência.'",
      "          using errcode = 'check_violation';",
      '      end if;',
      '    else',
      "      raise exception 'Natureza de relato desconhecida: %.', v_relato_natureza",
      "        using errcode = 'check_violation';",
      '    end if;',
      '  end loop;',
      '',
      '  -- Só depois de TODOS validados. `on conflict (id)` é o mesmo padrão de',
      '  -- idempotência da regra 5: reenvio da fila não duplica.',
      '  insert into public.retorno_relatos',
      '    (id, tenant_id, loja_id, romaneio_retorno_id, entrega_id, natureza,',
      '     tipo_documento, situacao, relato, autor_id, ocorrido_em_local)',
      '  select',
      "    (r.value ->> 'id')::uuid, v_tenant, v_saida.loja_id, p_romaneio_id,",
      "    (r.value ->> 'entrega_id')::uuid, r.value ->> 'natureza',",
      "    r.value ->> 'tipo_documento', r.value ->> 'situacao', r.value ->> 'relato',",
      '    p_responsavel_id, p_ocorrido_em_local',
      "    from jsonb_array_elements(coalesce(p_relatos, '[]'::jsonb)) as r(value)",
      '  on conflict (id) do nothing;',
      '',
      '  -- =====================================================================',
      "  -- CADA LINHA `pr` ASSINADA = UMA LINHA DE PAGAMENTO PERSISTIDA"
    ),
  ],
])
// (c) — a troca que se repete de propósito, nas OITO recusas iguais:
// saida_hash_nao_confere, corrida_ja_fechada, retorno_ja_existe,
// outro_motoboy, retorno_invalido, vales_nao_conferem,
// documentos_nao_conferem e documento_alterado.
const internoNovo = aplicarTodas('interno', internoNovo1, 'p_retorno, v_validacao);', 'p_retorno, v_validacao, p_relatos);', 8)
prova('interno: a nona recusa (gerente_sem_competencia) também repassa p_relatos',
  contar(internoNovo, "'resultado', 'autenticada_sem_competencia'));") === 1)
const internoNovoFinal = trocar(
  internoNovo,
  "'resultado', 'autenticada_sem_competencia'));",
  "'resultado', 'autenticada_sem_competencia'), p_relatos);"
)
prova('interno: as nove chamadas a registrar_conflito_retorno repassam p_relatos',
  contar(internoNovoFinal, ', p_relatos);') === 9)
const GRANTS_INTERNO = grants('interno', interno.fonte, linhas(
  'revoke all on function public.selar_romaneio_retorno_interno(',
  `  ${TIPOS_INTERNO}`,
  ') from public, anon, authenticated;'
), TIPOS_INTERNO, `${TIPOS_INTERNO}, jsonb`)

// -------------------------------------------------- (3) selar_romaneio_retorno
const online = vigente('selar_romaneio_retorno', '20260912120000_selo_do_retorno_versao_2.sql')
const TIPOS_ONLINE = 'uuid, uuid, text, uuid, jsonb, text, uuid, timestamptz, jsonb'
const onlineNovo = aplicar('online', online.original, [
  [
    '  p_ocorrido_em_local timestamptz, p_geolocalizacao jsonb default null',
    linhas(
      '  p_ocorrido_em_local timestamptz,',
      '  -- ANTES de p_geolocalizacao: ela tem default, e todo parâmetro depois',
      '  -- de um com default também precisa ter — p_relatos não tem, de',
      '  -- propósito, pra um bundle antigo falhar alto em vez de omitir.',
      '  p_relatos jsonb,',
      '  p_geolocalizacao jsonb default null'
    ),
  ],
  [
    'v_ip, p_geolocalizacao);\nend;\n$$;',
    'v_ip, p_geolocalizacao, p_relatos);\nend;\n$$;',
  ],
])
const GRANTS_ONLINE = grants('online', online.fonte, linhas(
  'revoke all on function public.selar_romaneio_retorno(',
  `  ${TIPOS_ONLINE}`,
  ') from public, anon;',
  'grant execute on function public.selar_romaneio_retorno(',
  `  ${TIPOS_ONLINE}`,
  ') to authenticated;'
  // p_relatos entra ANTES de p_geolocalizacao — as duas são jsonb.
), TIPOS_ONLINE, 'uuid, uuid, text, uuid, jsonb, text, uuid, timestamptz, jsonb, jsonb')

// ------------------------------------------ (4) selar_romaneio_retorno_sincronizado
const sinc = vigente('selar_romaneio_retorno_sincronizado', '20260912120000_selo_do_retorno_versao_2.sql')
const TIPOS_SINC = 'uuid, uuid, uuid, text, uuid, jsonb, text, text, text, timestamptz, inet, jsonb, text, text'
const sincNovo = aplicar('sincronizado', sinc.original, [
  // assinatura — ANTES de p_validacao/p_motivo, que têm default.
  [
    linhas(
      '  p_geolocalizacao       jsonb,',
      "  -- 4B: QUAL cartão o envelope carrega, e por quê. A Edge Function já"
    ),
    linhas(
      '  p_geolocalizacao       jsonb,',
      '  -- ANTES de p_validacao/p_motivo, que têm default — mesma regra de',
      '  -- selar_romaneio_retorno.',
      '  p_relatos              jsonb,',
      "  -- 4B: QUAL cartão o envelope carrega, e por quê. A Edge Function já"
    ),
  ],
  // os seis registrar_conflito_retorno desta função — cada um termina
  // diferente, então cada troca é única por construção.
  [
    "'resultado', 'nao_autenticada'));",
    "'resultado', 'nao_autenticada'), p_relatos);",
  ],
  [
    "'resultado', 'recusada', 'detalhe', v_auth.motivo));",
    "'resultado', 'recusada', 'detalhe', v_auth.motivo), p_relatos);",
  ],
  [
    linhas(
      "'validacao', 'motoboy',",
      "                           'resultado', 'autenticada_modo_incoerente'));"
    ),
    linhas(
      "'validacao', 'motoboy',",
      "                           'resultado', 'autenticada_modo_incoerente'), p_relatos);"
    ),
  ],
  [
    "'resultado', 'autenticada_cartao_errado'));",
    "'resultado', 'autenticada_cartao_errado'), p_relatos);",
  ],
  [
    "'motivo_excecao', p_motivo, 'resultado', 'autenticada_modo_incoerente'));",
    "'motivo_excecao', p_motivo, 'resultado', 'autenticada_modo_incoerente'), p_relatos);",
  ],
  [
    "'motivo_excecao', p_motivo, 'resultado', 'autenticada_sem_competencia'));",
    "'motivo_excecao', p_motivo, 'resultado', 'autenticada_sem_competencia'), p_relatos);",
  ],
  // a chamada final a _interno.
  [
    "'offline_sincronizada', p_ip, p_geolocalizacao);\nend;\n$$;",
    "'offline_sincronizada', p_ip, p_geolocalizacao, p_relatos);\nend;\n$$;",
  ],
])
// 6 chamadas a registrar_conflito_retorno + 1 chamada final a _interno.
prova('sincronizado: as sete chamadas (6 conflitos + a de _interno) repassam p_relatos',
  contar(sincNovo, ', p_relatos);') === 7)
const GRANTS_SINC = grants('sincronizado', sinc.fonte, linhas(
  'revoke all on function public.selar_romaneio_retorno_sincronizado(',
  `  ${TIPOS_SINC}`,
  ') from public, anon, authenticated;',
  'grant execute on function public.selar_romaneio_retorno_sincronizado(',
  `  ${TIPOS_SINC}`,
  ') to service_role;'
  // p_relatos entra depois de p_geolocalizacao e ANTES de p_validacao/p_motivo.
), TIPOS_SINC, 'uuid, uuid, uuid, text, uuid, jsonb, text, text, text, timestamptz, inet, jsonb, jsonb, text, text')

if (falhas > 0) {
  console.log(`\n${falhas} FALHA(S) — a migration NÃO foi escrita`)
  process.exit(1)
}

// ------------------------------------------------------------- migration
const conflitoBloco = paraDropECreate('registrar_conflito_retorno', conflitoNovo, TIPOS_CONFLITO)
const internoBloco = paraDropECreate('selar_romaneio_retorno_interno', internoNovoFinal, TIPOS_INTERNO)
const onlineBloco = paraDropECreate('selar_romaneio_retorno', onlineNovo, TIPOS_ONLINE)
const sincBloco = paraDropECreate('selar_romaneio_retorno_sincronizado', sincNovo, TIPOS_SINC)

const FOTO = `  select coalesce(jsonb_agg(to_jsonb(v) order by v.tipo, v.numero, v.romaneio_id), '[]'::jsonb)
    into v_placar
    from public.verificar_romaneios_selados() v;`

const migracao = `-- =====================================================================
-- O RELATO NO SELO DO RETORNO — 2026-09-15
--
-- Decisão do usuário (item 111 do NOTAS): quando um item do retorno
-- diverge — pagamento diferente do previsto, ou documento declarado
-- faltante —, quem confirma escreve o que aconteceu ou marca "precisa
-- apurar". O relato fica FORA do documento assinado: parâmetro próprio
-- (\`p_relatos\`), gravado na MESMA transação em \`retorno_relatos\`
-- (migration \`20260915120000\`).
--
-- ---------------------------------------------------------------------
-- AS DUAS REGRAS
-- ---------------------------------------------------------------------
--   relato sem diferença   recusa o SELO INTEIRO — bug de tela, não
--                          decisão de negócio. Verificado contra o que
--                          o PRÓPRIO retorno apurou nesta transação
--                          (pagamento divergente, documento faltante),
--                          nunca contra tabela mutável.
--   diferença sem relato   o selo ACEITA. Obrigatoriedade é da TELA, no
--                          preenchimento — recusar depois de cartão, PIN
--                          e duas assinaturas por uma nota FORA do
--                          documento seria pior. Ausência de linha, para
--                          um item que diverge, já significa "sem
--                          relato".
--
-- ---------------------------------------------------------------------
-- QUATRO FUNÇÕES, CADA UMA COM DROP EXPLÍCITO
-- ---------------------------------------------------------------------
-- As quatro GANHAM UM PARÂMETRO. \`create or replace\` não bastaria:
-- Postgres identifica função por nome + tipos dos argumentos, e uma
-- lista mais longa é uma SOBRECARGA nova, não uma substituição — a
-- versão antiga continuaria existindo e aceitando chamadas de um bundle
-- não atualizado. Por isso cada uma tem \`drop function\` com os tipos
-- ANTIGOS antes do \`create\`, como \`20260911180000\`/\`20260912120000\`
-- já fizeram para a versão 2 do selo.
--
-- \`registrar_conflito_retorno\`               + p_relatos no fim
-- \`selar_romaneio_retorno_interno\`           + p_relatos no fim
-- \`selar_romaneio_retorno\`                   + p_relatos ANTES de
--                                             p_geolocalizacao (que tem
--                                             default — todo parâmetro
--                                             depois de um com default
--                                             também precisa ter)
-- \`selar_romaneio_retorno_sincronizado\`      + p_relatos ANTES de
--                                             p_validacao/p_motivo
--
-- ISTO QUEBRA O RETORNO DO CLIENTE DE HOJE, de propósito, como a versão
-- 2 do selo e a receita já quebraram: uma aba com o bundle antigo chama
-- as quatro funções sem \`p_relatos\` e recebe erro de função inexistente.
-- Aplicar junto com o cliente novo, com a fila de retornos vazia.
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA
-- ---------------------------------------------------------------------
--   * NENHUM byte do DCRR1. \`p_relatos\` não entra em
--     \`romaneio_retorno_canonico\` nem em \`romaneio_retorno_validar\` —
--     só o \`p_retorno\` continua alimentando os dois.
--   * NENHUM documento já selado: o gate no fim prova que o placar do
--     verificador não se move.
--   * NENHUM conflito registrado antes desta migration ganha relato
--     retroativo — \`relatos_declarados\` só existe daqui pra frente.
--
-- Gerada por scripts/patch-relato-do-retorno.mts, que extrai as
-- definições VIGENTES (a de \`selar_romaneio_retorno_interno\` é a de
-- ONTEM, a da receita) e PROVA que, tirando os trechos trocados, cada
-- corpo volta byte a byte ao vigente. Não edite à mão: rode o script.
-- =====================================================================

begin;

-- O BASELINE: só o placar — esta migration não toca em \`d\` nem em \`r\`,
-- então a expectativa de documento de uma saída não pode mudar; não
-- precisa da segunda foto que a receita tirou.
do $$
declare
  v_placar jsonb;
begin
${FOTO}
  perform set_config('app.relato_placar_antes', v_placar::text, true);
  raise notice 'Antes: % documento(s) no placar.', jsonb_array_length(v_placar);
end $$;


-- (1) registrar_conflito_retorno — gerada pelo script -------------------
${conflitoBloco}

${GRANTS_CONFLITO}


-- (2) selar_romaneio_retorno_interno — gerada pelo script ----------------
${internoBloco}

${GRANTS_INTERNO}


-- (3) selar_romaneio_retorno (online) — gerada pelo script ---------------
${onlineBloco}

${GRANTS_ONLINE}


-- (4) selar_romaneio_retorno_sincronizado (offline) — gerada pelo script -
${sincBloco}

${GRANTS_SINC}


-- OS GATES: as quatro têm exatamente uma versão, e nada existente se moveu.
do $$
declare
  v_placar_antes jsonb := nullif(current_setting('app.relato_placar_antes', true), '')::jsonb;
  v_placar       jsonb;
  v_funcoes      int;
begin
  if v_placar_antes is null then
    raise exception 'Baseline não encontrado — o bloco do começo não rodou nesta transação.';
  end if;

  select count(*) into v_funcoes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('registrar_conflito_retorno', 'selar_romaneio_retorno_interno',
                       'selar_romaneio_retorno', 'selar_romaneio_retorno_sincronizado');
  if v_funcoes <> 4 then
    raise exception 'Esperava 4 funções, uma de cada; achei %. Alguma ficou com a versão antiga e a nova coexistindo — transação desfeita.',
      v_funcoes;
  end if;

${FOTO}

  if v_placar is distinct from v_placar_antes then
    raise exception 'O placar do verificador MOVEU — transação desfeita. antes: %  depois: %',
      v_placar_antes, v_placar;
  end if;

  raise notice 'Gates ok: % documento(s) no placar, nada movido, 4 funções em versão única.',
    jsonb_array_length(v_placar);
end $$;

commit;


-- =====================================================================
-- CONFERÊNCIAS — no SQL Editor, depois de aplicar
--
-- (a) as quatro, uma versão cada, com p_relatos:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('registrar_conflito_retorno', 'selar_romaneio_retorno_interno',
--                        'selar_romaneio_retorno', 'selar_romaneio_retorno_sincronizado')
--    order by p.proname;
--   -- esperado: 4 linhas, cada args contendo "p_relatos jsonb"
--
-- (b) relato sem diferença é recusado, ANTES de gravar qualquer coisa.
--     Pega uma corrida aberta de verdade (troque os uuids) e chame com um
--     retorno de um vale ENTREGUE sem divergência, mas com relato de
--     pagamento pendurado nele:
--
--   select public.selar_romaneio_retorno(
--     '<romaneio_id novo>', '<saida_romaneio_id selada>', '<saida_document_hash>',
--     '<motoboy_id>',
--     '[{"entrega_id":"<um vale da saida>","desfecho":"entregue","motivo":null,
--        "detalhe":null,"pagamentos_realizados":[],"documentos":[]}]'::jsonb,
--     '<document_hash calculado>', '<autorizacao_id>', now(),
--     '[{"id":"<uuidv7>","entrega_id":"<o mesmo vale>","natureza":"pagamento",
--        "tipo_documento":null,"situacao":"relatado","relato":"teste"}]'::jsonb);
--   -- esperado: ERRO "Relato de pagamento para um vale sem divergência."
--   -- (ou o hash não vai bater primeiro — o que importa é NÃO selar)
--
-- (c) o placar, o mesmo de antes de aplicar:
--
--   select * from public.verificar_integridade_resumo();
--
-- (d) teste real, do app: um vale com pagamento divergente e/ou documento
--     faltante — a tela deve pedir relato ou "precisa apurar" antes de
--     deixar congelar. Depois de selar:
--
--   select * from public.retorno_relatos order by registrado_em desc limit 5;
--   -- esperado: uma linha por item relatado, com o texto ou
--   -- situacao='precisa_apurar'
-- =====================================================================
`

writeFileSync(new URL(SAIDA, RAIZ), migracao)
const escrita = ler(SAIDA)
for (const [rotulo, trecho] of [
  ['registrar_conflito_retorno', conflitoBloco],
  ['selar_romaneio_retorno_interno', internoBloco],
  ['selar_romaneio_retorno', onlineBloco],
  ['selar_romaneio_retorno_sincronizado', sincBloco],
] as Array<[string, string]>) {
  prova(`a migration contém o bloco provado de ${rotulo}, uma vez`, contar(escrita, trecho) === 1)
}

console.log(falhas > 0 ? `\n${falhas} FALHA(S)` : `\nmigration escrita: ${SAIDA}`)
if (falhas > 0) process.exit(1)
