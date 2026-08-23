// npx tsx scripts/dependencia-da-fila.spec.mts
//
// A dependência entre itens da fila offline. Roda sem navegador e sem
// rede porque `src/lib/dependenciaDaFila.ts` não importa nada — é o que
// permite medir a regra em vez de deixar `processarFilaOperacoes` rodar
// de verdade e observar qual operação foi pulada.
//
// OS DOIS PRIMEIROS CASOS MEDEM COISAS DIFERENTES E NENHUM SUBSTITUI O
// OUTRO, que é a razão de o usuário ter pedido os dois separados:
//
//   A  item com chave X e dependeDeChave X não se bloqueia por si só
//   B  outro item com chave X bloqueia corretamente
//
// Sem o B, uma "correção" que simplesmente desligasse o bloqueio inteiro
// (`return false` sempre) passaria no A com louvor — e a fila voltaria a
// deixar o fechamento de corrida ultrapassar a criação dela, que é o bug
// que a dependência existe pra impedir desde 16/08.

import { bloqueadoPorDependencia } from '../src/lib/dependenciaDaFila.ts'

let falhas = 0
function check(ok: boolean, nome: string) {
  if (!ok) falhas++
  console.log(`${ok ? 'ok    ' : 'FALHA '} ${nome}`)
}

const CORRIDA = '01a01564-761e-71fa-8e3f-9e6e2a50b0f3'

console.log('\n--- A. self-dependency não existe ---')
{
  // O caso que deixava um item `pendente`, `tentativas` em 0, sem erro
  // escrito nele, para sempre (§50.4).
  const solitario = { id: 'f1', chave: CORRIDA, dependeDeChave: CORRIDA }
  check(
    bloqueadoPorDependencia(solitario, [solitario]) === false,
    'item com chave X e dependeDeChave X não se bloqueia por si próprio'
  )

  // E continua não se bloqueando com outros itens irrelevantes por perto.
  const ruido = { id: 'f2', chave: 'outra-corrida' }
  check(
    bloqueadoPorDependencia(solitario, [solitario, ruido]) === false,
    'nem quando há outros itens na fila com chaves diferentes'
  )
}

console.log('\n--- B. dependência entre itens DIFERENTES continua valendo ---')
{
  const saida = { id: 'f1', chave: CORRIDA }
  const retorno = { id: 'f2', dependeDeChave: CORRIDA }

  check(
    bloqueadoPorDependencia(retorno, [saida, retorno]) === true,
    'A depende de X e B carrega a chave X → A fica bloqueado'
  )
  check(
    bloqueadoPorDependencia(retorno, [retorno]) === false,
    'saiu o item que carregava a chave → A destrava'
  )

  // O caso que a 2C.3 veio habilitar: o retorno declara SÓ
  // `dependeDeChave`, e espera tanto a saída quanto o fechamento legado
  // — os dois carregam `chave = corridaId`.
  const fechamentoLegado = { id: 'f3', chave: CORRIDA, dependeDeChave: CORRIDA }
  check(
    bloqueadoPorDependencia(retorno, [retorno, fechamentoLegado]) === true,
    'o fechamento legado com chave backfillada também segura o retorno'
  )
  check(
    bloqueadoPorDependencia(fechamentoLegado, [retorno, fechamentoLegado]) === false,
    'e o fechamento legado não se prende, apesar de declarar as duas'
  )
}

console.log('\n--- bordas ---')
{
  check(
    bloqueadoPorDependencia({ id: 'f1' }, [{ id: 'f1' }, { id: 'f2', chave: CORRIDA }]) === false,
    'item sem dependeDeChave nunca é bloqueado'
  )
  // `undefined === undefined` seria `true` num `some` ingênuo: item sem
  // dependência bloqueado por qualquer item sem chave. O early return
  // fecha isso, e este caso é quem prova.
  check(
    bloqueadoPorDependencia({ id: 'f1' }, [{ id: 'f2' }]) === false,
    'item sem chave não bloqueia item sem dependência (undefined vs undefined)'
  )
  check(
    bloqueadoPorDependencia({ id: 'f1', dependeDeChave: CORRIDA }, []) === false,
    'fila vazia não bloqueia ninguém'
  )
}

console.log(
  falhas === 0
    ? '\ndependência da fila ok\n'
    : `\n${falhas} FALHA(S)\n`
)
process.exit(falhas === 0 ? 0 : 1)
