// CENÁRIO F do aceite complementar do 4B — trocar o motivo SÓ NO CORPO.
//
// O que prova: `motivoExcecao` viaja duas vezes — em claro no corpo da fila e
// selado dentro do envelope. A `sync-romaneio` compara os dois e recusa
// `validacao_divergente`, TERMINAL, antes de qualquer RPC. Sem essa
// comparação, alguém com acesso ao navegador trocaria "PIN esquecido" por
// "Cartão perdido" (ou o contrário) num documento que o gerente autorizou
// por outro motivo.
//
// COMO USAR — no navegador do app, COM A REDE DESLIGADA:
//   1. registrar uma saída (ou retorno) offline com o cartão do gerente;
//   2. DevTools → Console → colar este arquivo inteiro → Enter;
//   3. conferir a linha "trocado: ... → ...";
//   4. religar a rede e esperar a fila rodar.
//
// ESPERADO depois de religar:
//   - o item fica TERMINAL na fila, com a mensagem de validação divergente;
//   - a consulta (4) de scripts/aceite-complementar-4b.sql NÃO ganha linha,
//     e nenhum romaneio selado novo aparece para essa operação.
//
// Lê e escreve só o IndexedDB deste navegador. Não chama o servidor.
;(async () => {
  const abrir = () =>
    new Promise((ok, erro) => {
      const req = indexedDB.open('tele-entregas')
      req.onsuccess = () => ok(req.result)
      req.onerror = () => erro(req.error)
    })
  const db = await abrir()
  const tx = db.transaction('filaOperacoes', 'readwrite')
  const store = tx.objectStore('filaOperacoes')
  const todos = await new Promise((ok, erro) => {
    const req = store.getAll()
    req.onsuccess = () => ok(req.result)
    req.onerror = () => erro(req.error)
  })

  const alvo = todos
    .filter(
      (i) =>
        (i.tipo === 'romaneio_saida' || i.tipo === 'romaneio_retorno') &&
        i.status !== 'terminal' &&
        i.payload &&
        i.payload.validacao === 'gerente'
    )
    .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1))[0]

  if (!alvo) {
    console.warn('Nenhuma saída ou retorno offline autorizado pelo gerente na fila. Faça o passo 1 antes.')
    return
  }
  if (navigator.onLine) {
    console.warn('A rede está LIGADA: a fila pode sincronizar antes da troca. Desligue a rede e rode de novo.')
    return
  }

  const antes = alvo.payload.motivoExcecao
  const depois = antes === 'pin_esquecido' ? 'cartao_perdido' : 'pin_esquecido'
  alvo.payload = { ...alvo.payload, motivoExcecao: depois }
  store.put(alvo)
  await new Promise((ok, erro) => {
    tx.oncomplete = ok
    tx.onerror = () => erro(tx.error)
  })
  console.log(`trocado: ${antes} → ${depois} no item ${alvo.id} (${alvo.tipo}). O envelope continua dizendo ${antes}. Agora religue a rede.`)
})()
