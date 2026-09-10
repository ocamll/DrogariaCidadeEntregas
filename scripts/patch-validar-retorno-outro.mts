// npx tsx scripts/patch-validar-retorno-outro.mts
//
// `outro` sai das formas de pagamento. Gera a QUARTA definição de
// `romaneio_retorno_validar`, por PATCH da terceira (20260820150000), e a
// migration que a aplica junto com o CHECK de `pagamentos.forma`.
//
//     extrai a vigente → troca mínima → prova as invariantes
//                                    → só então escreve a migration
//
// Mesmo método do `patch-selar-saida-e10.mts`. Reescrever à mão a função
// que decide o que se aceita ASSINAR é a forma mais provável de mudar sem
// querer o que não devia.

import { readFileSync, writeFileSync } from 'node:fs'
import { VETORES, VETORES_INVALIDOS } from './dcrr1-vetores.mts'

const ORIGEM = 'supabase/migrations/20260820150000_dcrr1_bloco_documentos.sql'
const MIGRACAO = 'supabase/migrations/20260910120000_outro_sai_das_formas_de_pagamento.sql'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// ---------------------------------------------------------------------
// 1. extrai a definição vigente
// ---------------------------------------------------------------------
const fonte = readFileSync(ORIGEM, 'utf8')
const INICIO = 'create or replace function public.romaneio_retorno_validar('
checa('a origem tem exatamente uma definição', fonte.split(INICIO).length - 1 === 1)
const inicio = fonte.indexOf(INICIO)
const FIM = '\n$$;'
const fim = fonte.indexOf(FIM, inicio)
checa('achou o fim da definição', inicio >= 0 && fim > inicio)
const vigente = fonte.slice(inicio, fim + FIM.length)

// ---------------------------------------------------------------------
// 2. a troca mínima: só a lista de formas, e o comentário dela
// ---------------------------------------------------------------------
const ANTES = [
  '  -- ESTA LISTA É O CHECK DE `pagamentos.forma`. Mexeu aqui, mexa junto',
  '  -- nos outros três lugares (vetores, spec dos vetores, TS).',
  "  v_formas_ok   text[] := array['dinheiro','credito','debito','pix',",
  "                                'convenio','convcard','crediario','outro'];",
].join('\n')

const DEPOIS = [
  '  -- ESTA LISTA É O CHECK DE `pagamentos.forma`. Mexeu aqui, mexa junto',
  '  -- nos outros três lugares (vetores, spec dos vetores, TS).',
  '  --',
  '  -- `outro` SAIU em 2026-09-10 — daqui e do CHECK, na mesma migration.',
  '  -- Continua em `v_motivos_ok`, logo acima: lá é motivo de insucesso,',
  '  -- outro campo com o mesmo nome.',
  "  v_formas_ok   text[] := array['dinheiro','credito','debito','pix',",
  "                                'convenio','convcard','crediario'];",
].join('\n')

checa('o bloco da lista de formas aparece exatamente uma vez', vigente.split(ANTES).length - 1 === 1)
const proposta = vigente.replace(ANTES, DEPOIS)

// ---------------------------------------------------------------------
// 3. as invariantes
// ---------------------------------------------------------------------
const MARCA = '<<LISTA DE FORMAS>>'
checa(
  'FORA da lista de formas, nenhum byte mudou',
  vigente.replace(ANTES, MARCA) === proposta.replace(DEPOIS, MARCA)
)
checa('`outro` saiu da lista de formas', !/v_formas_ok[^;]*'outro'/s.test(proposta))
checa(
  '`outro` continua nos motivos de insucesso',
  proposta.includes("v_motivos_ok  text[] := array['ausente', 'endereco_errado', 'recusou', 'outro'];")
)
checa(
  'a regra do motivo `outro` sem detalhe continua',
  proposta.includes("if v_motivo = 'outro' and btrim(coalesce(v_vale ->> 'detalhe', '')) = '' then")
)
const recusas = (t: string) => (t.match(/return '/g) ?? []).length
checa(
  'os mesmos motivos de recusa',
  recusas(vigente) === recusas(proposta),
  `${recusas(vigente)} → ${recusas(proposta)}`
)
checa(
  'a assinatura e os atributos são os mesmos',
  proposta.startsWith(
    INICIO +
      '\n  p_saida_document_hash text,\n  p_retorno jsonb\n)\n' +
      'returns text language plpgsql immutable set search_path = public as $$'
  )
)
checa('não toca o canônico', !proposta.includes('romaneio_retorno_canonico'))

const GRANTS =
  'revoke all on function public.romaneio_retorno_validar(text, jsonb) from public, anon;\n' +
  'grant execute on function public.romaneio_retorno_validar(text, jsonb) to authenticated;'
checa('os grants são os mesmos da origem', fonte.includes(GRANTS))

if (falhas > 0) {
  console.log(`\n${falhas} FALHA(S) — a migration NÃO foi escrita`)
  process.exit(1)
}

// ---------------------------------------------------------------------
// 4. só agora, a migration
// ---------------------------------------------------------------------
const conferencias = VETORES.length * 3 + VETORES_INVALIDOS.length

const migracao = `-- =====================================================================
-- \`outro\` sai das FORMAS DE PAGAMENTO — e só delas
--
-- Decidido em 2026-09-08 (docs/escopo-pre-v1-revisado.md, seção 3) e
-- escrito em 2026-09-10 como passo PRÓPRIO, separado do passo 1.
--
-- Mesmo método da 20260820120000, que já foi uma troca de domínio de
-- forma: o CHECK de \`pagamentos.forma\` e \`romaneio_retorno_validar\`
-- mudam JUNTOS, e \`romaneio_retorno_canonico\` NÃO é tocada.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA: operações NOVAS deixam de aceitar \`outro\` como forma
-- ---------------------------------------------------------------------
--   cadastro e divergência   inserem em \`pagamentos\` → o CHECK recusa
--   retorno                  passa por \`romaneio_retorno_validar\` →
--                            \`forma_invalida\`, antes de qualquer escrita
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA, e por que é seguro
-- ---------------------------------------------------------------------
--   * nenhum byte de documento válido: só encolhe o conjunto ACEITO
--   * a verificação do histórico: \`verificar_romaneio\` confere
--     \`digest(canonico)\` sobre os bytes GRAVADOS e não chama o validador
--   * nenhum caminho de leitura chama o validador — só o selo do retorno
--     e a ferramenta pura \`conferir_canonico_retorno\`
--   * \`outro\` como MOTIVO DE INSUCESSO (\`v_motivos_ok\`): outro campo,
--     mesmo nome
--   * nenhum pagamento é convertido. Se existir algum \`outro\`, o bloco 1
--     PARA a migration em vez de reescrever o passado
--
-- CENSO de 2026-09-10, lido pela aplicação antes de escrever isto: zero
-- pagamentos \`outro\` (previsto ou realizado), zero documentos com
-- \`outro\` numa linha de pagamento, zero eventos \`pagamento_alterado\`.
--
-- CHECK VALIDADO, e não \`NOT VALID\`. Com o censo zerado os dois têm o
-- mesmo efeito hoje; o validado deixa uma invariante conferível
-- (\`convalidated = true\`) em vez de uma constraint permanentemente não
-- verificada, que um \`VALIDATE CONSTRAINT\` futuro ou um restore
-- tropeçariam. Se o censo mudar antes de aplicar, o bloco 1 recusa e a
-- decisão volta pro usuário.
--
-- Gerada por \`scripts/patch-validar-retorno-outro.mts\`, que extrai a
-- definição vigente (20260820150000), faz a troca mínima e PROVA que nada
-- fora da lista de formas mudou. Não edite o bloco 3 à mão: rode o script.
-- =====================================================================


-- (1) PRÉ-VOO — parar, nunca converter -------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.pagamentos where forma = 'outro';
  if v_n > 0 then
    raise exception 'Existem % pagamento(s) com forma "outro". Esta migration não converte histórico: decida o destino deles antes de aplicar.', v_n;
  end if;
end $$;


-- (2) O CHECK — a trava do cadastro e da divergência ------------------
alter table public.pagamentos drop constraint if exists pagamentos_forma_check;
alter table public.pagamentos add constraint pagamentos_forma_check
  check (forma in ('dinheiro','credito','debito','pix','convenio','convcard','crediario'));


-- (3) O VALIDADOR DO RETORNO — gerado pelo script ---------------------
${proposta}

${GRANTS}


-- =====================================================================
-- CONFERIR DEPOIS DE APLICAR
--
-- 1. O CHECK não tem mais \`outro\`, e está validado. Esperado: uma linha,
--    sem 'outro', \`convalidated = true\`.
--
--   select pg_get_constraintdef(oid) as definicao, convalidated
--     from pg_constraint where conname = 'pagamentos_forma_check';
--
-- 2. O validador. Esperado, nesta ordem:
--    forma_invalida · (vazio) · (vazio)
--
--   select 'forma outro' as caso, public.romaneio_retorno_validar(
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '[{"entrega_id":"e1","desfecho":"entregue","motivo":null,"detalhe":null,
--        "pagamentos_realizados":[{"pagamento_id":"p1","forma":"outro",
--          "valor_cents":100,"troco_cents":0}]}]'::jsonb) as resultado
--   union all
--   select 'forma pix', public.romaneio_retorno_validar(
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '[{"entrega_id":"e1","desfecho":"entregue","motivo":null,"detalhe":null,
--        "pagamentos_realizados":[{"pagamento_id":"p1","forma":"pix",
--          "valor_cents":100,"troco_cents":0}]}]'::jsonb)
--   union all
--   select 'motivo outro com detalhe', public.romaneio_retorno_validar(
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '[{"entrega_id":"e1","desfecho":"insucesso","motivo":"outro",
--        "detalhe":"portão fechado","pagamentos_realizados":[]}]'::jsonb);
--
-- 3. A conferência completa contra os golden vectors, que agora trazem
--    o I018 (\`outro\` como forma, recusado):
--
--       npx tsx scripts/dcrr1-sql.spec.mts > conferir.sql
--
--    e colar no SQL Editor. Esperado: **${conferencias} de ${conferencias}** — ${VETORES.length}
--    válidos × texto/bytes/hash + ${VETORES_INVALIDOS.length} motivos de recusa —, e nenhuma
--    linha com \`ok = false\`.
--
-- 4. O verificador de integridade, como admin, ANTES e DEPOIS: o conjunto
--    de documentos que verificam não pode mudar. Esta migration não toca
--    em documento, então qualquer diferença é sinal de outra coisa.
-- =====================================================================
`

writeFileSync(MIGRACAO, migracao)
const escrita = readFileSync(MIGRACAO, 'utf8')
checa('a migration contém a proposta provada, uma vez', escrita.split(proposta).length - 1 === 1)
checa('e os grants', escrita.includes(GRANTS))

console.log(
  falhas > 0
    ? `\n${falhas} FALHA(S)`
    : `\nmigration escrita: ${MIGRACAO}  (${conferencias} conferências esperadas)`
)
if (falhas > 0) process.exit(1)
