// npx tsx scripts/patch-selar-retorno-e3b.mts
//
// E3.B — a QUINTA definição de `selar_romaneio_retorno_interno`, obtida
// por PATCH da quarta.
//
// O método é o mesmo da quarta (20260820200000), e ele existe porque
// esta é a função mais crítica do projeto: reescrevê-la à mão é a forma
// mais provável de mover, sem querer, uma linha de `digest(...)` — e uma
// fórmula de hash alterada por acidente não dá erro, dá romaneio que
// deixa de verificar meses depois.
//
//     extrai a 4ª  →  patch mínimo  →  diff  →  prova as invariantes
//                                            →  só então vira migration
//
// O patch é UM só: o evento `pagamento_alterado` deixa de escolher UM
// previsto com `limit 1` e passa a agregar TODOS.
//
// POR QUE ISSO É UM DEFEITO, e não uma melhoria: com dois previstos — que
// é justamente o que o E4 vai criar — o evento afirma que a divergência
// foi de UMA das formas e descarta a outra em silêncio. Não é registro
// incompleto, é registro ERRADO, num evento de auditoria. E o contraste
// que o torna traiçoeiro: a checagem da invariante, 20 linhas acima, JÁ
// é multi-consciente (`array_agg` de `forma|valor`).

import { readFileSync, writeFileSync } from 'node:fs'

const ORIGEM = 'supabase/migrations/20260820200000_pagamento_realizado_invariante.sql'
const SAIDA = 'scripts/.e3b-proposta.sql'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// ---------------------------------------------------------------------
// E3.B.1 — extrai a definição mais recente
// ---------------------------------------------------------------------
const fonte = readFileSync(ORIGEM, 'utf8')
const inicio = fonte.indexOf('create or replace function public.selar_romaneio_retorno_interno')
checa('E3.B.1 — achou a 4ª definição', inicio >= 0)
const anterior = fonte.slice(inicio)

// ---------------------------------------------------------------------
// E3.B.2 — patch MÍNIMO, só no evento
// ---------------------------------------------------------------------
const ALVO = `             'de', (select pg.forma from public.pagamentos pg
                     where pg.entrega_id = v_entrega_id and pg.momento = 'previsto'
                     order by pg.id::text collate "C" limit 1),`

const NOVO = `             -- E3: TODOS os previstos, não "um deles".
             --
             -- Era \`limit 1\`, e com dois previstos o evento afirmaria que
             -- a divergência foi de UMA das formas, descartando a outra em
             -- silêncio. Num evento de auditoria isso não é registro
             -- incompleto: é registro errado.
             --
             -- ORDEM TOTAL de propósito. \`order by pg.forma\` sozinho
             -- deixaria empate entre dois previstos da MESMA forma, e o
             -- Postgres não promete ordem útil aí. Mesmos fatos têm que
             -- produzir a mesma representação, mesmo isto não entrando em
             -- hash nenhum.
             --
             -- Sem \`coalesce(..., '[]')\`: o escalar de antes também
             -- acabava em NULL quando não havia previsto, e uma lista
             -- vazia diria "havia previsto, e ele estava vazio".
             'de', (select jsonb_agg(jsonb_build_object(
                             'forma', pg.forma,
                             'valor_cents', pg.valor_cents)
                           order by pg.forma, pg.id::text collate "C")
                      from public.pagamentos pg
                     where pg.entrega_id = v_entrega_id and pg.momento = 'previsto'),`

const ocorrencias = anterior.split(ALVO).length - 1
checa('E3.B.2 — o trecho alvo aparece UMA vez', ocorrencias === 1, `achei ${ocorrencias}`)
const proposta = anterior.replace(ALVO, NOVO)

// ---------------------------------------------------------------------
// E3.B.3 / E3.B.4 — o diff, e as invariantes
// ---------------------------------------------------------------------
const linhasAntes = anterior.split('\n')
const linhasDepois = proposta.split('\n')

// Um diff de conjunto basta aqui: o patch é uma substituição contígua,
// então o que importa é QUE linhas saíram e QUE linhas entraram.
const conjuntoAntes = new Set(linhasAntes)
const conjuntoDepois = new Set(linhasDepois)
const removidas = linhasAntes.filter((l) => !conjuntoDepois.has(l))
const acrescentadas = linhasDepois.filter((l) => !conjuntoAntes.has(l))

console.log('\n--- E3.B.3 — o diff ---')
console.log(`  ${removidas.length} linha(s) removida(s), ${acrescentadas.length} acrescentada(s)`)
for (const l of removidas) console.log(`  - ${l.trim()}`)
for (const l of acrescentadas) console.log(`  + ${l.trim()}`)

console.log('\n--- E3.B.4 — as invariantes ---')

// 1. as expressões digest(...) byte a byte idênticas
const digests = (s: string) => s.match(/encode\(digest\([\s\S]*?\), 'hex'\)/g) ?? []
const dAntes = digests(anterior)
const dDepois = digests(proposta)
checa('há 4 expressões digest()', dAntes.length === 4, `achei ${dAntes.length}`)
checa('e elas continuam byte a byte idênticas',
  dAntes.length === dDepois.length && dAntes.every((d, i) => d === dDepois[i]))

// 2. nada de assinatura mudou
const assinaturas = (s: string) => s.match(/insert into public\.assinaturas[\s\S]*?;/g) ?? []
checa('nenhum insert em assinaturas alterado',
  JSON.stringify(assinaturas(anterior)) === JSON.stringify(assinaturas(proposta)))

// 3. nada do DCRR1 mudou
const dcrr1 = (s: string) => s.match(/romaneio_retorno_canonico[\s\S]{0,200}/g) ?? []
checa('nenhum trecho do DCRR1 alterado',
  JSON.stringify(dcrr1(anterior)) === JSON.stringify(dcrr1(proposta)))

// 4. o guard do §78 intacto
const guard = (s: string) => s.match(/v_pr_gravados[\s\S]{0,400}/g) ?? []
checa('o guard do §78 intacto',
  JSON.stringify(guard(anterior)) === JSON.stringify(guard(proposta)))

// 5. nenhum ON CONFLICT alterado
const conflitos = (s: string) => s.match(/on conflict[^\n]*/gi) ?? []
checa('nenhum ON CONFLICT alterado',
  JSON.stringify(conflitos(anterior)) === JSON.stringify(conflitos(proposta)))

// 6. EXATAMENTE UMA query de pagamentos mudou, e é a do evento.
//
// A primeira versão desta checagem tentava filtrar a query patcheada por
// conteúdo e comparar o resto — e falhou por defeito MEU: a janela de
// 160 caracteres começa depois do `from`, então o `valor_cents` da query
// nova cai fora dela e o filtro não a excluía. Afirmar "exatamente uma
// mudou" é mais simples e prova mais.
const queriesPagamentos = (s: string) => s.match(/from public\.pagamentos pg[\s\S]{0,160}/g) ?? []
const qAntes = queriesPagamentos(anterior)
const qDepois = queriesPagamentos(proposta)
checa('o número de queries de pagamentos não mudou',
  qAntes.length === qDepois.length, `${qAntes.length} → ${qDepois.length}`)
const diferentes = qAntes.filter((q, i) => q !== qDepois[i])
checa('e EXATAMENTE UMA delas mudou', diferentes.length === 1,
  `${diferentes.length} diferente(s)`)
checa('e a que mudou é a do evento `pagamento_alterado`',
  diferentes.length === 1 && diferentes[0].includes('limit 1'))

// 7. o `limit 1` do evento sumiu, e nada mais
checa('o `limit 1` do evento saiu', !proposta.includes('order by pg.id::text collate "C" limit 1'))
checa('e a ordem total entrou',
  proposta.includes('order by pg.forma, pg.id::text collate "C"'))

// ---------------------------------------------------------------------
// E3.B.5 — grava a proposta (NÃO é a migration ainda)
// ---------------------------------------------------------------------
writeFileSync(SAIDA, proposta, 'utf8')
console.log(`\nproposta gravada em ${SAIDA} (${linhasDepois.length} linhas)`)

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
