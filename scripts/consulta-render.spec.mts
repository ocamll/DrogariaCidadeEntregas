// npx tsx scripts/consulta-render.spec.mts
//
// É o único spec que RENDERIZA componente, então é o único que depende
// do runtime de JSX — e o `tsconfig.json` da raiz não serve pra isso. O
// `tsx` só aplica `compilerOptions` a arquivo que o tsconfig INCLUI, e a
// raiz tem `files: []`. Medido em 2026-09-13, com `jsx` e `paths`
// iguais: `files: []` quebra, `include: ["src"]` passa. Sem o tsconfig do
// app, `Consulta.tsx` sai no runtime clássico e o spec morre com
// `React is not defined` antes da primeira asserção, sem imprimir linha
// `FALHA` nenhuma — e a varredura de specs contava isso como zero falhas.
//
// Por isso o spec fixa o próprio tsconfig: chamado sem ele, reexecuta a
// si mesmo com `TSX_TSCONFIG_PATH` apontando pro `tsconfig.app.json`, que
// é exatamente o que `--tsconfig` faz por baixo. Os dois jeitos de chamar
// funcionam. O que NÃO resolve, e já foi tentado:
//
//   pragma de JSX aqui      vale só pro arquivo onde está; o JSX que
//                           quebra é o do componente
//   `jsx` na raiz           ignorado, por causa do `files: []`
//   `include` na raiz       a raiz deixaria de ser só referência, e o
//                           `tsc -b` passaria a compilar `src` por ela
//
// Quem varre specs conta a SAÍDA do processo, não linhas `FALHA`: spec
// que aborta não chega a escrever nenhuma.
//
// ---------------------------------------------------------------------
// O QUE ESTE SPEC ALCANÇA E OS OUTROS DOIS NÃO
// ---------------------------------------------------------------------
//
//   estado-de-consulta.spec         a DECISÃO está certa   (`apresentar`)
//   fiacao-estado-de-consulta.spec  o componente é CASCA   (lê o fonte)
//   este                            a casca RENDERIZA o que a decisão diz
//
// Os dois primeiros, juntos, ainda deixariam passar uma casca que lê
// `apresentar()` e ignora o resultado — o texto do arquivo diria a coisa
// certa e a tela faria outra. Aqui o componente roda de verdade, sem
// navegador, por `react-dom/server`.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createElement as h, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Consulta } from '../src/components/Consulta.tsx'
import type { EstadoDeConsulta } from '../src/lib/estadoDeConsulta.ts'

// Importar o componente compilado errado é inofensivo: o JSX só executa
// no render, e este processo sai antes de renderizar qualquer coisa. O
// filho já nasce com a variável, então não há como reexecutar em laço.
if (!process.env.TSX_TSCONFIG_PATH) {
  const filho = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tsconfig.app.json', import.meta.url)),
    },
  })
  process.exit(filho.status ?? 1)
}

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

type Props = {
  estado: EstadoDeConsulta<string[]>
  vazio?: ReactNode
  aoRecarregar?: () => void
}

/** Renderiza com um filho reconhecível, pra dar pra afirmar se ele saiu. */
function render(props: Props): string {
  return renderToStaticMarkup(
    h(
      Consulta as never,
      props as never,
      ((dados: string[]) => h('span', null, `DADOS:${dados.join(',')}`)) as never
    )
  )
}

const temBotao = (html: string) => /<button/.test(html)
const AMBAR = 'text-amber-700'
const FALHA = 'text-destructive'

// ---------------------------------------------------------------------
console.log('\n--- (1) inactive não põe NADA na tela ---')
// ---------------------------------------------------------------------
{
  const html = render({ estado: { estado: 'inactive' }, vazio: 'NENHUM' })
  checa('não renderiza nada', html === '', JSON.stringify(html))
  checa('nem os dados', !html.includes('DADOS'))
  checa('nem a frase de vazio', !html.includes('NENHUM'))
  checa('nem botão', !temBotao(html))
}

// ---------------------------------------------------------------------
console.log('\n--- (2) loading mostra progresso, e só ---')
// ---------------------------------------------------------------------
{
  const html = render({ estado: { estado: 'loading' }, vazio: 'NENHUM' })
  checa('diz que está carregando', /Carregando/.test(html))
  checa('anima as reticências', /reticencia/.test(html))
  checa('não mostra dados', !html.includes('DADOS'))
  checa('NÃO afirma vazio', !html.includes('NENHUM'))
  checa('não oferece botão', !temBotao(html))
}

// ---------------------------------------------------------------------
console.log('\n--- (3) ready renderiza o dado ---')
// ---------------------------------------------------------------------
{
  const html = render({
    estado: { estado: 'ready', dados: ['a', 'b'], procedencia: 'servidor' },
    vazio: 'NENHUM',
  })
  checa('renderiza os dados', html.includes('DADOS:a,b'))
  checa('sem afirmar vazio', !html.includes('NENHUM'))
  checa('sem aviso nenhum', !html.includes(AMBAR) && !html.includes(FALHA))
  checa('sem botão', !temBotao(html))
}

// ---------------------------------------------------------------------
console.log('\n--- (4) SÓ ready pode afirmar "nenhum registro" ---')
// ---------------------------------------------------------------------
{
  // É a invariante central do E2, agora exercitada no render.
  const vazioDeVerdade = render({
    estado: { estado: 'ready', dados: [], procedencia: 'servidor' },
    vazio: 'NENHUM',
  })
  checa('ready COM lista vazia afirma vazio', vazioDeVerdade.includes('NENHUM'))
  checa('e não chama o filho', !vazioDeVerdade.includes('DADOS'))

  // E os quatro que NÃO sabem, nenhum deles.
  const naoSabem: Array<[string, EstadoDeConsulta<string[]>]> = [
    ['inactive', { estado: 'inactive' }],
    ['loading', { estado: 'loading' }],
    ['unavailable', { estado: 'unavailable' }],
    ['error', { estado: 'error', erro: new Error('x') }],
  ]
  for (const [nome, estado] of naoSabem) {
    checa(`${nome} não põe "nenhum registro" na tela`,
      !render({ estado, vazio: 'NENHUM' }).includes('NENHUM'))
  }
}

// ---------------------------------------------------------------------
console.log('\n--- (5) unavailable: informa, NÃO oferece botão ---')
// ---------------------------------------------------------------------
{
  // A asserção mais importante do E2.2. `aoRecarregar` vai PASSADO de
  // propósito: uma casca descuidada renderizaria o botão só porque tem
  // callback em mãos, e o operador aprenderia a martelar uma consulta
  // que o sistema já sabe que não pode executar.
  const html = render({ estado: { estado: 'unavailable' }, aoRecarregar: () => {} })
  checa('diz que os dados estão indisponíveis', html.includes('Dados indisponíveis no momento.'))
  checa('e explica por quê', html.includes('Sem conexão e sem dados disponíveis neste dispositivo.'))
  checa('com tom de AVISO, não de falha', html.includes(AMBAR) && !html.includes(FALHA))
  checa('NÃO tem botão, mesmo com aoRecarregar passado', !temBotao(html), html.slice(0, 120))
  checa('e não convida a repetir', !/Tentar novamente|Atualizar/.test(html))

  // A variante muda a frase, nunca a ausência do botão.
  const verif = renderToStaticMarkup(
    h(Consulta as never,
      { estado: { estado: 'unavailable' }, variante: 'verificacao', aoRecarregar: () => {} } as never,
      (() => null) as never)
  )
  checa('a variante de verificação fala diferente', verif.includes('Não foi possível verificar agora.'))
  checa('e também não tem botão', !temBotao(verif))
}

// ---------------------------------------------------------------------
console.log('\n--- (6) error: acusa a falha e OFERECE tentar de novo ---')
// ---------------------------------------------------------------------
{
  const html = render({ estado: { estado: 'error', erro: new Error('x') }, aoRecarregar: () => {} })
  checa('diz que não conseguiu carregar', html.includes('Não foi possível carregar os dados.'))
  checa('com tom de FALHA', html.includes(FALHA))
  checa('e NÃO com o âmbar de aviso', !html.includes(AMBAR))
  checa('oferece o botão', temBotao(html) && html.includes('Tentar novamente'))

  // Sem callback não há botão — a tela continua honesta, só não age.
  const sem = render({ estado: { estado: 'error', erro: null } })
  checa('sem aoRecarregar, diz a mesma coisa', sem.includes('Não foi possível carregar os dados.'))
  checa('e não desenha botão morto', !temBotao(sem))
}

// ---------------------------------------------------------------------
console.log('\n--- (7) ready sobre cache: o dado FICA, e o aviso vai junto ---')
// ---------------------------------------------------------------------
{
  // Sem rede: mostra, avisa, não oferece atualizar — não há a quem pedir.
  const semRede = render({
    estado: { estado: 'ready', dados: ['a'], procedencia: 'cache_sem_rede' },
    aoRecarregar: () => {},
  })
  checa('offline: os dados continuam visíveis', semRede.includes('DADOS:a'))
  checa('offline: avisa que podem estar desatualizados',
    semRede.includes('Exibindo dados disponíveis offline'))
  checa('offline: NÃO oferece atualizar', !temBotao(semRede))

  // Depois de falha: mostra, avisa, e AÍ oferece — houve tentativa.
  const aposFalha = render({
    estado: { estado: 'ready', dados: ['a'], procedencia: 'cache_apos_falha' },
    aoRecarregar: () => {},
  })
  checa('após falha: os dados continuam visíveis', aposFalha.includes('DADOS:a'))
  checa('após falha: avisa que não atualizou',
    aposFalha.includes('Não foi possível atualizar.'))
  checa('após falha: oferece Atualizar', temBotao(aposFalha) && aposFalha.includes('Atualizar'))
  checa('e o rótulo NÃO é "Tentar novamente"', !aposFalha.includes('Tentar novamente'))
}

// ---------------------------------------------------------------------
console.log('\n--- (8) `estaVazio` para dado que não é array ---')
// ---------------------------------------------------------------------
{
  // O dado paginado (`{ entregas, total }`) não é array, então o padrão
  // não o reconhece — e a tela precisa dizer o que é vazio nele.
  type Pagina = { entregas: string[]; total: number }
  const paginaVazia: EstadoDeConsulta<Pagina> = {
    estado: 'ready',
    dados: { entregas: [], total: 0 },
    procedencia: 'servidor',
  }
  const comPredicado = renderToStaticMarkup(
    h(Consulta as never,
      { estado: paginaVazia, vazio: 'NENHUM', estaVazio: (d: Pagina) => d.total === 0 } as never,
      (() => h('span', null, 'DADOS')) as never)
  )
  checa('com `estaVazio`, afirma vazio', comPredicado.includes('NENHUM'))

  const semPredicado = renderToStaticMarkup(
    h(Consulta as never,
      { estado: paginaVazia, vazio: 'NENHUM' } as never,
      (() => h('span', null, 'DADOS')) as never)
  )
  // Sem o predicado ele renderiza o filho — que é o padrão SEGURO:
  // errar pra "mostra a tabela vazia" é melhor que errar pra "afirma que
  // não há nada", que é o defeito que o E2 veio matar.
  checa('sem `estaVazio`, NÃO inventa vazio', !semPredicado.includes('NENHUM'))
  checa('e entrega o dado pra tela decidir', semPredicado.includes('DADOS'))
}

console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
