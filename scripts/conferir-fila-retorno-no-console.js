// NÃO roda com node. Cole no console do navegador (F12 → Console), com
// o app aberto e você LOGADO (`enfileirarOperacao` não exige sessão, mas
// `processarFilaOperacoes` consulta uma, e queremos o caminho real).
//
// ---------------------------------------------------------------------
// O QUE ELE PROVA
//
// Que um `romaneio_retorno` enfileirado sobrevive ao IndexedDB **sem
// precisar de nada que possa mudar entre enfileirar e sincronizar.**
//
// O artefato, depois de gravado, é:
//
//     retornoJsonb  +  documentHash  +  os dois traços
//
// e a afirmação "o que voltou é o que foi assinado" é feita comparando
// com o que foi capturado ANTES do `put` — **nunca chamando
// `paraJsonbRetorno` de novo**. Reconverter pra conferir provaria que o
// converter é determinístico hoje, que é justamente a premissa que a
// atualização do app quebra.
//
// ---------------------------------------------------------------------
// ELE FORÇA O NAVEGADOR A FICAR OFFLINE ENQUANTO RODA
//
// `enfileirarOperacao` dispara `processarFilaOperacoes` no fim, e o
// handler de `romaneio_retorno` ainda LEVANTA EXCEÇÃO de propósito (o
// transporte é da 2C.6). Sem neutralizar, o item de teste terminaria em
// `erro` na sua fila de verdade e o indicador acusaria "precisa de
// atenção".
//
// A técnica é a do §49, e ela é temática: uma operação que só existe
// offline, criada offline. O `finally` devolve a rede aconteça o que
// acontecer, e o item de teste é apagado no fim.
//
// NÃO fala com o servidor em momento nenhum.
// ---------------------------------------------------------------------

{
const { db } = await import('/src/lib/db.ts')
const { enfileirarOperacao, donoDaFila } = await import('/src/data/filaOffline.ts')
const { bloqueadoPorDependencia } = await import('/src/lib/dependenciaDaFila.ts')
const { montarCanonicoRetorno, paraJsonbRetorno } = await import('/src/lib/canonicoRetorno.ts')
const { uuidv7 } = await import('/src/lib/uuid.ts')

const linhas = []
const check = (ok, caso, detalhe) => linhas.push({ ok, caso, detalhe: detalhe ?? '' })

const descritorOnline = Object.getOwnPropertyDescriptor(navigator, 'onLine')
let idFila = null

try {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
  window.dispatchEvent(new Event('offline'))
  check(navigator.onLine === false, 'navegador forçado offline durante o teste')

  // -------------------------------------------------------------------
  // 1. O DOCUMENTO, montado como a tela da 2D vai montar
  // -------------------------------------------------------------------
  const corridaId = uuidv7()
  const entrada = {
    saidaRomaneioId: uuidv7(),
    saidaDocumentHash: 'a'.repeat(64),
    motoboyId: uuidv7(),
    responsavelId: uuidv7(),
    vales: [
      {
        entregaId: uuidv7(),
        desfecho: 'entregue',
        motivo: null,
        detalhe: null,
        pagamentosRealizados: [
          { pagamentoId: uuidv7(), forma: 'crediario', valorCents: 12000, trocoCents: 0 },
        ],
        documentos: [{ tipo: 'crediario', situacao: 'recebido' }],
      },
    ],
  }

  // UMA conversão, UM hash. Daqui pra frente só os resultados viajam.
  const canonico = montarCanonicoRetorno(entrada)
  const documentHash = [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonico))
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const retornoJsonb = paraJsonbRetorno(entrada)

  // A referência da comparação, capturada ANTES do `put`.
  const jsonbAssinado = JSON.stringify(retornoJsonb)

  const responsavelStrokes = [{ pontos: [[1, 2, 30]], t: 1 }]
  const motoboyStrokes = [{ pontos: [[3, 4, 50]], t: 2 }]

  const dono = donoDaFila({ id: 'user-teste', tenantId: 'tenant-teste', lojaId: 'loja-teste' })

  // -------------------------------------------------------------------
  // 2. ENFILEIRA pelo caminho real
  // -------------------------------------------------------------------
  idFila = await enfileirarOperacao(
    'romaneio_retorno',
    dono,
    {
      romaneioId: uuidv7(),
      corridaId,
      saidaRomaneioId: entrada.saidaRomaneioId,
      saidaDocumentHash: entrada.saidaDocumentHash,
      motoboyId: entrada.motoboyId,
      versaoDocumento: 'DCRR1',
      retornoJsonb,
      documentHash,
      responsavelStrokes,
      motoboyStrokes,
      ocorridoEmLocal: new Date().toISOString(),
      geolocalizacao: null,
      userId: dono.userId,
    },
    { dependeDeChave: corridaId }
  )

  // -------------------------------------------------------------------
  // 3. LÊ DE VOLTA — daqui pra baixo, só o que o IndexedDB devolveu
  // -------------------------------------------------------------------
  const item = await db.filaOperacoes.get(idFila)
  check(item !== undefined, 'item gravado e recuperado', `id=${idFila}`)

  // (1) payload congelado
  check(
    JSON.stringify(item.payload.retornoJsonb) === jsonbAssinado,
    'retornoJsonb recuperado === o que foi assinado',
    'comparado com a captura pré-`put`, sem reconverter'
  )
  check(item.payload.documentHash === documentHash, 'documentHash intacto')
  check(item.payload.versaoDocumento === 'DCRR1', 'versaoDocumento persistida')

  // O ponto inteiro: nada aqui obriga a fila a reconverter.
  check(
    item.payload.entradaRetorno === undefined && item.payload.vales === undefined,
    'o objeto de DOMÍNIO não foi junto',
    'sem EntradaRetorno no payload, nem como conveniência'
  )

  // (4) vocabulário
  check('responsavelStrokes' in item.payload, 'payload tem responsavelStrokes')
  check('motoboyStrokes' in item.payload, 'payload tem motoboyStrokes')
  check(!('caixaStrokes' in item.payload), 'payload NÃO tem caixaStrokes')
  check(
    JSON.stringify(item.payload.responsavelStrokes) === JSON.stringify(responsavelStrokes) &&
      JSON.stringify(item.payload.motoboyStrokes) === JSON.stringify(motoboyStrokes),
    'os dois traços intactos'
  )

  // (2) dependência, sem se prender
  check(item.dependeDeChave === corridaId, 'dependeDeChave = corridaId')
  check(item.chave === undefined, 'chave AUSENTE')
  check(
    bloqueadoPorDependencia(item, [item]) === false,
    'sozinho na fila, não se bloqueia',
    'é o par de `chave` ausente com a correção da 2C.3'
  )
  check(
    bloqueadoPorDependencia(item, [item, { id: 'outro', chave: corridaId }]) === true,
    'mas espera quem carrega a chave da corrida',
    'a saída ou o fechamento legado backfillado'
  )

  // (3) dono
  check(
    item.userId === 'user-teste' &&
      item.tenantId === 'tenant-teste' &&
      item.lojaId === 'loja-teste',
    'dono gravado na CRIAÇÃO',
    `${item.userId}/${item.tenantId}/${item.lojaId}`
  )

  check(
    item.status === 'pendente' && item.tentativas === 0,
    'nasce pendente com zero tentativas',
    `${item.status}/${item.tentativas}`
  )

  // (5) invalidações: garantidas pelo COMPILADOR, não por asserção.
  // `QUERY_KEYS_POR_TIPO` é `Record<TipoOperacaoFila, string[]>`, então
  // esquecer o tipo novo não compila. Foi assim que o `tsc` cobrou também
  // o rótulo do indicador da fila ao acrescentar `romaneio_retorno`.
  check(true, 'invalidações declaradas', 'exigidas em tempo de compilação pelo Record exaustivo')
} finally {
  if (idFila) await db.filaOperacoes.delete(idFila)
  if (descritorOnline) Object.defineProperty(navigator, 'onLine', descritorOnline)
  else delete navigator.onLine
  window.dispatchEvent(new Event('online'))
}

const restou = idFila ? await db.filaOperacoes.get(idFila) : undefined
check(restou === undefined, 'item de teste apagado da fila')
check(navigator.onLine === true, 'rede devolvida ao normal')

console.table(linhas)
const ok = linhas.every((l) => l.ok)
console.log(ok
  ? `\nARTEFATO OFFLINE DE RETORNO SOBREVIVE — ${linhas.length} casos\n`
  : '\nFALHOU — ver a coluna `detalhe`\n')
}
