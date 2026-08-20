// NÃO roda com node. Isto é pra rodar no console do navegador (F12 →
// Console), com o app aberto em `npm run dev`. **Não precisa estar
// logado** e **não fala com o Supabase**.
//
// O QUE ELE PROVA
//
// Que o aviso "— sincronizando…" das telas de lançamento TERMINA, e que
// termina dizendo a verdade. Antes ele era uma string montada à mão e
// guardada num estado que ninguém limpava: ficava na tela depois de a
// operação ter subido, e ficava exatamente igual se ela tivesse falhado.
//
// Os cinco desfechos, contra o IndexedDB DE VERDADE (a liveQuery da Dexie
// é metade do mecanismo — testar com dublê provaria o componente e não o
// acoplamento, que é onde o defeito morava):
//
//   item na fila         → "sincronizando" + reticências ANIMADAS
//   item marcado 'erro'  → diz que não subiu e que vai tentar de novo
//   item 'terminal'      → manda olhar o indicador do topo
//   item some da fila    → "sincronizada", e o aviso se apaga sozinho
//   `put` rejeitou       → diz que NÃO salvou
//
// O item de teste é escrito e apagado na fila real; no fim o script
// confere que a fila voltou exatamente ao que era. Nada é enviado: sem
// sessão, `processarFilaOperacoes` desiste na primeira linha.
//
// COMO RODAR — cole isto no console (repetir é seguro):
//
//   {
//     const u = '/@fs/' + '<caminho absoluto do repo>' +
//               '/scripts/conferir-aviso-de-sincronizacao.js?t=' + Date.now()
//     const src = await (await fetch(u)).text()
//     const AF = Object.getPrototypeOf(async function () {}).constructor
//     console.log(await new AF(src)())
//   }
//
// O corpo vive dentro de um bloco porque `const` de topo no console do
// Chrome persiste entre colagens (§59).
{
  // O `?v=<hash>` não é enfeite: sem ele carrega uma SEGUNDA instância do
  // React e nada renderiza, sem erro nenhum no console. O hash muda a
  // cada re-otimização do Vite (§45), então é lido do módulo real.
  const fonte = await (await fetch('/src/components/StatusDeGravacao.tsx')).text()
  const v = fonte.match(/deps\/react\.js\?v=([0-9a-f]+)/)?.[1]
  if (!v) throw new Error('não achei o ?v= do react no módulo transformado')

  // `import()` com expressão faz o Vite reescrever este arquivo e injetar
  // um `import` estático no topo, e aí ele deixa de rodar dentro de um
  // `AsyncFunction`. Escondido num `new Function`, o arquivo continua
  // sendo servido como texto puro.
  const importar = new Function('u', 'return import(u)')
  const React = (await importar(`/node_modules/.vite/deps/react.js?v=${v}`)).default
  const { createRoot } = (await importar(`/node_modules/.vite/deps/react-dom_client.js?v=${v}`))
    .default
  const { StatusDeGravacao } = await import('/src/components/StatusDeGravacao.tsx')
  const { gravacaoEnfileirada } = await import('/src/data/filaOffline.ts')
  const { db } = await import('/src/lib/db.ts')

  const ID_TESTE = 'conferencia-aviso-sincronizacao'
  const antes = (await db.filaOperacoes.toArray()).map((i) => i.id).sort()

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:#fff;padding:8px;border:1px solid #ccc'
  document.body.appendChild(host)

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
  const texto = () => host.innerText.replace(/\s+/g, ' ').trim()
  const resultado = {}

  try {
    // ---------------------------------------------------------------
    // 1 a 4: o ciclo de vida contra a fila real
    // ---------------------------------------------------------------
    let limpou = false
    // A promessa resolve DEPOIS de a linha existir, igual ao
    // `enfileirarOperacao` de verdade — é isso que impede o aviso de
    // concluir "sincronizada" só porque o `put` ainda não chegou.
    const enfileirando = db.filaOperacoes
      .put({
        id: ID_TESTE,
        tipo: 'entrega',
        payload: {},
        userId: '00000000-0000-0000-0000-000000000000',
        tenantId: '00000000-0000-0000-0000-000000000000',
        lojaId: null,
        status: 'pendente',
        criadoEm: new Date().toISOString(),
        tentativas: 0,
        proximaTentativaEm: new Date(0).toISOString(),
      })
      .then(() => ID_TESTE)

    const root = createRoot(host)
    root.render(
      React.createElement(StatusDeGravacao, {
        gravacao: { texto: 'Entrega de José da Conceição salva', enfileirando },
        onLimpar: () => {
          limpou = true
        },
      })
    )
    await esperar(250)
    resultado['1. na fila diz sincronizando'] = texto()

    // As reticências têm que estar MEXENDO, não só presentes. Sem esta
    // checagem, o keyframe sumir do CSS passaria despercebido — os três
    // pontos continuariam desenhados, parados, que é o estado anterior.
    const pontos = [...host.querySelectorAll('.reticencia')]
    const animacoes = pontos.flatMap((p) => p.getAnimations())
    // Esta máquina responde `prefers-reduced-motion: reduce`, e é bem
    // possível que a do balcão também — então a checagem tem que valer
    // nos DOIS ramos. Com movimento reduzido o que muda é o keyframe
    // (só opacidade, mais lento), nunca "não anima": ponto parado é o
    // estado anterior, o que este aviso veio corrigir.
    const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches
    resultado['2. reticências animadas'] = {
      movimentoReduzido: reduzido,
      pontos: pontos.length,
      animacoes: animacoes.length,
      // `every` de lista vazia é `true`: sem exigir as três, o keyframe
      // sumir do CSS daria PASSA. É o modo de falha que este projeto já
      // pagou sete vezes — o instrumento concordando com o defeito.
      rodando: animacoes.length === 3 && animacoes.every((a) => a.playState === 'running'),
      keyframe: getComputedStyle(pontos[0]).animationName,
      keyframeCerto:
        getComputedStyle(pontos[0]).animationName ===
        (reduzido ? 'reticencia-esmaece' : 'reticencia-pulsa'),
      // Os atrasos escalonados são o que faz a onda; iguais, os três
      // pulsariam juntos e pareceriam um piscar só.
      atrasos: pontos.map((p) => getComputedStyle(p).animationDelay),
      // O pulo é `translateY`, que não participa do layout. Se mexesse na
      // caixa, a linha de texto tremeria três vezes por segundo.
      alturaEstavel:
        new Set(pontos.map((p) => Math.round(p.getBoundingClientRect().height))).size === 1,
      // Os três pontos são elementos separados, então vale conferir que
      // eles não abriram vão entre si — `innerText` insere espaço entre
      // inline-blocks e disfarçaria o contrário.
      semVaoEntreOsPontos:
        Math.round(pontos[1].getBoundingClientRect().left) ===
        Math.round(pontos[0].getBoundingClientRect().right),
      // E nem entre a palavra e o primeiro ponto: `innerText` mostra
      // "sincronizando . . ." por causa dos inline-blocks, e sem medir
      // ficaria a dúvida se a tela tem mesmo esses espaços.
      colado: (() => {
        const p = host.querySelector('p')
        const alcance = document.createRange()
        alcance.selectNodeContents(p)
        alcance.setEnd(pontos[0].parentElement, 0)
        const fimDoTexto = alcance.getBoundingClientRect().right
        return Math.abs(fimDoTexto - pontos[0].getBoundingClientRect().left) < 1
      })(),
    }

    // O ramo SEM movimento reduzido é o que a maioria vai ver, e não dá
    // pra alternar a media query pelo JS. Então força-se o keyframe cheio
    // inline (a regra inline vence o `@media`) e amostra-se o transform
    // ao vivo: se `reticencia-pulsa` não existisse, ou não mexesse em
    // nada, o transform ficaria em `none` nas duas leituras.
    const cobaia = pontos[0]
    cobaia.style.animation = 'reticencia-pulsa 1.2s ease-in-out infinite'
    cobaia.style.animationDelay = '-0.35s' // no pico do keyframe
    const noPico = getComputedStyle(cobaia).transform
    cobaia.style.animationDelay = '0s' // no repouso
    const noRepouso = getComputedStyle(cobaia).transform
    cobaia.style.animation = ''
    cobaia.style.animationDelay = ''
    resultado['2b. keyframe cheio desloca de verdade'] = {
      noPico,
      noRepouso,
      desloca: noPico !== noRepouso && noPico !== 'none',
    }

    await db.filaOperacoes.update(ID_TESTE, { status: 'erro', tentativas: 1, erro: 'rede caiu' })
    await esperar(250)
    resultado['3. em erro'] = texto()

    await db.filaOperacoes.update(ID_TESTE, { status: 'terminal' })
    await esperar(250)
    resultado['4. terminal'] = texto()

    // Sucesso é a AUSÊNCIA na fila — `processarFilaOperacoes` deleta o
    // item ao subir e só marca quando falha.
    await db.filaOperacoes.delete(ID_TESTE)
    await esperar(250)
    resultado['5. saiu da fila'] = texto()
    resultado['6. ainda não sumiu'] = { limpou, aindaNaTela: texto().length > 0 }

    // O ponto do pedido: o aviso TERMINA.
    await esperar(2600)
    resultado['7. sumiu sozinho'] = { limpou }

    root.unmount()

    // ---------------------------------------------------------------
    // 8: o `put` falhou — antes isto era engolido pelo `void`
    // ---------------------------------------------------------------
    const naoTratadas = []
    const ouvirNaoTratada = (e) => naoTratadas.push(String(e.reason?.message ?? e.reason))
    window.addEventListener('unhandledrejection', ouvirNaoTratada)

    const root2 = createRoot(host)
    root2.render(
      React.createElement(StatusDeGravacao, {
        // `gravacaoEnfileirada` e não objeto literal: é ele que anexa o
        // `catch` no tick da criação. Sem isso a rejeição vira
        // "Uncaught (in promise)" no console ANTES de o efeito do
        // componente conseguir tratá-la — a tela mostra a mensagem certa
        // e o console acusa erro não tratado ao lado.
        gravacao: gravacaoEnfileirada(
          'Entrega de José salva',
          Promise.reject(new Error('QuotaExceededError'))
        ),
        onLimpar: () => {},
      })
    )
    await esperar(250)
    window.removeEventListener('unhandledrejection', ouvirNaoTratada)
    resultado['8. put rejeitado'] = texto()
    resultado['8b. sem rejeição não tratada no console'] = {
      naoTratadas,
      limpo: naoTratadas.length === 0,
    }
    root2.unmount()

    // ---------------------------------------------------------------
    // 9: o caixa continua trabalhando enquanto o aviso se despede
    //
    // Este é o caso que mais se parece com o relato original, e o que a
    // primeira versão deste componente errava: com `onLimpar` (arrow
    // inline, identidade nova a cada render) nas dependências do efeito,
    // TODO re-render do pai recriava o timer — e digitar a próxima
    // entrega segurava o aviso na tela indefinidamente. O teste força o
    // pai a re-renderizar durante a janela inteira.
    // ---------------------------------------------------------------
    let limpou2 = false
    let redesenhos = 0
    const root3 = createRoot(host)
    const gravacaoEstavel = {
      texto: 'Entrega enquanto o caixa digita',
      // Já sincronizada por construção: id que não existe na fila.
      enfileirando: Promise.resolve('nao-existe-na-fila'),
    }
    // O maior intervalo entre dois redesenhos precisa ser MENOR que a
    // janela de 2,5s, senão o teste passa por sorte: com re-renders
    // espaçados demais, o timer da versão bugada chegaria a disparar
    // entre um e outro e o caso não provaria nada. (A aba do painel
    // estrangula `setInterval`, então o número real não é o pedido — daí
    // medir em vez de supor.)
    let ultimo = performance.now()
    let maiorIntervalo = 0
    const desenhar = () => {
      const agora = performance.now()
      if (redesenhos > 0) maiorIntervalo = Math.max(maiorIntervalo, agora - ultimo)
      ultimo = agora
      redesenhos++
      root3.render(
        React.createElement(StatusDeGravacao, {
          gravacao: gravacaoEstavel,
          // Arrow NOVA a cada render, igual às três telas de verdade.
          onLimpar: () => {
            limpou2 = true
          },
        })
      )
    }
    desenhar()
    const tique = setInterval(desenhar, 200)
    await esperar(3200)
    clearInterval(tique)
    resultado['9. sumiu mesmo com o pai re-renderizando'] = {
      limpou: limpou2,
      redesenhos,
      maiorIntervaloMs: Math.round(maiorIntervalo),
      // Só com isto `limpou: true` significa alguma coisa.
      testeNaoEhVacuo: redesenhos >= 2 && maiorIntervalo < 2500,
    }
    root3.unmount()
    // ---------------------------------------------------------------
    // 11: as reticências DENTRO de um Button
    //
    // O `Button` do shadcn é `inline-flex` com `gap-1.5`. Um
    // `<Reticencias />` solto ali vira um item de flex separado do texto
    // e ganha 6px de distância — "Salvando   . . ." em vez de
    // "Salvando...". `<EmAndamento>` envolve os dois num `<span>` pra
    // serem UM item. Aqui as duas formas são montadas lado a lado, senão
    // a versão certa passaria sem provar que a errada falha.
    // ---------------------------------------------------------------
    const { Button } = await import('/src/components/ui/button.tsx')
    const { EmAndamento, Reticencias } = await import('/src/components/EmAndamento.tsx')

    const root4 = createRoot(host)
    root4.render(
      React.createElement(
        'div',
        null,
        React.createElement(
          Button,
          { id: 'botao-certo' },
          React.createElement(EmAndamento, null, 'Salvando')
        ),
        React.createElement(
          Button,
          { id: 'botao-ingenuo' },
          'Salvando',
          React.createElement(Reticencias, null)
        )
      )
    )
    await esperar(250)

    const vaoDoBotao = (id) => {
      const botao = host.querySelector('#' + id)
      const primeiroPonto = botao.querySelector('.reticencia')
      const alcance = document.createRange()
      alcance.selectNodeContents(botao)
      alcance.setEnd(primeiroPonto.parentElement, 0)
      return Math.round(alcance.getBoundingClientRect().right - primeiroPonto.getBoundingClientRect().left)
    }
    resultado['11. sem vão dentro do Button'] = {
      comEmAndamento: vaoDoBotao('botao-certo'),
      semEnvolver: vaoDoBotao('botao-ingenuo'),
      // O envolvido cola (0px); o solto herda o `gap-1.5` do botão.
      envolvidoCola: Math.abs(vaoDoBotao('botao-certo')) < 1,
      soltoAbreVao: Math.abs(vaoDoBotao('botao-ingenuo')) >= 4,
    }

    // 12: `<Carregando />` continua sendo o parágrafo de sempre, com as
    // reticências animadas — 19 telas passaram a chamá-lo.
    const { Carregando } = await import('/src/components/EmAndamento.tsx')
    root4.render(
      React.createElement(
        'div',
        null,
        React.createElement(Carregando, null),
        React.createElement(Carregando, { texto: 'Carregando filiais' })
      )
    )
    await esperar(250)
    const paragrafos = [...host.querySelectorAll('p')]
    resultado['12. Carregando'] = {
      textos: paragrafos.map((p) => p.innerText.replace(/\s+/g, ' ').trim()),
      pontos: host.querySelectorAll('.reticencia').length,
      classe: paragrafos[0].className,
    }
    root4.unmount()
  } finally {
    await db.filaOperacoes.delete(ID_TESTE)
    host.remove()
  }

  const depois = (await db.filaOperacoes.toArray()).map((i) => i.id).sort()
  resultado['10. fila real intacta'] = JSON.stringify(antes) === JSON.stringify(depois)

  return resultado
}
