// Gera a migration do passo 3: `loja_nome` no snapshot dos romaneios.
//
//   npx tsx scripts/patch-payload-loja-nome.mts
//
// Mesmo método da `patch-validar-retorno-outro.mts`: extrair a definição
// VIGENTE das duas funções, fazer a troca mínima e PROVAR que nada além da
// chave nova mudou. Não edite o SQL gerado à mão — rode este script.
//
// O que ele prova, antes de escrever:
//   - cada função foi definida numa migration só (a extraída é a vigente)
//   - a âncora da inserção existe exatamente uma vez
//   - tirando o trecho inserido, a definição volta byte a byte à original
//   - cabeçalho (assinatura, language, security definer, search_path)
//     idêntico
//   - `loja_nome` não existia antes e aparece uma vez depois
//   - o arquivo gerado define só essas duas funções — nenhum canônico,
//     nenhum selo, nenhum verificador

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'

const RAIZ = new URL('../', import.meta.url)
const PASTA = 'supabase/migrations/'
const SAIDA = PASTA + '20260911130000_nome_da_filial_no_snapshot.sql'

const ler = (p: string) => readFileSync(new URL(p, RAIZ), 'utf8').replace(/\r\n/g, '\n')

let falhas = 0
function prova(nome: string, condicao: boolean) {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}`)
  if (!condicao) falhas++
}

const contar = (texto: string, trecho: string) => texto.split(trecho).length - 1

function extrair(arquivo: string, cabecalho: string) {
  const fonte = ler(PASTA + arquivo)
  prova(`${arquivo}: a definição aparece uma vez`, contar(fonte, cabecalho) === 1)
  const i = fonte.indexOf(cabecalho)
  const j = fonte.indexOf('\n$$;', i)
  return fonte.slice(i, j + '\n$$;'.length)
}

function definidaSoEm(cabecalho: string, esperado: string) {
  const onde = readdirSync(new URL(PASTA, RAIZ))
    .filter((f) => f.endsWith('.sql') && PASTA + f !== SAIDA)
    .filter((f) => ler(PASTA + f).includes(cabecalho))
  prova(`${cabecalho.trim()} só é definida em ${esperado}`,
    onde.length === 1 && onde[0] === esperado)
}

function inserir(nome: string, original: string, ancora: string, trecho: string) {
  prova(`${nome}: a âncora existe uma vez`, contar(original, ancora) === 1)
  prova(`${nome}: \`loja_nome\` não existia`, !original.includes('loja_nome'))
  const nova = original.replace(ancora, ancora + trecho)
  prova(`${nome}: tirando a inserção, volta byte a byte à original`,
    nova.replace(ancora + trecho, ancora) === original)
  prova(`${nome}: \`loja_nome\` aparece uma vez`, contar(nova, "'loja_nome'") === 1)
  const cabecalho = (t: string) => t.slice(0, t.indexOf('as $$') + 'as $$'.length)
  prova(`${nome}: assinatura, language e security definer idênticos`,
    cabecalho(nova) === cabecalho(original))
  return nova
}

// ---------------------------------------------------------------- saída
const CAB_SAIDA = 'create or replace function public.romaneio_payload('
const ARQ_SAIDA = '20260816140000_romaneio_de_saida.sql'
definidaSoEm(CAB_SAIDA, ARQ_SAIDA)
const saidaOriginal = extrair(ARQ_SAIDA, CAB_SAIDA)
const saidaNova = inserir(
  'saída',
  saidaOriginal,
  "    'loja_id', p_loja_id,\n",
  "    'loja_nome', (select l.nome from public.lojas l where l.id = p_loja_id),\n"
)
const REVOKE_SAIDA =
  'revoke all on function public.romaneio_payload(uuid, uuid, uuid, uuid, uuid[])\n  from public, anon, authenticated;'
prova('saída: o revoke original está lá, e é reproduzido igual', ler(PASTA + ARQ_SAIDA).includes(REVOKE_SAIDA))

// -------------------------------------------------------------- retorno
const CAB_RETORNO = 'create or replace function public.romaneio_retorno_payload('
const ARQ_RETORNO = '20260820130000_selar_romaneio_retorno.sql'
definidaSoEm(CAB_RETORNO, ARQ_RETORNO)
const retornoOriginal = extrair(ARQ_RETORNO, CAB_RETORNO)
const retornoNova = inserir(
  'retorno',
  retornoOriginal,
  "    'saida_romaneio_id', p_saida_id,\n",
  // O retorno é gravado com o `loja_id` da SAÍDA (`v_saida.loja_id` no
  // selo), então o nome sai dela.
  "    'loja_nome', (select l.nome\n" +
    '                    from public.romaneios s\n' +
    '                    join public.lojas l on l.id = s.loja_id\n' +
    '                   where s.id = p_saida_id),\n'
)
const REVOKE_RETORNO =
  'revoke all on function public.romaneio_retorno_payload(uuid, jsonb)\n  from public, anon, authenticated;'
prova('retorno: o revoke original está lá, e é reproduzido igual', ler(PASTA + ARQ_RETORNO).includes(REVOKE_RETORNO))

// ------------------------------------------------------------ migration
const CABECALHO = `-- =====================================================================
-- O nome da filial CONGELADO no snapshot dos romaneios — passo 3, 2026-09-11
--
-- O DEFEITO, medido: o nome da filial nos documentos vinha de join vivo
-- (\`lojas(nome)\` em src/data/romaneios.ts). Renomear uma filial mudava o
-- cabeçalho de todo PDF histórico e mandava um reenvio ao Drive para outra
-- pasta. É a regra 7 noutra coluna: o documento diz o que era verdade
-- quando foi selado.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA
-- ---------------------------------------------------------------------
--   romaneio_payload          + 'loja_nome', lido de \`lojas\` no selo
--   romaneio_retorno_payload  + 'loja_nome', da filial da SAÍDA — é o
--                               loja_id que o selo do retorno grava
--
-- Assinaturas idênticas: quem chama (selar_romaneio_interno,
-- registrar_conflito_romaneio, preparar_romaneio e
-- selar_romaneio_retorno_interno) NÃO é reaberto.
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA, e por que é seguro
-- ---------------------------------------------------------------------
--   * NENHUM BYTE DE HASH. O nome não entra no canônico — \`romaneio_canonico\`
--     e \`romaneio_retorno_canonico\` não são tocados, e o \`document_hash\`
--     continua cobrindo só o loja_id. O verificador confere
--     \`digest(canonico)\` sobre os bytes gravados e não lê o payload.
--   * NENHUM DOCUMENTO EXISTENTE. \`create or replace\` troca a função, não
--     reescreve \`romaneios.payload\`. Os já selados ficam sem a chave, e o
--     cliente cai no nome atual só para eles — são dados de teste, que o
--     corte pré-V1 apaga. Preencher agora seria INVENTAR: gravar o nome de
--     hoje como se fosse o do instante do selo.
--   * nenhum leitor quebra: no banco e no cliente o payload só é lido por
--     \`-> 'vales'\`; ninguém compara o payload inteiro.
--
-- UM LIMITE, declarado: na saída OFFLINE o selo acontece na sincronização,
-- então o nome congelado é o do instante em que o servidor sela, e não o
-- da retirada no balcão. Só diverge se a filial for renomeada nesse meio
-- tempo — e renomear filial é SQL manual e raro.
--
-- Gerada por scripts/patch-payload-loja-nome.mts, que extrai as definições
-- vigentes e PROVA que só a chave nova mudou. Não edite à mão.
-- =====================================================================
`

const RODAPE = `
-- =====================================================================
-- CONFERÊNCIAS — rodar depois de aplicar, UMA POR VEZ no SQL Editor
-- =====================================================================
--
-- (a) as duas funções carregam a chave:
--
-- select p.proname, position('loja_nome' in p.prosrc) > 0 as tem_loja_nome
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('romaneio_payload', 'romaneio_retorno_payload')
--  order by 1;
--
-- esperado: 2 linhas, tem_loja_nome = true
--
--
-- (b) a saída congela o nome certo — sem gravar nada:
--
-- select l.nome as filial,
--        public.romaneio_payload(l.id, null, null, null, array[]::uuid[]) ->> 'loja_nome' as no_snapshot
--   from public.lojas l
--  order by l.nome;
--
-- esperado: as duas colunas iguais em todas as linhas
--
--
-- (c) o retorno pega a filial da saída — sem gravar nada:
--
-- select r.numero, l.nome as filial,
--        public.romaneio_retorno_payload(r.id, '[]'::jsonb) ->> 'loja_nome' as no_snapshot
--   from public.romaneios r
--   join public.lojas l on l.id = r.loja_id
--  where r.tipo = 'saida' and r.status = 'selado'
--  order by r.numero desc
--  limit 5;
--
-- esperado: as duas colunas iguais
--
--
-- (d) nenhum documento existente foi reescrito:
--
-- select tipo, status, count(*) as documentos,
--        count(*) filter (where payload ? 'loja_nome') as com_nome
--   from public.romaneios
--  group by 1, 2
--  order by 1, 2;
--
-- esperado: com_nome = 0 em todas as linhas, até a próxima saída
--
--
-- (e) o verificador não se moveu:
--
-- select * from public.verificar_integridade_resumo();
--
-- esperado: o mesmo placar da última medição (20 · 20 · 0 em 2026-09-10),
--           ou maior só pelos documentos criados desde então, sem divergência
--
--
-- (f) DEPOIS da próxima saída (e do próximo retorno), o nome está gravado:
--
-- select numero, tipo, payload ->> 'loja_nome' as filial_no_documento
--   from public.romaneios
--  where payload ? 'loja_nome'
--  order by recebido_em_servidor desc
--  limit 5;
`

const migration =
  CABECALHO +
  '\n\n-- (1) SAÍDA ------------------------------------------------------------\n' +
  saidaNova + '\n\n' + REVOKE_SAIDA + '\n' +
  '\n\n-- (2) RETORNO ----------------------------------------------------------\n' +
  retornoNova + '\n\n' + REVOKE_RETORNO + '\n' +
  RODAPE

prova('o arquivo gerado define exatamente duas funções',
  contar(migration, 'create or replace function') === 2)
prova('e são só as duas de payload',
  migration.includes(CAB_SAIDA) && migration.includes(CAB_RETORNO))
prova('nenhum canônico, selo ou verificador é redefinido',
  !/create or replace function public\.(romaneio_canonico|romaneio_retorno_canonico|selar_|verificar_|registrar_conflito|preparar_romaneio)/.test(migration))

if (falhas > 0) {
  console.log(`\n${falhas} FALHA(S) — migration NÃO escrita`)
  process.exit(1)
}

const destino = new URL(SAIDA, RAIZ)
if (existsSync(destino) && ler(SAIDA) === migration) {
  console.log(`\n${SAIDA} já está igual ao que o script gera`)
} else {
  writeFileSync(destino, migration)
  console.log(`\nescrita: ${SAIDA}`)
}
