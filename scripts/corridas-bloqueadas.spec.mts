// npx tsx scripts/corridas-bloqueadas.spec.mts
//
// Qual corrida a tela do retorno NÃO oferece.
//
// Roda sem navegador porque `src/lib/corridasBloqueadas.ts` não importa
// nada. A regra decide o que aparece na tela, e regra de tela que só se
// mede clicando não se mede.
//
// ---------------------------------------------------------------------
// ESTE ARQUIVO ENCOLHEU EM 2026-08-25
//
// Ele tinha duas metades: `fechamento_corrida` legado (a 2C.7) e
// `romaneio_retorno` pendente. A primeira saiu junto com o tipo, no
// corte pré-V1 — não havia mais o que ela pudesse encontrar.
//
// A que ficou nunca foi sobre compatibilidade, e por isso não tem prazo:
// `UNIQUE (corrida_id, tipo)` garante que só UM romaneio de retorno pode
// ser selado por corrida. Oferecer a corrida de novo custaria duas
// assinaturas para produzir um conflito.

import {
  corridasComRetornoPendente,
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

function retorno(over: Partial<ItemDeFilaObservado> & { corridaId?: string } = {}) {
  const { corridaId = A, ...resto } = over
  return {
    tipo: 'romaneio_retorno',
    status: 'pendente',
    userId: EU,
    payload: { corridaId },
    ...resto,
  } as ItemDeFilaObservado
}

console.log('\n--- o contrato ---')
{
  checa(
    '(1) retorno pendente da corrida A → A não é oferecida',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [retorno()]))) === JSON.stringify([B])
  )
  checa(
    '(2) retorno pendente da corrida B → A continua oferecida',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [retorno({ corridaId: B })]))) ===
      JSON.stringify([A])
  )
  checa(
    '(3) fila vazia → a lista não muda',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, []))) === JSON.stringify([A, B])
  )
  checa(
    '(4) os dois bloqueados de uma vez',
    filtrarCorridasRetornaveis(corridas, [retorno(), retorno({ corridaId: B })]).length === 0
  )
  checa(
    '(5) dois itens da mesma corrida contam uma vez',
    corridasComRetornoPendente([retorno(), retorno()]).size === 1
  )
}

console.log('\n--- o que a leitura ingênua perderia ---')
{
  // `bloqueado` NÃO é fim de linha: o laço da fila o ressuscita pra
  // `pendente` assim que o dono entra. Uma lista de status "ativos" que
  // esquecesse dele ofereceria uma corrida que vai ser fechada na
  // próxima rodada.
  checa(
    'status `bloqueado` AINDA bloqueia',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [retorno({ status: 'bloqueado' })]))) ===
      JSON.stringify([B]),
    'o laço ressuscita bloqueado → pendente quando o dono entra'
  )
  checa(
    'status `erro` bloqueia (vai retentar)',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [retorno({ status: 'erro' })]))) ===
      JSON.stringify([B])
  )
  checa(
    '`terminal` NÃO bloqueia',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [retorno({ status: 'terminal' })]))) ===
      JSON.stringify([A, B]),
    'foi recusado em definitivo; a corrida precisa voltar a ser fechável'
  )

  // A DECISÃO QUE ESTE CASO EXISTE PRA CONGELAR.
  //
  // O dono do item NÃO importa. Um retorno de outra sessão já é um
  // documento assinado pelas duas partes, e `UNIQUE (corrida_id, tipo)`
  // deixa só um ser selado — não interessa quem vai fazê-lo subir.
  //
  // Isto foi decidido em oposição à regra do `fechamento_corrida`, que
  // olhava o dono porque NÃO era documento. Aquela regra não existe
  // mais; este caso guarda o porquê, que é o que sobreviveria a alguém
  // "uniformizar" as duas se elas voltassem a coexistir.
  checa(
    'retorno de OUTRO dono AINDA bloqueia',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [retorno({ userId: 'user-b' })]))) ===
      JSON.stringify([B]),
    'documento assinado bloqueia independentemente de quem sincroniza'
  )
  checa(
    'e item legado SEM DONO também',
    JSON.stringify(ids(filtrarCorridasRetornaveis(corridas, [retorno({ userId: '' })]))) ===
      JSON.stringify([B])
  )
}

console.log('\n--- bordas ---')
{
  checa(
    'payload sem corridaId não bloqueia ninguém',
    corridasComRetornoPendente([retorno({ payload: {} })]).size === 0,
    'malformado não vira bloqueio por aproximação'
  )
  checa(
    'outro tipo de operação não entra nesta regra',
    corridasComRetornoPendente([
      { tipo: 'romaneio_saida', status: 'pendente', userId: EU, payload: { corridaId: A } },
    ]).size === 0,
    'quem ordena saída × retorno é o dependeDeChave da 2C.3'
  )
}

console.log('\n--- pureza ---')
{
  const item = retorno()
  const antesCorridas = JSON.stringify(corridas)
  const antesItem = JSON.stringify(item)

  const um = filtrarCorridasRetornaveis(corridas, [item])
  const dois = filtrarCorridasRetornaveis(corridas, [item])

  checa('mesma entrada → mesma lista', JSON.stringify(um) === JSON.stringify(dois))
  checa('não mutou as corridas de entrada', JSON.stringify(corridas) === antesCorridas)
  checa('não mutou o item da fila', JSON.stringify(item) === antesItem)
  checa('devolve array NOVO', um !== (corridas as unknown as typeof um))
}

console.log(falhas === 0 ? '\ncorridas bloqueadas ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
