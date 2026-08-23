// NÃO roda com node. Cole no console do navegador (F12 → Console), com
// o app aberto. NÃO precisa estar logado: isto não fala com o servidor.
//
// ---------------------------------------------------------------------
// O QUE ELE PROVA
//
// O upgrade da Dexie v4 → v5, contra IndexedDB DE VERDADE. É o ponto que
// protege quem tem fila antiga guardada no navegador:
//
//     v4: fechamento_corrida, chave = undefined, payload.corridaId = X
//         ↓ upgrade
//     v5: chave === X, e mais nada mudou
//
// Um dublê de banco provaria a função e não o acoplamento com a Dexie,
// que é metade do mecanismo — a mesma razão pela qual o teste do aviso
// de sincronização (§62) roda contra o IndexedDB real.
//
// ---------------------------------------------------------------------
// EM BANCO SEPARADO, E ISSO IMPORTA
//
// Ele cria `tele-entregas-conferencia-2c3`, mexe só nele e o APAGA no
// fim. A fila de verdade não é tocada em momento nenhum — semear o banco
// do app com item falso de `fechamento_corrida` seria pedir pra que ele
// tentasse fechar uma corrida inexistente no próximo sync.
//
// O que ele NÃO isola é a função de backfill: essa é a de produção,
// importada de `/src/lib/db.ts`. Uma cópia aqui provaria a cópia.
// ---------------------------------------------------------------------

{
const { db, backfillChaveDoFechamentoLegado } = await import('/src/lib/db.ts')

// O construtor sai da instância que o app já abriu, em vez de
// `import('/node_modules/.vite/deps/dexie.js')` — aquele caminho precisa
// do `?v=<hash>` e carrega uma SEGUNDA instância quando o hash muda
// (§61). Assim não há hash pra acertar.
const Dexie = db.constructor

const NOME = 'tele-entregas-conferencia-2c3'
const CORRIDA = '01a01564-761e-71fa-8e3f-9e6e2a50b0f3'
const STORES = 'id, status, tipo, userId, chave, proximaTentativaEm'

const linhas = []
const check = (ok, nome, detalhe) => linhas.push({ ok, caso: nome, detalhe: detalhe ?? '' })

await Dexie.delete(NOME)

// ---------------------------------------------------------------------
// 1. UM BANCO NA v4, com os quatro casos que o backfill tem que separar
// ---------------------------------------------------------------------
const base = {
  userId: 'u1',
  tenantId: 't1',
  lojaId: 'l1',
  status: 'erro',
  criadoEm: '2026-08-19T10:00:00.000Z',
  tentativas: 3,
  proximaTentativaEm: '2026-08-19T10:05:00.000Z',
  erro: 'falhou antes do upgrade',
}

const antigo = new Dexie(NOME)
antigo.version(4).stores({ filaOperacoes: STORES, credenciaisCache: 'publicId, motoboyId' })
await antigo.open()
await antigo.table('filaOperacoes').bulkPut([
  // o caso que motiva o upgrade
  { ...base, id: 'legado-ok', tipo: 'fechamento_corrida',
    dependeDeChave: CORRIDA,
    payload: { corridaId: CORRIDA, tenantId: 't1', entregas: [{ entregaId: 'e1' }] } },
  // malformado: preservar, não inventar chave e não apagar
  { ...base, id: 'legado-torto', tipo: 'fechamento_corrida',
    payload: { tenantId: 't1', entregas: [] } },
  // já tem chave: não pode ser tocado
  { ...base, id: 'ja-tem-chave', tipo: 'fechamento_corrida', chave: 'chave-antiga',
    payload: { corridaId: CORRIDA } },
  // outro tipo: o backfill não reinterpreta nada além do alvo
  { ...base, id: 'outro-tipo', tipo: 'romaneio_saida',
    payload: { corridaId: CORRIDA } },
])
const antesDoUpgrade = await antigo.table('filaOperacoes').get('legado-ok')
antigo.close()

// ---------------------------------------------------------------------
// 2. ABRE NA v5, com o MESMO upgrade que o app declara
// ---------------------------------------------------------------------
const novo = new Dexie(NOME)
novo.version(4).stores({ filaOperacoes: STORES, credenciaisCache: 'publicId, motoboyId' })
novo.version(5)
  .stores({ filaOperacoes: STORES, credenciaisCache: 'publicId, motoboyId' })
  .upgrade((tx) => backfillChaveDoFechamentoLegado(tx.table('filaOperacoes')))
await novo.open()

check(novo.verno === 5, 'o banco subiu pra v5', `verno=${novo.verno}`)

const depois = Object.fromEntries(
  (await novo.table('filaOperacoes').toArray()).map((i) => [i.id, i])
)

// ---------------------------------------------------------------------
// 3. O QUE O BACKFILL FEZ, E O QUE ELE NÃO PODE TER FEITO
// ---------------------------------------------------------------------
check(depois['legado-ok']?.chave === CORRIDA,
  'legado bem formado ganhou chave = payload.corridaId',
  `chave=${depois['legado-ok']?.chave}`)

// "payload intacto" comparado por JSON, e não campo a campo: se o
// upgrade tivesse recalculado ou normalizado qualquer coisa lá dentro,
// uma checagem de um campo só não veria.
check(JSON.stringify(depois['legado-ok']?.payload) === JSON.stringify(antesDoUpgrade.payload),
  'payload intacto, byte a byte')

check(depois['legado-ok']?.status === 'erro'
   && depois['legado-ok']?.tentativas === 3
   && depois['legado-ok']?.erro === base.erro
   && depois['legado-ok']?.criadoEm === base.criadoEm
   && depois['legado-ok']?.proximaTentativaEm === base.proximaTentativaEm,
  'status, tentativas, erro e os dois relógios intactos',
  `status=${depois['legado-ok']?.status} tentativas=${depois['legado-ok']?.tentativas}`)

check(depois['legado-torto'] !== undefined && depois['legado-torto'].chave === undefined,
  'malformado PRESERVADO e sem chave inventada',
  `existe=${depois['legado-torto'] !== undefined} chave=${depois['legado-torto']?.chave}`)

check(depois['ja-tem-chave']?.chave === 'chave-antiga',
  'item que já tinha chave não foi tocado')

check(depois['outro-tipo']?.chave === undefined,
  'outro tipo não foi reinterpretado')

check(Object.keys(depois).length === 4, 'nenhum item foi apagado',
  `${Object.keys(depois).length} de 4`)

// ---------------------------------------------------------------------
// 4. IDEMPOTÊNCIA — o upgrade pode rodar de novo sem estragar nada
// ---------------------------------------------------------------------
const segunda = await backfillChaveDoFechamentoLegado(novo.table('filaOperacoes'))
check(segunda.corrigidos === 0,
  'rodar o backfill de novo não corrige nada (já está feito)',
  `corrigidos=${segunda.corrigidos}`)
check(segunda.malformados.length === 1 && segunda.malformados[0] === 'legado-torto',
  'e continua DENUNCIANDO o malformado, em vez de esquecê-lo',
  JSON.stringify(segunda.malformados))

novo.close()
await Dexie.delete(NOME)
const sobrou = (await Dexie.getDatabaseNames?.() ?? []).includes(NOME)
check(sobrou === false, 'banco de conferência apagado no fim')

console.table(linhas)
const ok = linhas.every((l) => l.ok)
console.log(ok
  ? `\nUPGRADE v4 → v5 PRESERVA — ${linhas.length} casos\n`
  : '\nFALHOU — ver a coluna `detalhe`\n')
}
