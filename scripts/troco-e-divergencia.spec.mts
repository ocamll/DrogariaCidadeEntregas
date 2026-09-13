// npx tsx scripts/troco-e-divergencia.spec.mts
//
// FALSAS DIVERGÊNCIAS E "TROCO PARA" — 2026-09-12, com o misto em 2026-09-13.
//
// Escrito ANTES da primeira correção, para demonstrar os defeitos:
//
//   1. a lista de vales e o fechamento chamavam de divergência a mera
//      EXISTÊNCIA de pagamento realizado. O selo do retorno grava o
//      realizado de todo vale entregue, então todo retorno virava
//      "(divergiu)" — V-000066 a V-000069, medidos no banco em `na_ordem`;
//   2. o retorno pedia "Valor" e "Troco" soltos, e o caixa digitava o
//      dinheiro RECEBIDO no campo que o servidor compara como valor APLICADO
//      à compra — o V-000063 (200 com troco de 100) é esse caso;
//   3. o cadastro não tinha onde dizer o troco a levar.
//
// E ATUALIZADO em 2026-09-13, pela decisão do usuário sobre o pagamento
// misto: o "troco para" considera SÓ a parcela em dinheiro. As asserções que
// diziam "misto não aplica" e "misto mantém o troco informado" mudaram porque
// a regra mudou — foram escritas antes da implementação nova, e falharam nela
// até a regra existir.
//
// O CONTRATO que o spec trava (e que o servidor já pressupunha):
//
//   pagamentos.valor_cents   parte da COMPRA paga por aquela forma — líquido
//   pagamentos.troco_cents   dinheiro devolvido naquela linha (só dinheiro)
//   recebido / "troco para"  valor_cents + troco_cents — derivado, sem coluna
//   comparação               multiconjunto forma|valor_cents — troco FORA
//
// O módulo é importado dinamicamente e cada função é conferida antes de ser
// chamada: sem isso, uma execução antes da correção morreria na importação e
// esconderia QUAIS defeitos existem.

import { readFileSync } from 'node:fs'
import { formatBRL } from '../src/lib/money.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  checa(nome, ok, ok ? '' : `veio ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L: any = await import('../src/lib/formasDePagamento.ts')
function existe(nome: string): boolean {
  const ok = typeof L[nome] === 'function'
  checa(`existe \`${nome}\``, ok)
  return ok
}

const p = (forma: string, valor: number, troco = 0) => ({ forma, valor_cents: valor, troco_cents: troco })
// Uma linha do retorno em dígitos: forma, aplicado à compra e recebido.
const linha = (forma: string, aplicado: string, recebido = '') =>
  ({ forma, aplicadoDigitos: aplicado, recebidoDigitos: recebido })

const ler = (caminho: string) => readFileSync(new URL(`../${caminho}`, import.meta.url), 'utf8')
// Fiação lê CÓDIGO, nunca prosa (a lição do E4): o comentário que explica a
// regra removida não pode derrubar o teste que impede a volta dela.
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

// ---------------------------------------------------------------------
console.log('\n--- (1) a comparação: forma e valor APLICADO; troco fora ---')
// ---------------------------------------------------------------------
if (existe('situacaoDoPagamento') && existe('realizadoDaLinha')) {
  const situacao = L.situacaoDoPagamento

  igual('previsto igual ao realizado, sem troco → confere',
    situacao([p('dinheiro', 10000)], [p('dinheiro', 10000)]), 'confere')

  // Compra de R$ 100, cliente entrega R$ 200, recebe R$ 100 de troco.
  const nota200 = L.realizadoDaLinha(linha('dinheiro', '10000', '20000'))
  igual('recebido 200 com compra 100 vira aplicado 100 e troco 100', nota200,
    { ok: true, valorCents: 10000, trocoCents: 10000 })
  igual('e isso NÃO diverge do previsto de R$ 100',
    situacao([p('dinheiro', 10000)], [p('dinheiro', nota200.valorCents, nota200.trocoCents)]), 'confere')

  // O cadastro previa troco para R$ 200; o cliente pagou o valor exato.
  const exato = L.realizadoDaLinha(linha('dinheiro', '10000', ''))
  igual('troco previsto, pagamento exato: recebido vazio é troco zero', exato,
    { ok: true, valorCents: 10000, trocoCents: 0 })
  igual('e confere com o previsto que tinha troco',
    situacao([p('dinheiro', 10000, 10000)], [p('dinheiro', 10000, 0)]), 'confere')

  igual('diferença real de valor líquido (90 contra 100) → divergiu',
    situacao([p('dinheiro', 10000)], [p('dinheiro', 9000)]), 'divergiu')
  igual('mudança real de forma (dinheiro → pix) → divergiu',
    situacao([p('dinheiro', 10000)], [p('pix', 10000)]), 'divergiu')

  // O VALE AINDA SEM RETORNO não é divergência: ninguém conferiu nada.
  igual('sem realizado → sem_realizado, não divergiu',
    situacao([p('dinheiro', 10000)], []), 'sem_realizado')
  igual('nem quando também não há previsto', situacao([], []), 'sem_realizado')

  // O HISTÓRICO NÃO É REESCRITO: o V-000063 foi registrado com 200 no valor
  // e 100 no troco. Sob o contrato, isso afirma 200 aplicados — e é a
  // divergência que o servidor gravou. A tela não esconde nem reabre nada.
  igual('o V-000063 continua divergindo como foi gravado',
    situacao([p('dinheiro', 10000)], [p('dinheiro', 20000, 10000)]), 'divergiu')

  checa('troco não entra na chave do gêmeo cliente',
    !L.divergiuDoPrevisto([p('dinheiro', 10000, 10000)], [p('dinheiro', 10000, 0)]))
}

// ---------------------------------------------------------------------
console.log('\n--- (1b) O MISTO: R$ 60 líquidos em dinheiro + R$ 40 em pix ---')
// ---------------------------------------------------------------------
if (existe('situacaoDoPagamento') && existe('realizadoDaLinha') && existe('trocoDoPrevisto')) {
  // O exemplo da decisão de 2026-09-13: compra 100, pix 40, dinheiro 60,
  // "troco para" 100 → troco 40.
  igual('cadastro: troco para 100 sobre a parcela de 60 → troco 40',
    L.trocoDoPrevisto(6000, '10000'), { ok: true, trocoCents: 4000 })

  const pixDoRetorno = L.realizadoDaLinha(linha('pix', '4000'))
  const dinheiroDoRetorno = L.realizadoDaLinha(linha('dinheiro', '6000', '10000'))
  igual('retorno: pix 40 aplicado, sem troco', pixDoRetorno, { ok: true, valorCents: 4000, trocoCents: 0 })
  igual('retorno: dinheiro recebido 100 sobre parcela 60 → 60 líquidos e troco 40',
    dinheiroDoRetorno, { ok: true, valorCents: 6000, trocoCents: 4000 })

  const previsto = [p('pix', 4000), p('dinheiro', 6000, 4000)]
  const realizado = [
    p('dinheiro', dinheiroDoRetorno.valorCents, dinheiroDoRetorno.trocoCents),
    p('pix', pixDoRetorno.valorCents, pixDoRetorno.trocoCents),
  ]
  igual('a conferência reconhece 60 em dinheiro + 40 em pix, sem divergência',
    L.situacaoDoPagamento(previsto, realizado), 'confere')

  // E as diferenças REAIS continuam aparecendo no misto.
  igual('misto com parcela em dinheiro menor (50) → divergiu',
    L.situacaoDoPagamento(previsto, [p('dinheiro', 5000), p('pix', 4000)]), 'divergiu')
  igual('misto que virou tudo pix → divergiu',
    L.situacaoDoPagamento(previsto, [p('pix', 10000)]), 'divergiu')
  checa('misto: recebido menor que a parcela é recusado',
    L.realizadoDaLinha(linha('dinheiro', '6000', '5000')).ok === false)
  igual('misto: parcela paga exata, sem troco',
    L.realizadoDaLinha(linha('dinheiro', '6000', '')), { ok: true, valorCents: 6000, trocoCents: 0 })
}

// ---------------------------------------------------------------------
console.log('\n--- (2) "Troco para" no cadastro ---')
// ---------------------------------------------------------------------
if (existe('trocoDoPrevisto') && existe('trocoParaAplicavel') && existe('indiceDaParcelaEmDinheiro')) {
  const troco = L.trocoDoPrevisto

  igual('campo vazio: não há troco a preparar', troco(10000, ''), { ok: true, trocoCents: 0 })
  igual('compra 100, troco para 200 → troco a levar 100', troco(10000, '20000'),
    { ok: true, trocoCents: 10000 })

  const igualParcela = troco(10000, '10000')
  checa('troco para IGUAL à parcela em dinheiro é recusado', igualParcela.ok === false)
  checa('e a mensagem cita o valor da parcela', !!igualParcela.erro?.includes(formatBRL(10000)),
    JSON.stringify(igualParcela))
  checa('e diz que é a parcela em dinheiro', !!igualParcela.erro?.includes('parcela em dinheiro'),
    JSON.stringify(igualParcela))
  checa('troco para INFERIOR à parcela é recusado', troco(10000, '5000').ok === false)
  checa('misto: troco para igual à parcela de 60 é recusado', troco(6000, '6000').ok === false)
  checa('misto: troco para inferior à parcela de 60 é recusado', troco(6000, '5000').ok === false)
  checa('troco para ZERO é inválido (use o campo vazio)', troco(10000, '0').ok === false)
  checa('sem valor em dinheiro ainda, não calcula troco', troco(0, '20000').ok === false)

  // Alterar a parcela recalcula a partir do mesmo "troco para".
  igual('parcela muda para 150: troco para 200 dá 50', troco(15000, '20000'),
    { ok: true, trocoCents: 5000 })
  checa('parcela muda para 250: o mesmo troco para passa a ser inválido',
    troco(25000, '20000').ok === false)

  const indice = L.indiceDaParcelaEmDinheiro
  igual('só dinheiro: a parcela é a linha 0', indice([{ forma: 'dinheiro' }]), 0)
  igual('pix + dinheiro: a parcela é a linha 1', indice([{ forma: 'pix' }, { forma: 'dinheiro' }]), 1)
  igual('só pix: não há parcela', indice([{ forma: 'pix' }]), null)
  // Dinheiro repetido é recusado pela validação — não existe "a" parcela.
  igual('dinheiro duas vezes: não há uma parcela', indice([{ forma: 'dinheiro' }, { forma: 'dinheiro' }]), null)

  const aplicavel = L.trocoParaAplicavel
  checa('só dinheiro: aplica', aplicavel([{ forma: 'dinheiro' }]) === true)
  checa('só pix: não aplica', aplicavel([{ forma: 'pix' }]) === false)
  checa('misto com dinheiro: APLICA, sobre a parcela (decisão de 2026-09-13)',
    aplicavel([{ forma: 'pix' }, { forma: 'dinheiro' }]) === true)
  checa('misto sem dinheiro: não aplica', aplicavel([{ forma: 'pix' }, { forma: 'debito' }]) === false)
  checa('sem forma: não aplica', aplicavel([]) === false)
}

// ---------------------------------------------------------------------
console.log('\n--- (3) o retorno: recebido, aplicado e troco ---')
// ---------------------------------------------------------------------
if (existe('realizadoDaLinha') && existe('digitosDoRecebidoPrevisto')) {
  const faltou = L.realizadoDaLinha(linha('dinheiro', '10000', '9000'))
  checa('recebido MENOR que o aplicado é recusado — o cálculo não esconde falta',
    faltou.ok === false)
  checa('e a mensagem manda registrar o que entrou', !!faltou.erro?.includes(formatBRL(9000)),
    JSON.stringify(faltou))

  igual('recebido igual ao aplicado → troco zero',
    L.realizadoDaLinha(linha('dinheiro', '10000', '10000')),
    { ok: true, valorCents: 10000, trocoCents: 0 })

  igual('pix não carrega troco, mesmo com dígitos sobrando no estado',
    L.realizadoDaLinha(linha('pix', '10000', '20000')),
    { ok: true, valorCents: 10000, trocoCents: 0 })

  checa('aplicado vazio é recusado',
    L.realizadoDaLinha(linha('dinheiro', '', '20000')).ok === false)

  igual('pré-preenchimento: previsto 100 com troco 100 sugere recebido 200',
    L.digitosDoRecebidoPrevisto(10000, 10000), '20000')
  igual('pré-preenchimento misto: parcela 60 com troco 40 sugere recebido 100',
    L.digitosDoRecebidoPrevisto(6000, 4000), '10000')
  igual('sem troco previsto, o recebido nasce vazio (valor exato)',
    L.digitosDoRecebidoPrevisto(10000, 0), '')
}

// ---------------------------------------------------------------------
console.log('\n--- (3b) FALTA EM DINHEIRO: registrável em um passo, e nunca em silêncio ---')
// ---------------------------------------------------------------------
// Reproduzido em 2026-09-13 no V-000065, depois do relato do usuário ("não
// consegui registrar um valor menor no dinheiro no retorno, apenas no PIX"):
//
//   - recebido 90 com o aplicado pré-preenchido em 100 → recusa, e o caixa
//     precisava descobrir que também tinha de mudar o outro campo;
//   - digitar 90 por cima do aplicado pré-preenchido → R$ 1.000.090,00, porque
//     o campo não selecionava ao focar;
//   - só selecionando e digitando no aplicado a linha ficava válida.
//
// A falta continua sendo DIVERGÊNCIA, e o aplicado não muda sozinho: a tela
// oferece, e o caixa decide.
if (existe('faltaEmDinheiro')) {
  igual('recebido 90 com aplicado 100: a falta sugere aplicar 90',
    L.faltaEmDinheiro(linha('dinheiro', '10000', '9000')), { recebidoCents: 9000, faltaCents: 1000 })
  igual('misto: recebido 50 na parcela de 60 sugere aplicar 50',
    L.faltaEmDinheiro(linha('dinheiro', '6000', '5000')), { recebidoCents: 5000, faltaCents: 1000 })
  igual('recebido igual ao aplicado: não há falta', L.faltaEmDinheiro(linha('dinheiro', '10000', '10000')), null)
  igual('recebido maior (há troco): não há falta', L.faltaEmDinheiro(linha('dinheiro', '10000', '20000')), null)
  igual('recebido vazio (valor exato): não há falta', L.faltaEmDinheiro(linha('dinheiro', '10000', '')), null)
  igual('pix não tem recebido, nem falta a sugerir', L.faltaEmDinheiro(linha('pix', '10000', '9000')), null)

  // Aceitar a sugestão tem que dar uma linha VÁLIDA e DIVERGENTE do previsto.
  const aceita = L.realizadoDaLinha(linha('dinheiro', '9000', '9000'))
  igual('aceitar a sugestão dá aplicado 90 sem troco', aceita, { ok: true, valorCents: 9000, trocoCents: 0 })
  igual('e isso diverge do previsto de 100 — a falta fica registrada',
    L.situacaoDoPagamento([p('dinheiro', 10000)], [p('dinheiro', aceita.valorCents, aceita.trocoCents)]),
    'divergiu')
}
{
  const retorno = semComentarios(ler('src/pages/RetornoCorrida.tsx'))
  const campo = (rotulo: string) => {
    const pos = retorno.indexOf(`aria-label="${rotulo}"`)
    return retorno.slice(Math.max(0, pos - 400), pos)
  }
  checa('"Aplicado à compra" seleciona ao focar (digitar troca, não soma)',
    /selecionaAoFocar/.test(campo('Aplicado à compra')))
  checa('"Recebido em dinheiro" seleciona ao focar',
    /selecionaAoFocar/.test(campo('Recebido em dinheiro')))
  checa('a tela usa `faltaEmDinheiro` para oferecer o registro da falta',
    /faltaEmDinheiro\(/.test(retorno))
  checa('e o botão aplica o recebido pelo mesmo caminho que desfaz a confirmação',
    /alterarLinha\(i,\s*\{\s*aplicadoDigitos:\s*String\(falta\.recebidoCents\)\s*\}\)/.test(retorno))
}

// ---------------------------------------------------------------------
console.log('\n--- (4) fiação: ninguém decide divergência por existência ---')
// ---------------------------------------------------------------------
{
  const tabela = semComentarios(ler('src/components/EntregasTable.tsx'))
  const fechamento = semComentarios(ler('src/data/fechamento.ts'))
  const entregas = semComentarios(ler('src/data/entregas.ts'))

  checa('EntregasTable não usa `formasRealizadas.length > 0`',
    !/formasRealizadas\.length\s*>\s*0/.test(tabela))
  checa('fechamento não usa `formasRealizadas.length > 0`',
    !/formasRealizadas\.length\s*>\s*0/.test(fechamento))
  checa('a lista decide pela situação calculada', /situacaoPagamento\s*===\s*'divergiu'/.test(tabela))
  checa('o fechamento decide pela situação calculada',
    /situacaoPagamento\s*===\s*'divergiu'/.test(fechamento))
  checa('o mapper da lista chama `situacaoDoPagamento`', /situacaoDoPagamento\(/.test(entregas))
  checa('o mapper do fechamento chama `situacaoDoPagamento`', /situacaoDoPagamento\(/.test(fechamento))
  checa('a lista carrega troco dos pagamentos',
    /pagamentos\(forma, momento, valor_cents, troco_cents\)/.test(entregas))

  // A MESMA PREMISSA em qualquer outro lugar de src/.
  const suspeitos = [
    'src/pages/Fechamento.tsx',
    'src/pages/RetornoCorrida.tsx',
    'src/components/NotificarOcorrenciaDialog.tsx',
    'src/data/notificacoes.ts',
    'src/data/relatorios.ts',
  ]
  for (const arquivo of suspeitos) {
    const fonte = semComentarios(ler(arquivo))
    checa(`${arquivo} não trata existência de realizado como divergência`,
      !/(formasRealizadas|realizados)\.length\s*>\s*0/.test(fonte))
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (5) fiação: o troco atravessa cadastro, fila e retorno ---')
// ---------------------------------------------------------------------
{
  const cadastro = semComentarios(ler('src/pages/CadastroEntrega.tsx'))
  const entregas = semComentarios(ler('src/data/entregas.ts'))
  const pagamentos = semComentarios(ler('src/data/pagamentos.ts'))
  const retorno = semComentarios(ler('src/pages/RetornoCorrida.tsx'))
  const lib = semComentarios(ler('src/lib/formasDePagamento.ts'))

  checa('o cadastro calcula pelo `trocoDoPrevisto`', /trocoDoPrevisto\(/.test(cadastro))
  checa('o cadastro manda `trocoCents` em cada forma prevista', /trocoCents:/.test(cadastro))
  checa('o cadastro mostra "Troco para"', /Troco para/.test(cadastro))
  checa('e "Troco a levar"', /Troco a levar/.test(cadastro))
  checa('o cadastro acha a parcela em dinheiro pela lib',
    /indiceDaParcelaEmDinheiro\(/.test(cadastro))
  checa('e grava o troco NA LINHA da parcela, não na primeira',
    !/i === 0 \? resultadoTroco/.test(cadastro) && /i === indiceDinheiro/.test(cadastro))
  // Sem valor escondido: toda mudança de formas passa por um lugar que
  // limpa o troco quando ele deixa de se aplicar.
  checa('as formas mudam por um único caminho que limpa o troco',
    /function mudarFormas\(/.test(cadastro) &&
      (cadastro.match(/setFormas\(\(prev\)/g) ?? []).length === 0)

  checa('`criarEntrega` repassa o troco ao previsto (tolerando fila antiga)',
    /trocoCents:\s*forma\.trocoCents\s*\?\?\s*0/.test(entregas))
  checa('`criarPagamentoPrevisto` grava `troco_cents`', /troco_cents:\s*input\.trocoCents/.test(pagamentos))

  checa('o retorno converte cada linha por `realizadoDaLinha`', /realizadoDaLinha\(/.test(retorno))
  checa('o retorno pré-preenche o recebido pelo previsto', /digitosDoRecebidoPrevisto\(/.test(retorno))
  checa('o retorno não lê mais o troco cru no payload',
    !/trocoCents:\s*linha\.trocoDigitos\s*\?\s*centsFromDigits/.test(retorno))
  // O PROVISÓRIO SAIU: não existe mais troco digitado à mão nem modo "misto".
  checa('o retorno não tem mais troco digitado à mão', !/trocoDigitos/.test(retorno))
  checa('nem a lib', !/trocoDigitos|trocoCalculado/.test(lib))
  checa('rótulo "Aplicado à compra"', /Aplicado à compra/.test(retorno))
  checa('rótulo "Recebido em dinheiro"', /Recebido em dinheiro/.test(retorno))
  checa('rótulo "Troco devolvido"', /Troco devolvido/.test(retorno))

  // A PREVISÃO NÃO É COMPROVAÇÃO: o pagamento pré-preenchido só vira
  // documento depois de alguém confirmar, e corrigir desfaz a confirmação.
  checa('o retorno exige confirmar o pagamento', /pagamentoConfirmado/.test(retorno))
  checa('e recusa congelar sem a confirmação',
    /!p\.pagamentoConfirmado/.test(retorno))
  checa('e corrigir uma linha desfaz a confirmação',
    (retorno.match(/pagamentoConfirmado:\s*false/g) ?? []).length >= 3)
}

// ---------------------------------------------------------------------
console.log('\n--- (6) o gêmeo do servidor compara sem troco ---')
// ---------------------------------------------------------------------
{
  // A definição VIGENTE de `selar_romaneio_retorno_interno` é a da migration
  // mais recente que a redefine. A comparação tem que continuar sendo
  // forma|valor_cents dos dois lados — troco somado ou subtraído ali
  // misturaria bruto com líquido. O misto não muda isto: a parcela líquida
  // em dinheiro é a chave `dinheiro|6000` nos dois gêmeos.
  const sql = ler('supabase/migrations/20260912120000_selo_do_retorno_versao_2.sql')
  const inicio = sql.indexOf("if v_desfecho = 'entregue' then")
  const fim = sql.indexOf('v_divergiu := v_previsto is distinct from v_realizado;')
  const bloco = sql.slice(inicio, fim)
  checa('achei o bloco da comparação', inicio > 0 && fim > inicio)
  checa('previsto agregado por forma|valor_cents', /pg\.forma \|\| '\|' \|\| pg\.valor_cents/.test(bloco))
  checa("realizado agregado por forma|valor_cents",
    /\(p\.value ->> 'forma'\) \|\| '\|' \|\| \(p\.value ->> 'valor_cents'\)/.test(bloco))
  checa('e troco não entra na comparação', !/troco/.test(bloco))

  const lib = ler('src/lib/formasDePagamento.ts')
  const corpo = lib.slice(lib.indexOf('export function divergiuDoPrevisto'))
  // SEM COMENTÁRIOS: o comentário dentro da função explica justamente que o
  // troco não entra, e ler a prosa acusaria o código certo.
  const chave = semComentarios(corpo.slice(0, corpo.indexOf('\n}')))
  checa('o gêmeo cliente usa a mesma chave', /`\$\{f\.forma\}\|\$\{f\.valor_cents\}`/.test(chave))
  checa('e também sem troco', !/troco/.test(chave))
}

console.log(falhas === 0 ? '\ntroco e divergência ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
