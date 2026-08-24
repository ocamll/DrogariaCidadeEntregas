// npx tsx scripts/corridas-bloqueadas.spec.mts
//
// A 2C.7: qual corrida a tela do retorno NÃO oferece.
//
// Roda sem navegador porque `src/lib/corridasBloqueadas.ts` não importa
// nada. A regra decide o que aparece na tela, e regra de tela que só se
// mede clicando não se mede.

import {
  corridasComFechamentoLegadoPendente,
  filtrarCorridasRetornaveis,
  type ItemDeFilaObservado,
} from '../src/lib/corridasBloqueadas.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const EU = 'user-a'
const A = 'corrida-a'
const B = 'corrida-b'
const corridas = [{ id: A, motoboy: 'João' }, { id: B, motoboy: 'Pedro' }]
const ids = (lista: Array<{ id: string }>) => lista.map((c) => c.id)

function fechamento(over: Partial<ItemDeFilaObservado> & { corridaId?: string } = {}) {
  const { corridaId = A, ...resto } = over
  return {
    tipo: 'fechamento_corrida',
    status: 'pendente',
    userId: EU,
    payload: { corridaId },
    ...resto,
  } as ItemDeFilaObservado
}

console.log('\n--- os seis casos do contrato ---')
{
  // 1
  checa(
    '(1) fechamento pendente da corrida A → A não é oferecida',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [fechamento()], EU))) ===
      JSON.stringify([B])
  )

  // 2
  checa(
    '(2) fechamento pendente da corrida B → A continua oferecida',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [fechamento({ corridaId: B })], EU))) ===
      JSON.stringify([A])
  )

  // 3
  checa(
    '(3) fechamento da corrida A já TERMINAL → A continua oferecida',
    JSON.stringify(
      ids(filtrarCorridasRetornaveis(corridas, [fechamento({ status: 'terminal' })], EU))
    ) === JSON.stringify([A, B])
  )

  // 4
  checa(
    '(4) fechamento de OUTRO dono → não bloqueia A',
    JSON.stringify(
      ids(filtrarCorridasRetornaveis(corridas, [fechamento({ userId: 'user-b' })], EU))
    ) === JSON.stringify([A, B])
  )

  // 5
  checa(
    '(5) romaneio_saida com chave = corridaId NÃO entra nesta regra',
    JSON.stringify(
      ids(
        filtrarCorridasRetornaveis(
          corridas,
          [{ tipo: 'romaneio_saida', status: 'pendente', userId: EU, payload: { corridaId: A } }],
          EU
        )
      )
    ) === JSON.stringify([A, B]),
    'quem ordena saída × retorno é o dependeDeChave da 2C.3'
  )

  // 6
  checa(
    '(6) fila vazia → a lista não muda',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [], EU))) === JSON.stringify([A, B])
  )
}

console.log('\n--- (7) pureza ---')
{
  const item = fechamento()
  const antesCorridas = JSON.stringify(corridas)
  const antesItem = JSON.stringify(item)

  const um = filtrarCorridasRetornaveis(corridas, [item], EU)
  const dois = filtrarCorridasRetornaveis(corridas, [item], EU)

  checa('mesma entrada → mesma lista', JSON.stringify(um) === JSON.stringify(dois))
  checa('não mutou as corridas de entrada', JSON.stringify(corridas) === antesCorridas)
  checa('não mutou o item da fila', JSON.stringify(item) === antesItem)
  checa('devolve array NOVO', um !== (corridas as unknown as typeof um))
}

console.log('\n--- o que a leitura ingênua do contrato perderia ---')
{
  // `bloqueado` NÃO é fim de linha: o laço da fila o ressuscita pra
  // `pendente` assim que o dono entra. Uma lista de status "ativos" que
  // esquecesse dele ofereceria uma corrida que vai ser fechada na
  // próxima rodada.
  checa(
    'status `bloqueado` do dono atual AINDA bloqueia',
    JSON.stringify(
      ids(filtrarCorridasRetornaveis(corridas, [fechamento({ status: 'bloqueado' })], EU))
    ) === JSON.stringify([B]),
    'o laço ressuscita bloqueado → pendente quando o dono entra'
  )
  checa(
    'status `erro` bloqueia (vai retentar)',
    JSON.stringify(
      ids(filtrarCorridasRetornaveis(corridas, [fechamento({ status: 'erro' })], EU))
    ) === JSON.stringify([B])
  )

  // `userId` vazio é item herdado da v2 do banco local. O laço da fila
  // deixa item sem dono sincronizar sob QUALQUER sessão — então ele
  // escreve, então ele bloqueia.
  checa(
    'item legado SEM DONO bloqueia, porque roda sob qualquer sessão',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [fechamento({ userId: '' })], EU))) ===
      JSON.stringify([B]),
    'espelha `if (item.userId && item.userId !== usuario)` do laço'
  )
}

console.log('\n--- bordas ---')
{
  checa(
    'payload sem corridaId não bloqueia ninguém',
    JSON.stringify(
      ids(filtrarCorridasRetornaveis(corridas, [fechamento({ payload: {} })], EU))
    ) === JSON.stringify([A, B]),
    'malformado não vira bloqueio por aproximação'
  )
  checa(
    'dois itens da mesma corrida contam uma vez',
    corridasComFechamentoLegadoPendente([fechamento(), fechamento()], EU).size === 1
  )
  checa(
    'os dois bloqueados de uma vez',
    filtrarCorridasRetornaveis(corridas, [fechamento(), fechamento({ corridaId: B })], EU)
      .length === 0
  )
}

console.log(falhas === 0 ? '\ncorridas bloqueadas ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
