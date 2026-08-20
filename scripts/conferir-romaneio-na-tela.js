// NÃO roda com node. Isto é pra rodar no console do navegador (F12 →
// Console), com o app aberto em `npm run dev`. **Não precisa estar
// logado** e **não fala com o Supabase**.
//
// O QUE ELE PROVA
//
// Que a página do Romaneio (`src/pages/Romaneio.tsx`) diz a verdade em
// duas coisas que o resto dos testes não alcança:
//
//   1. o SLOT da assinatura interna não é apresentado como CARGO —
//      `tipo_signatario = 'caixa'` nomeia o lado da farmácia e está
//      dentro do `signature_hash`, mas quem assina pode ser gerente ou
//      admin, e a tela dizia "caixa" para todos;
//   2. os relógios ficam pareados por COLUNA — balcão à esquerda,
//      servidor à direita — mesmo quando um campo opcional aparece só de
//      um lado. É por isso que o teste mede a posição X, e não o texto:
//      no grid de fluxo automático os dois "Retorno" caíam em colunas
//      trocadas e o texto continuava exatamente o mesmo.
//
// Ele renderiza o componente REAL, com um QueryClient pré-semeado, então
// `useRomaneio` resolve do cache e nunca chega na rede. Não há como
// exercitar esta tela de outro jeito daqui: chegar nela pelo app exige
// logar, e senha não se digita em nome do usuário.
//
// AS DUAS COLUNAS SÓ EXISTEM A PARTIR DE 640px (`sm:` do Tailwind é media
// query de VIEWPORT). O resultado traz `viewport` e `duasColunas` junto
// justamente pra ninguém ler um "false" de layout empilhado como defeito.
//
// COMO RODAR — cole isto no console (repetir é seguro):
//
//   {
//     const u = '/@fs/' + '<caminho absoluto do repo>' +
//               '/scripts/conferir-romaneio-na-tela.js?t=' + Date.now()
//     const src = await (await fetch(u)).text()
//     const AF = Object.getPrototypeOf(async function () {}).constructor
//     console.log(await new AF(src)())
//   }
//
// O corpo inteiro vive dentro de um bloco porque `const` de topo no
// console do Chrome persiste entre colagens, e aí a segunda execução
// morre com "has already been declared" (§59).
{
  // O `?v=<hash>` NÃO é enfeite: sem ele o navegador carrega uma SEGUNDA
  // instância do React, os hooks do componente rodam contra um dispatcher
  // que não é o do root — e o sintoma é uma tela em branco, sem erro
  // nenhum no console. O hash é o `browserHash` da otimização atual e
  // muda quando o Vite re-otimiza (§45), então é LIDO do módulo real em
  // vez de ficar fixo aqui.
  const fonte = await (await fetch('/src/pages/Romaneio.tsx')).text()
  const v = fonte.match(/deps\/react\.js\?v=([0-9a-f]+)/)?.[1]
  if (!v) throw new Error('não achei o ?v= do react no módulo transformado')

  // `import()` com expressão faz o Vite REESCREVER este arquivo (injeta um
  // `import` estático de `/@vite/client` no topo), e aí ele deixa de rodar
  // dentro de um `AsyncFunction` — "Cannot use import statement outside a
  // module". Escondendo a chamada dentro de um `new Function` o arquivo
  // continua sendo servido como texto puro.
  const importar = new Function('u', 'return import(u)')
  const dep = (n) => importar(`/node_modules/.vite/deps/${n}.js?v=${v}`)

  // Os pré-bundles do Vite exportam só `default` (interop de CJS), então
  // `import { createRoot }` volta `undefined` sem erro nenhum — o defeito
  // aparece três telas depois, como "createRoot is not a function".
  const React = (await dep('react')).default
  const { createRoot } = (await dep('react-dom_client')).default
  const rq = await dep('@tanstack_react-query')
  const { Romaneio } = await import('/src/pages/Romaneio.tsx')

  const strokes = [[{ x: 10, y: 40, time: 1 }, { x: 80, y: 20, time: 2 }, { x: 150, y: 50, time: 3 }]]

  const assinaturas = (papel) => [
    {
      tipoSignatario: 'caixa',
      strokes,
      nome: 'Camilo Ferreira',
      agenciaNome: null,
      credencialPublicId: null,
      authMethod: 'sessao_autenticada',
      assinadoEm: '2026-08-20T00:30:14.000Z',
      assinadoEmLocal: '2026-08-19T21:30:12.000Z',
      ip: '177.10.20.30',
      geolocalizacao: null,
      signatureHash: 'a'.repeat(64),
      papelNoMomento: papel,
    },
    {
      tipoSignatario: 'motoboy',
      strokes,
      nome: 'João Silva',
      agenciaNome: 'Ágil Motos',
      credencialPublicId: '171233',
      authMethod: 'cartao_pin',
      assinadoEm: '2026-08-20T00:30:16.000Z',
      assinadoEmLocal: '2026-08-19T21:30:15.000Z',
      ip: '177.10.20.30',
      geolocalizacao: null,
      signatureHash: 'b'.repeat(64),
      papelNoMomento: null,
    },
  ]

  const payload = {
    vales: [
      {
        entrega_id: '018f0000-0000-7000-8000-000000000001',
        numero_vale: 'V-000521',
        tipo: 'cliente',
        cliente_nome: 'José da Conceição',
        cliente_endereco: 'Rua Duque de Caxias, 1234',
        quantidade_vales: 1,
        valor_compra_cents: 12399,
        valor_entrega_cents: 900,
        pagamentos_previstos: [{ forma: 'pix', valor_cents: 12399 }],
      },
    ],
  }

  const base = {
    romaneioId: '018f0000-0000-7000-8000-0000000000aa',
    numero: 'R-000013',
    status: 'selado',
    modo: 'online',
    seladoEm: '2026-08-20T00:30:14.000Z',
    ocorridoEmLocal: '2026-08-19T21:30:12.000Z',
    recebidoEmServidor: '2026-08-20T00:30:14.000Z',
    finalHash: 'f'.repeat(64),
    documentHash: 'd'.repeat(64),
    canonico: 'DCR1\n…',
    payload,
    conflito: null,
    lojaNome: 'Matriz',
    criadoPorNome: 'Camilo Ferreira',
    ip: '177.10.20.30',
    geolocalizacao: null,
    corrida: {
      saidaEm: '2026-08-20T00:30:14.000Z',
      saidaEmLocal: '2026-08-19T21:30:12.000Z',
      retornoEm: '2026-08-20T01:05:43.000Z',
      retornoEmLocal: '2026-08-19T22:05:41.000Z',
      status: 'fechada',
    },
    assinaturas: assinaturas('admin'),
  }

  const cenarios = {
    // Fechada, online: os quatro relógios presentes.
    A_fechada: base,
    // Offline sincronizada com corrida ainda aberta: a coluna do servidor
    // ganha um campo a mais ("Recebido"), que é justamente o que
    // desalinhava as colunas no fluxo automático.
    B_offline_aberta: {
      ...base,
      numero: 'R-000010',
      modo: 'offline_sincronizada',
      recebidoEmServidor: '2026-08-20T00:45:00.000Z',
      corrida: { ...base.corrida, retornoEm: null, retornoEmLocal: null, status: 'aberta' },
    },
    // Conflito: NÃO tem corrida nenhuma. Antes a tela dizia
    // "corrida ainda aberta" aqui, que é afirmar o que não sabe.
    C_conflito: {
      ...base,
      numero: 'R-000004',
      status: 'conflito',
      modo: 'offline_sincronizada',
      seladoEm: null,
      finalHash: null,
      conflito: { motivos: [{ autenticacao_falhou: true, pin_incorreto: true }] },
      corrida: null,
      assinaturas: assinaturas(null), // assinatura legada: sem papel gravado
    },
  }

  const host = document.createElement('div')
  host.id = 'conferencia-romaneio'
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:16px'
  document.body.appendChild(host)

  const resultados = {}

  for (const [nome, dados] of Object.entries(cenarios)) {
    // `staleTime: Infinity` + `refetchOnMount: false` são o que mantém o
    // teste offline de verdade: sem eles o TanStack considera o dado
    // semeado velho, refaz a busca contra o Supabase, e o `isError` do
    // componente engole a tela antes de qualquer campo aparecer.
    const qc = new rq.QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false },
      },
    })
    qc.setQueryData(['romaneio', dados.romaneioId], dados)

    const alvo = document.createElement('div')
    host.replaceChildren(alvo)
    const root = createRoot(alvo)
    root.render(
      React.createElement(
        rq.QueryClientProvider,
        { client: qc },
        React.createElement(Romaneio, { romaneioId: dados.romaneioId, onVoltar: () => {} })
      )
    )
    await new Promise((r) => setTimeout(r, 250))

    const texto = alvo.innerText
    // A posição X de cada rótulo é o que prova a COLUNA, não a ordem no
    // DOM: no grid antigo os dois "Retorno" caíam em colunas trocadas e o
    // texto continuava o mesmo.
    const campos = {}
    for (const el of alvo.querySelectorAll('span.w-40')) {
      campos[el.textContent.trim()] = {
        x: Math.round(el.getBoundingClientRect().left),
        y: Math.round(el.getBoundingClientRect().top),
        valor: el.nextElementSibling?.textContent?.trim() ?? null,
      }
    }
    resultados[nome] = { campos, texto }
    root.unmount()
  }

  host.remove()

  const col = (c, r) => (r.campos[c] ? r.campos[c].x : null)
  const A = resultados.A_fechada
  const B = resultados.B_offline_aberta
  const C = resultados.C_conflito

  return {
    // As duas colunas são `sm:grid-cols-2`, ou seja, media query de
    // VIEWPORT (≥640px), não do container. Abaixo disso o certo é
    // empilhar, e as asserções de coluna passam a não significar nada —
    // por isso a largura vem junto do resultado em vez de ficar
    // subentendida.
    viewport: window.innerWidth,
    duasColunas: window.innerWidth >= 640,
    // 1. O signatário deixou de ser "caixa"
    rotulos: {
      'nenhum "Caixa" na via A': !/(^|\n)Caixa(\n|$)/.test(A.texto),
      'nenhum "assin. caixa"': !A.texto.includes('assin. caixa'),
      'diz "Pela farmácia"': A.texto.includes('Pela farmácia'),
      'diz "assin. farmácia"': A.texto.includes('assin. farmácia'),
      // `innerText` devolve o texto RENDERIZADO, então o `uppercase` do
      // título já veio aplicado — comparar com a string do código daria
      // falso negativo.
      'diz "Assinatura da farmácia"': /assinatura da farmácia/i.test(A.texto),
      'mostra o cargo real (admin)': A.texto.includes('Administrador'),
      'assinatura legada não inventa cargo': !C.texto.includes('Administrador'),
    },
    // 2. Balcão embaixo de balcão, servidor embaixo de servidor
    colunas: {
      A: {
        balcao_mesma_coluna: col('Saída (balcão)', A) === col('Retorno (balcão)', A),
        servidor_mesma_coluna: col('Selado (servidor)', A) === col('Retorno (servidor)', A),
        balcao_a_esquerda: col('Saída (balcão)', A) < col('Selado (servidor)', A),
        saida_e_selado_na_mesma_linha:
          A.campos['Saída (balcão)'].y === A.campos['Selado (servidor)'].y,
        retornos_na_mesma_linha:
          A.campos['Retorno (balcão)'].y === A.campos['Retorno (servidor)'].y,
      },
      B_com_campo_extra_no_servidor: {
        balcao_mesma_coluna: col('Saída (balcão)', B) === col('Retorno (balcão)', B),
        servidor_mesma_coluna:
          col('Selado (servidor)', B) === col('Retorno (servidor)', B) &&
          col('Selado (servidor)', B) === col('Recebido (servidor)', B),
        balcao_a_esquerda: col('Saída (balcão)', B) < col('Selado (servidor)', B),
      },
    },
    // 3. Os três estados do retorno não se parecem
    tres_estados: {
      A_fechada: [A.campos['Retorno (balcão)'].valor, A.campos['Retorno (servidor)'].valor],
      B_aberta: [B.campos['Retorno (balcão)'].valor, B.campos['Retorno (servidor)'].valor],
      C_conflito: [C.campos['Retorno (balcão)'].valor, C.campos['Retorno (servidor)'].valor],
    },
    xs_A: Object.fromEntries(Object.entries(A.campos).map(([k, v]) => [k, `x=${v.x} y=${v.y}`])),
  }
}
