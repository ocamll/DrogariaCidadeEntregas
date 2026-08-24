// NÃO roda com node. Cole no console do navegador (F12 → Console), com
// o app aberto e você LOGADO.
//
// ---------------------------------------------------------------------
// 2C.8 — CENSO DA FILA REAL, e o que ele NÃO autoriza
//
// Ele lê. Não apaga item, não marca terminal, não chama sync, não mexe
// em nada. É medição.
//
// **"Veio vazio" NÃO autoriza remover o handler legado de
// `fechamento_corrida`.** Vazio nesta máquina não prova vazio nos
// computadores das outras filiais — a farmácia tem 17, e cada navegador
// tem a própria fila em IndexedDB. A regra de remoção está no CLAUDE.md
// e é sobre JANELA DE RELEASES, não sobre uma leitura local.
//
// O que este censo serve pra responder é outra coisa: existe item legado
// AQUI, agora, que valha exercitar a janela de compatibilidade de ponta a
// ponta antes da 2D?
// ---------------------------------------------------------------------

{
const { db } = await import('/src/lib/db.ts')
const { supabase } = await import('/src/lib/supabase.ts')
const { corridasComFechamentoLegadoPendente } = await import('/src/lib/corridasBloqueadas.ts')

const { data: { user } } = await supabase.auth.getUser()
const eu = user?.id ?? '(sem sessão)'

const todos = await db.filaOperacoes.toArray()

console.log(`fila local: ${todos.length} item(ns) · sessão ${eu}`)

// ---- 1. tudo que está na fila, por tipo e status ----
const porTipo = new Map()
for (const i of todos) {
  const k = `${i.tipo} / ${i.status}`
  porTipo.set(k, (porTipo.get(k) ?? 0) + 1)
}
console.log('\n--- o que está na fila ---')
console.table([...porTipo.entries()].map(([k, n]) => ({ 'tipo / status': k, itens: n })))

// ---- 2. os legados de fechamento_corrida, em detalhe ----
const legados = todos
  .filter((i) => i.tipo === 'fechamento_corrida')
  .map((i) => ({
    id: i.id,
    status: i.status,
    chave: i.chave ?? '(ausente)',
    corridaId: i.payload?.corridaId ?? '(ausente)',
    // `chave === corridaId` é o que o backfill da 2C.3 devia ter feito.
    backfillOk: i.chave !== undefined && i.chave === i.payload?.corridaId,
    userId: i.userId || '(sem dono — roda em qualquer sessão)',
    tentativas: i.tentativas,
    criadoEm: i.criadoEm,
  }))

console.log(`\n--- fechamento_corrida legado: ${legados.length} ---`)
if (legados.length === 0) {
  console.log(
    'Nenhum nesta máquina. Isso NÃO autoriza remover o handler legado —\n' +
    'ver a regra de janela de releases no CLAUDE.md.'
  )
} else {
  console.table(legados)
  const semBackfill = legados.filter((l) => !l.backfillOk && l.corridaId !== '(ausente)')
  if (semBackfill.length > 0) {
    console.warn(
      `${semBackfill.length} item(ns) com chave ≠ corridaId — o backfill da v5 ` +
      'não os alcançou. Nada pode depender deles.', semBackfill.map((l) => l.id)
    )
  }
  const malformados = legados.filter((l) => l.corridaId === '(ausente)')
  if (malformados.length > 0) {
    console.warn(
      `${malformados.length} item(ns) sem payload.corridaId — preservados de ` +
      'propósito, sem chave inventada.', malformados.map((l) => l.id)
    )
  }
}

// ---- 3. o que a 2C.7 está escondendo da tela do retorno ----
const bloqueadas = corridasComFechamentoLegadoPendente(todos, eu)
console.log(`\n--- corridas que a tela do retorno NÃO oferece: ${bloqueadas.size} ---`)
if (bloqueadas.size > 0) console.log([...bloqueadas])
else console.log('nenhuma — a lista de corridas abertas aparece inteira')

// ---- 4. e o retorno, que ainda não tem quem o crie ----
const retornos = todos.filter((i) => i.tipo === 'romaneio_retorno')
console.log(
  `\n--- romaneio_retorno na fila: ${retornos.length} ---\n` +
  (retornos.length === 0
    ? 'esperado: nada enfileira este tipo até a 2D construir a tela.'
    : 'INESPERADO antes da 2D — alguém já está criando retorno offline?')
)
if (retornos.length > 0) console.table(retornos.map((i) => ({ id: i.id, status: i.status })))

console.log(
  '\nCenso concluído. Nada foi alterado.\n' +
  'Se aparecer `fechamento_corrida` acima, ele é a oportunidade de exercitar\n' +
  'a janela de compatibilidade de ponta a ponta antes da 2D.'
)
}
