// NÃO roda com node. É pra colar no console do navegador (F12 → Console),
// com o app aberto e você LOGADO.
//
// =====================================================================
// O RETORNO OFFLINE, PONTA A PONTA — a 2D.5 pelo caminho difícil
// =====================================================================
//
// São TRÊS blocos, e eles cercam um trecho manual (bipar, PIN, assinar).
// Cole um de cada vez, na ordem:
//
//     BLOCO 1   antes de abrir a corrida — pré-condições e ficar offline
//     ~~~~~~~   você faz o retorno na tela ~~~~~~~
//     BLOCO 2   com a fila ainda parada — o que foi ASSINADO
//     BLOCO 3   depois de voltar a rede — o que o servidor SELOU
//
// Cada bloco está dentro de `{ }` de propósito: `const` de topo no
// console do Chrome PERSISTE entre colagens, e sem o bloco a segunda
// tentativa morre em "Identifier already declared" sem rodar nada.
// Repetir um teste é o uso normal, não a exceção.
//
// ---------------------------------------------------------------------
// POR QUE NÃO USAR SÓ O "Offline" DO DEVTOOLS
//
// Use os dois, e nesta ordem: o BLOCO 1 mente o `navigator.onLine` (que
// é o que a TELA lê pra escolher o ramo) e o DevTools corta a rede de
// verdade (que é o que impede uma chamada de escapar). Só o primeiro
// deixaria o `fetch` funcionar; só o segundo deixaria `navigator.onLine`
// verdadeiro em alguns cenários, e a tela tentaria o caminho online.
//
// O que decide o ramo é `navigator.onLine` NO INSTANTE DA AÇÃO, não no
// render — por isso o bloco 1 tem que rodar ANTES de você clicar em
// "Guardar PIN".
// =====================================================================


// =====================================================================
// BLOCO 1 — pré-condições, e ficar offline
//
// Ele RECUSA a continuar se faltar qualquer coisa, em vez de deixar você
// descobrir depois de colher duas assinaturas. As três que importam:
//
//   chave do envelope   sem ela o PIN não tem como ser protegido, e a
//                       tela barra no passo do PIN (de propósito)
//   contexto em cache   offline o documento da saída não pode ser
//                       inventado; sem cache a tela bloqueia
//   fila limpa          pra o BLOCO 2 não confundir item velho com novo
// =====================================================================
async function bloco1() {
  const { envelopeDisponivel } = await import('/src/lib/envelope.ts')
  const { db } = await import('/src/lib/db.ts')
  const { supabase } = await import('/src/lib/supabase.ts')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login primeiro.')

  const problemas = []

  // 1. A chave pública do envelope. Ela é variável de BUILD — se o
  //    `.env` mudou, o dev server precisa ter sido reiniciado.
  if (!envelopeDisponivel()) {
    problemas.push(
      'VITE_ROMANEIO_KEY_ID / VITE_ROMANEIO_PUBKEY não chegaram no bundle. ' +
        'Reinicie o dev server depois de mexer no .env.'
    )
  }

  // 2. Os contextos cacheados. O aquecimento roda quando a lista de
  //    corridas abertas carrega COM rede — então abra a tela de Retorno
  //    de corrida uma vez online antes de rodar isto.
  const contextos = await db.contextosRetorno.toArray()
  const bons = contextos.filter((c) => c.versao === 'CTXR1')
  if (bons.length === 0) {
    problemas.push(
      'Nenhum contexto de retorno em cache. Abra "Retorno de corrida" COM internet ' +
        'uma vez (o aquecimento roda quando a lista carrega) e volte aqui.'
    )
  }

  // 3. A fila. Item velho aqui vira ruído no bloco 2 — e um
  //    `fechamento_corrida` legado ainda vivo ESCONDE a corrida da lista
  //    (2C.7), o que pareceria "a corrida sumiu".
  const fila = await db.filaOperacoes.toArray()
  const vivos = fila.filter((i) => i.status !== 'terminal')
  const retornosNaFila = vivos.filter((i) => i.tipo === 'romaneio_retorno')
  const legadosNaFila = vivos.filter((i) => i.tipo === 'fechamento_corrida')

  if (problemas.length > 0) {
    console.error('NÃO DÁ PRA COMEÇAR:\n  - ' + problemas.join('\n  - '))
  } else {
    // Mente o `navigator.onLine` e AVISA o app. `useOnline` escuta os
    // eventos; sem o dispatch a tela continuaria desenhando "Concluir
    // retorno" enquanto a decisão já seria a offline — a tela afirmando
    // o que não sabe, que é o defeito que `useOnline` veio corrigir.
    const jaOffline = navigator.onLine === false

    // ESTE OVERRIDE MORRE NO F5, e foi assim que a primeira tentativa
    // saiu ONLINE em 2026-08-25: bloco1 rodou, a página recarregou em
    // algum momento, `navigator.onLine` voltou a ser true, e o retorno
    // foi selado pelo caminho online sem ninguém notar — só o `modo`
    // do romaneio denunciou, no bloco 3.
    //
    // Por isso o DevTools é o MECANISMO PRINCIPAL, não o reforço: ele
    // põe `navigator.onLine` em false nativamente E sobrevive a
    // recarregar a página. Este override existe pra o caso de você não
    // poder mexer no DevTools.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))

    if (jaOffline) {
      console.log('OFFLINE DE VERDADE já ativo (DevTools). É o jeito certo.')
    } else {
      console.warn(
        'OFFLINE SIMULADO — e ele MORRE se a página recarregar.\n' +
          'Ligue o de verdade agora: DevTools → Network → throttling → Offline.\n' +
          'Sem isso, um F5 no meio do caminho faz o retorno ser selado ONLINE ' +
          'e você só descobre no bloco 3, pelo campo modo.'
      )
    }

    // ---------------------------------------------------------------
    // O VIGIA, e por que ele vale mais que o aviso acima
    //
    // Em 2026-08-25 duas tentativas seguidas saíram `online` sem que
    // ninguém percebesse no momento. A causa não foi desatenção: o
    // servidor de desenvolvimento estava recebendo edições, e um HMR
    // que não consegue atualizar a quente RECARREGA A PÁGINA INTEIRA —
    // silenciosamente, restaurando `navigator.onLine`.
    //
    // Um aviso impresso uma vez não alcança isso, porque o estrago
    // acontece DEPOIS dele. Este vigia grita no instante da volta, que
    // é enquanto ainda dá pra parar antes de gastar cartão e PIN.
    //
    // Ele se desliga sozinho quando o bloco 2 roda.
    clearInterval(window.__vigiaOffline)
    window.__vigiaOffline = setInterval(() => {
      if (navigator.onLine) {
        console.error(
          'A REDE VOLTOU — o offline caiu. Se você continuar, o retorno vai ser ' +
            'selado ONLINE. Rode retornoOffline.bloco1() de novo (e de preferência ' +
            'ligue o Offline do DevTools, que sobrevive a recarregar a página).'
        )
      }
    }, 2000)
    window.addEventListener('online', () =>
      console.error('evento `online` disparado — o offline caiu AGORA.')
    )
    console.log('vigia ligado: ele avisa se a rede voltar antes de você concluir.')
    console.log('')
    console.table(
      bons.map((c) => ({
        corrida: c.corridaId.slice(0, 8) + '…',
        saida: c.contexto.saidaNumero,
        vales: c.contexto.vales.length,
        motoboy: c.contexto.motoboyNome,
        cacheado_em: c.atualizadoEm.slice(0, 19).replace('T', ' '),
      }))
    )
    console.log(
      `\ncontextos em cache: ${bons.length}` +
        ` · retornos já na fila: ${retornosNaFila.length}` +
        ` · fechamentos legados na fila: ${legadosNaFila.length}`
    )
    if (retornosNaFila.length > 0) {
      console.warn(
        'Já existe retorno na fila. A corrida dele NÃO vai aparecer na lista ' +
          '(é a 2C.7 evitando duas coletas de assinatura pra mesma corrida). ' +
          'Escolha outra, ou deixe a fila drenar primeiro.'
      )
    }
    console.log(
      '\nAGORA, na tela: escolha a corrida → confira → congele → bipe o cartão →\n' +
        'o botão do PIN deve dizer "Guardar PIN" (e NÃO "Confirmar identidade") →\n' +
        'assine as duas → "Registrar retorno offline".\n' +
        'Esperado no fim: "Retorno registrado offline. Ainda NÃO foi validado".'
    )
  }
}


// =====================================================================
// BLOCO 2 — o que foi ASSINADO, com a fila ainda parada
//
// Cole ANTES de religar a rede. Ele lê o item da fila e confere que o
// artefato guardado é exatamente o que a 2C.4 mandou guardar:
// CONGELADO, sem o objeto de domínio junto, e sem segredo nenhum em
// claro.
// =====================================================================
async function bloco2() {
  clearInterval(window.__vigiaOffline)

  const { db } = await import('/src/lib/db.ts')
  const { montarCanonicoRetorno } = await import('/src/lib/canonicoRetorno.ts')

  const itens = await db.filaOperacoes
    .toArray()
    .then((t) => t.filter((i) => i.tipo === 'romaneio_retorno'))
  if (itens.length === 0) throw new Error('Nenhum romaneio_retorno na fila.')

  const item = itens[itens.length - 1]
  const p = item.payload
  let falhas = 0
  const checa = (nome, ok, extra = '') => {
    console.log(`${ok ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!ok) falhas++
  }

  console.log('--- o item da fila ---')
  checa('tipo romaneio_retorno', item.tipo === 'romaneio_retorno')
  checa('status pendente ou erro', item.status === 'pendente' || item.status === 'erro', item.status)
  // A 2C.3: `chave` igual a `dependeDeChave` seria deadlock silencioso,
  // porque o guard não exclui o próprio item. O retorno declara SÓ a
  // dependência.
  checa('dependeDeChave = corridaId', item.dependeDeChave === p.corridaId)
  checa('e NENHUMA chave própria', item.chave === undefined, 'senão ele dependeria de si mesmo')
  checa('dono é o usuário da sessão', !!item.userId)

  console.log('\n--- o artefato CONGELADO ---')
  checa('versaoDocumento DCRR1', p.versaoDocumento === 'DCRR1')
  checa('documentHash com 64 hex', /^[0-9a-f]{64}$/.test(p.documentHash))
  checa('retornoJsonb já convertido', Array.isArray(p.retornoJsonb) && p.retornoJsonb.length > 0)
  // O ponto inteiro da 2C.4: o objeto de DOMÍNIO não pode estar aqui,
  // senão uma atualização do app entre enfileirar e sincronizar
  // converteria diferente e o servidor recusaria `documento_alterado`
  // com as duas assinaturas já colhidas.
  checa('sem o objeto de domínio junto', p.entrada === undefined && p.vales === undefined)
  checa('responsavelStrokes, nunca caixaStrokes',
    p.responsavelStrokes !== undefined && p.caixaStrokes === undefined)
  checa('motoboyStrokes presente', p.motoboyStrokes !== undefined)
  checa('não manda corrida nem loja pro servidor',
    p.lojaId === undefined,
    'o servidor deriva a loja do romaneio de saída — payload nenhum opina')

  console.log('\n--- o envelope ---')
  checa('envelope selado', !!p.envelope && p.envelope.v === 1 && !!p.envelope.k)
  // O que NÃO pode estar em lugar nenhum do item.
  const cru = JSON.stringify(item)
  checa('nenhum campo `pin` em claro', !/"pin"\s*:/.test(cru))
  checa('nenhum `credentialToken` em claro', !/"credentialToken"\s*:/.test(cru))

  console.log('\n--- o documento reconstruído do que foi guardado ---')
  // Reconstrói o canônico a partir do jsonb CONGELADO e confere que ele
  // bate com o `documentHash` que as duas partes assinaram. Se divergir,
  // o que subiria não é o que foi assinado.
  const entrada = {
    saidaRomaneioId: p.saidaRomaneioId,
    saidaDocumentHash: p.saidaDocumentHash,
    motoboyId: p.motoboyId,
    responsavelId: item.userId,
    vales: p.retornoJsonb.map((v) => ({
      entregaId: v.entrega_id,
      desfecho: v.desfecho,
      motivo: v.motivo,
      detalhe: v.detalhe,
      pagamentosRealizados: (v.pagamentos_realizados ?? []).map((x) => ({
        pagamentoId: x.pagamento_id,
        forma: x.forma,
        valorCents: x.valor_cents,
        trocoCents: x.troco_cents,
      })),
      documentos: (v.documentos ?? []).map((d) => ({ tipo: d.tipo, situacao: d.situacao })),
    })),
  }
  const canonico = montarCanonicoRetorno(entrada)
  const bytes = new TextEncoder().encode(canonico)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  checa('o canônico reconstruído dá o MESMO hash assinado', hash === p.documentHash,
    hash === p.documentHash ? '' : `guardado ${p.documentHash.slice(0, 16)}… · calculado ${hash.slice(0, 16)}…`)

  // A ARMADILHA DO §77, medida no artefato real: nenhum `pagamento_id`
  // do realizado pode ser igual ao `entrega_id` — porque o id do
  // PREVISTO é o uuid da entrega, e copiá-lo faria o selo bater em
  // `on conflict do nothing` e afirmar um pagamento que não existe.
  const colisoes = p.retornoJsonb.flatMap((v) =>
    (v.pagamentos_realizados ?? [])
      .filter((x) => x.pagamento_id === v.entrega_id)
      .map((x) => x.pagamento_id)
  )
  checa('nenhum pagamento_id igual ao entrega_id', colisoes.length === 0, colisoes.join(', '))

  console.log('\n' + canonico)
  console.log(
    falhas === 0
      ? '\nARTEFATO OFFLINE ÍNTEGRO — pode religar a rede e colar o BLOCO 3\n'
      : `\n${falhas} FALHA(S) — NÃO religue a rede antes de entender\n`
  )
}


// =====================================================================
// BLOCO 3 — depois de religar a rede
//
// Religue nos DOIS lugares (DevTools → Online, e recarregue a página pra
// desfazer a mentira do `navigator.onLine`). A fila sincroniza sozinha;
// este bloco só olha o resultado.
//
// O que ele responde, e nenhuma tela responde: o romaneio selado por
// esta via é `offline_sincronizada`? Porque uma saída ONLINE também
// "sela e fecha a corrida" — só o `modo` distingue os dois.
// =====================================================================
async function bloco3() {
  const { db } = await import('/src/lib/db.ts')
  const { supabase } = await import('/src/lib/supabase.ts')

  const naFila = await db.filaOperacoes
    .toArray()
    .then((t) => t.filter((i) => i.tipo === 'romaneio_retorno'))

  const { data: retornos, error } = await supabase
    .from('romaneios')
    .select('id, numero, tipo, status, modo, corrida_id, romaneio_saida_id, document_hash, final_hash')
    .eq('tipo', 'retorno')
    .order('numero')
  if (error) throw error

  let falhas = 0
  const checa = (nome, ok, extra = '') => {
    console.log(`${ok ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
    if (!ok) falhas++
  }

  console.log('--- a fila ---')
  checa('item saiu da fila', naFila.length === 0,
    naFila.map((i) => `${i.status}: ${i.erro ?? '(sem erro)'}`).join(' | '))

  console.log('\n--- o romaneio de retorno ---')
  checa('existe pelo menos um retorno', (retornos ?? []).length > 0)
  const r = (retornos ?? [])[retornos.length - 1]
  if (r) {
    checa('status selado', r.status === 'selado', r.status)
    // A afirmação que só este teste consegue fazer.
    checa('modo offline_sincronizada', r.modo === 'offline_sincronizada', r.modo)
    checa('aponta pra saída', !!r.romaneio_saida_id)
    checa('tem corrida', !!r.corrida_id)
    checa('tem final_hash', !!r.final_hash)
    console.table(retornos)

    // As CINCO camadas do verificador do retorno, que nunca rodaram
    // contra um retorno de verdade.
    const { data: v, error: e2 } = await supabase.rpc('verificar_romaneio', {
      p_romaneio_id: r.id,
    })
    if (e2) {
      console.warn('verificar_romaneio precisa do uuid; rode como admin:')
      console.warn("  select * from public.verificar_romaneios_selados();")
    } else {
      console.table(v)
    }

    // E a corrida tem que ter fechado na mesma transação.
    const { data: c } = await supabase
      .from('corridas')
      .select('status, retorno_em, retorno_em_local')
      .eq('id', r.corrida_id)
      .single()
    checa('corrida fechada pelo selo', c?.status === 'fechada', c?.status)
    checa('retorno_em do SERVIDOR preenchido', !!c?.retorno_em)
    checa('retorno_em_local do DISPOSITIVO preenchido', !!c?.retorno_em_local,
      'dois relógios, regra 8')
  }

  console.log(
    falhas === 0
      ? '\nRETORNO OFFLINE FECHADO. Rode o placar como ADMIN:\n' +
          '  select * from public.verificar_romaneios_selados();\n' +
          'Espere UMA linha nova com tipo=retorno e divergencias=0.\n'
      : `\n${falhas} FALHA(S)\n`
  )
}


// =====================================================================
// REGISTRO — por que funções e não blocos pra colar
//
// A primeira versão eram três blocos `{ ... }` pra colar inteiros. Um
// deles chegou pela metade no console e morreu em "db is not defined",
// que não diz nada sobre a causa. Colar 80 linhas num console é frágil
// por natureza; chamar `retornoOffline.bloco2()` não é.
//
// IMPORTE ENQUANTO HOUVER REDE. O `import()` busca do dev server, e
// depois de offline ele não resolve. Os `import()` de dentro dos blocos
// resolvem do registro de módulos já carregado, então ELES funcionam
// offline — mas só se este arquivo já tiver entrado antes.
//
//     await import('/scripts/conferir-retorno-offline-no-console.js')
//     retornoOffline.bloco1()      // ainda online
//     ... DevTools → Offline, e faz o retorno na tela ...
//     retornoOffline.bloco2()      // com a fila parada
//     ... religa a rede ...
//     retornoOffline.bloco3()
// =====================================================================
window.retornoOffline = { bloco1, bloco2, bloco3 }
console.log('retornoOffline pronto: bloco1() · bloco2() · bloco3()')
