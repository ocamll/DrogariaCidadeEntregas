// npx tsx scripts/pagamento-alterado.spec.mts
//
// O GATE DO E3.A — os leitores do evento `pagamento_alterado` sabem ler
// as DUAS formas antes de alguém escrever a nova.
//
// A ordem é reader-first, e ela é do contrato:
//
//     E3.A  os leitores aceitam string (histórico) e lista (nova)
//     E3.B  o SQL passa a ESCREVER lista
//     E3.C  o cliente passa a cunhar id próprio do previsto
//
// É o princípio de protocolo distribuído: primeiro todo mundo aprende a
// LER o formato novo; só depois alguém começa a escrevê-lo. Inverter a
// ordem faria um cliente antigo — inclusive a `main` — receber um
// payload que ele não sabe interpretar, e o sintoma apareceria numa tela
// de auditoria, que é onde menos se pode errar.
//
// `eventos` é append-only (regra 6): os eventos antigos NUNCA vão ser
// reescritos. Então isto não é janela de compatibilidade como a da fila
// — é o histórico, e a leitura das duas formas é permanente.

import {
  formasDoEvento,
  textoDoPagamentoAlterado,
  type LadoDoPagamentoAlterado,
} from '../src/lib/formasDePagamento.ts'
import { formatBRL } from '../src/lib/money.ts'

// O DINHEIRO É FORMATADO PELO MESMO `formatBRL` que o app usa, e não
// digitado à mão: `toLocaleString('pt-BR')` põe um ESPAÇO NÃO-QUEBRÁVEL
// (U+00A0) depois do "R$". Escrevendo "R$ 10,00" com espaço comum, o
// teste falha mostrando duas strings visualmente idênticas — foi o que
// aconteceu na primeira rodada. É o invisível do §84 outra vez.
const brl = (cents: number) => formatBRL(cents)

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
function igual(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  checa(nome, ok, ok ? '' : `veio ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`)
}

// ---------------------------------------------------------------------
console.log('\n--- (1) a forma LEGADA: string única, sem valor ---')
// ---------------------------------------------------------------------
{
  // É o que está gravado hoje em todo evento do banco, dos dois lados
  // até o E3.B e do lado `de` até sempre, para os que já existem.
  igual('string vira uma forma só', formasDoEvento('pix').length, 1)
  igual('e o texto é só o rótulo', textoDoPagamentoAlterado('pix'), 'Pix')
  igual('outra forma', textoDoPagamentoAlterado('dinheiro'), 'Dinheiro')

  // O VALOR NÃO É INVENTADO. A string legada não carrega valor, e
  // fabricar um faria o Registro de Auditoria afirmar um número que
  // ninguém gravou — o defeito que este projeto já pagou três vezes.
  checa('e o valor legado é marcado como AUSENTE', formasDoEvento('pix')[0].valor_cents < 0)
  checa('não aparece "R$" no texto legado', !textoDoPagamentoAlterado('pix').includes('R$'))
}

// ---------------------------------------------------------------------
console.log('\n--- (2) a forma NOVA: lista com valor ---')
// ---------------------------------------------------------------------
{
  const lista: LadoDoPagamentoAlterado = [
    { forma: 'pix', valor_cents: 1000 },
    { forma: 'dinheiro', valor_cents: 500 },
  ]
  igual('duas formas', formasDoEvento(lista).length, 2)
  igual('texto junta com +', textoDoPagamentoAlterado(lista),
    `Pix (${brl(1000)}) + Dinheiro (${brl(500)})`)
  igual('lista de uma só', textoDoPagamentoAlterado([{ forma: 'credito', valor_cents: 250 }]),
    `Crédito (${brl(250)})`)
}

// ---------------------------------------------------------------------
console.log('\n--- (3) os dois lados, e o caso REAL da transição ---')
// ---------------------------------------------------------------------
{
  // Depois do E3.B o `de` passa a ser lista. Mas um evento gravado ANTES
  // dele tem `de` string e `para` lista — e essa mistura é o que mais vai
  // existir no banco durante a janela. Se o leitor não aceitasse os dois
  // independentes, ele quebraria justamente no caso mais comum.
  const de: LadoDoPagamentoAlterado = 'dinheiro'
  const para: LadoDoPagamentoAlterado = [
    { forma: 'debito', valor_cents: 10000 },
    { forma: 'dinheiro', valor_cents: 20000 },
  ]
  igual('lado `de` legado', textoDoPagamentoAlterado(de), 'Dinheiro')
  igual('lado `para` novo', textoDoPagamentoAlterado(para),
    `Débito (${brl(10000)}) + Dinheiro (${brl(20000)})`)

  // E o inverso, que passa a existir depois do E3.B + E4.
  igual('os DOIS lados novos',
    textoDoPagamentoAlterado([{ forma: 'pix', valor_cents: 900 }]) + ' → ' +
      textoDoPagamentoAlterado([{ forma: 'crediario', valor_cents: 900 }]),
    `Pix (${brl(900)}) → Crediário (${brl(900)})`)
}

// ---------------------------------------------------------------------
console.log('\n--- (4) ausência: o `jsonb_agg` devolve null sem previsto ---')
// ---------------------------------------------------------------------
{
  // Decisão do contrato: NÃO inventar `[]`. O escalar de hoje também
  // acaba em `null` quando não há previsto, então a forma nova preserva
  // o mesmo fato em vez de fabricar uma lista vazia que pareceria "havia
  // previsto, e ele estava vazio".
  igual('null vira lista vazia na leitura', formasDoEvento(null).length, 0)
  igual('undefined idem', formasDoEvento(undefined).length, 0)
  igual('e o texto é um traço, não "undefined"', textoDoPagamentoAlterado(null), '—')
  igual('nem string vazia', textoDoPagamentoAlterado(undefined), '—')
}

// ---------------------------------------------------------------------
console.log('\n--- (5) forma desconhecida não quebra a tela ---')
// ---------------------------------------------------------------------
{
  // O CHECK de `forma` já mudou uma vez no banco (`vale` saiu, `convcard`
  // e `crediario` entraram — §64), e o schema inicial ficou desatualizado
  // por doze dias sem ninguém notar. Um evento antigo com uma forma que
  // não existe mais no enum precisa aparecer como ELA MESMA, não sumir.
  igual('forma fora do enum sai crua',
    textoDoPagamentoAlterado('vale' as never), 'vale')
  igual('e dentro de lista também',
    textoDoPagamentoAlterado([{ forma: 'vale' as never, valor_cents: 900 }]), `vale (${brl(900)})`)
}

// ---------------------------------------------------------------------
console.log('\n--- (6) a normalização mora num lugar só ---')
// ---------------------------------------------------------------------
{
  // `notificacoes.ts` e `auditoria.ts` tinham a MESMA lógica copiada.
  // Fazer o `de` do mesmo jeito daria quatro cópias, e a quarta seria a
  // que envelhece. Este caso afirma que os dois chamam o helper.
  const { readFileSync } = await import('node:fs')
  const semComentarios = (f: string) =>
    readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  for (const arquivo of ['src/data/notificacoes.ts', 'src/data/auditoria.ts']) {
    const corpo = semComentarios(arquivo)
    checa(`${arquivo} usa o helper`, /textoDoPagamentoAlterado\(/.test(corpo))
    // A regex mira o payload do PAGAMENTO, e não qualquer `Array.isArray`:
    // `auditoria.ts` tem um legítimo, no `conflito_sincronizacao`, e a
    // primeira versão deste caso o acusou junto.
    checa(`${arquivo} não refaz a normalização do pagamento à mão`,
      !/Array\.isArray\((payload\.(de|para)|paraRaw)/.test(corpo))
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (7) E3.C — o id do previsto vem do PAYLOAD, nunca de dentro ---')
// ---------------------------------------------------------------------
{
  // Esta é uma afirmação sobre o CÓDIGO, não sobre execução: "o id é
  // cunhado antes de enfileirar" não dá pra provar chamando função. Mesmo
  // método de `fiacao-texto.spec.mts`.
  //
  // O que está em jogo é a idempotência do reenvio.
  // `criarPagamentoPrevisto` insere e trata `23505` como sucesso, e isso
  // só funciona se o id for O MESMO a cada tentativa. Cunhado dentro da
  // função, cada reenvio criaria um previsto novo — e a fila reenvia
  // sempre que a rede oscila.
  const { readFileSync } = await import('node:fs')
  const ler = (f: string) => readFileSync(f, 'utf8')

  const pagamentos = ler('src/data/pagamentos.ts')
  checa('`criarPagamentoPrevisto` EXIGE o id', /^\s{2}id: string$/m.test(pagamentos))
  checa('e não o cunha lá dentro',
    !/criarPagamentoPrevisto[\s\S]{0,600}?uuidv7\(\)/.test(pagamentos))

  const entregas = ler('src/data/entregas.ts')
  checa('`NovaEntrega` carrega `pagamentoPrevistoId`',
    /pagamentoPrevistoId: string/.test(entregas))
  // A janela: item enfileirado antes do E3.C não traz o campo, e a
  // ausência significa "legado" — igual à do `tipo` no envelope (2C.5).
  checa('e `criarEntrega` tolera a ausência (fila antiga)',
    /pagamentoPrevistoId \?\? input\.id/.test(entregas))
  checa('idem no previsto retroativo da divergência',
    /pagamentoPrevistoId \?\? input\.entregaId/.test(pagamentos))

  const cadastro = ler('src/pages/CadastroEntrega.tsx')
  checa('a tela cunha um id SEPARADO do da entrega',
    /const \[pagamentoPrevistoId, setPagamentoPrevistoId\] = useState\(\(\) => uuidv7\(\)\)/.test(cadastro))
  checa('e recicla os dois juntos no reset',
    /setId\(uuidv7\(\)\)\s*\n\s*setPagamentoPrevistoId\(uuidv7\(\)\)/.test(cadastro))

  // E o que NÃO pode voltar: o id derivado da entrega. É ele que fazia
  // duas formas previstas colidirem na PK — a segunda batia no `23505`,
  // era tratada como sucesso, e sumia em silêncio.
  checa('nenhum chamador deriva o id do previsto da entrega',
    !/criarPagamentoPrevisto\(\{\s*\n\s*id: input\.(id|entregaId),/.test(entregas + pagamentos))
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
