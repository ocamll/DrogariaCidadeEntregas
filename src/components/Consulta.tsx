import type { ReactNode } from 'react'
import {
  apresentar,
  type EstadoDeConsulta,
  type VarianteDeConsulta,
  type Apresentacao,
} from '@/lib/estadoDeConsulta'
import { Button } from '@/components/ui/button'
import { Carregando } from '@/components/EmAndamento'

// O COMPONENTE DO E2.
//
// Ele é CASCA. Toda decisão — quem mostra dado, quem ganha botão, qual
// tom, qual frase — mora em `apresentar()`, que é pura e está coberta
// por `scripts/estado-de-consulta.spec.mts`. Aqui só há JSX.
//
// A divisão não é preciosismo: este projeto testa sem navegador, e uma
// regra escrita dentro do `.tsx` só seria conferível abrindo a tela e
// tirando a internet.
//
// ---------------------------------------------------------------------
// A INVARIANTE, E ELA É ESTRUTURAL
// ---------------------------------------------------------------------
//
//     "nenhum registro"  só existe DENTRO do ramo `ready`
//
// O `children` é função e só é chamado com dado; o `vazio` só é
// consultado depois de `mostraDados`. Não há como uma tela afirmar vazio
// sem ter havido resposta — não porque alguém lembrou de checar, mas
// porque o galho onde a frase mora fica pendurado no `ready`.
//
// Era esse o defeito em nove telas: `isLoading` vem `false` numa query
// PAUSADA, e a cadeia caía no último ramo dizendo "Nenhum vale
// encontrado" sem nunca ter perguntado.

export function Consulta<T>({
  estado,
  children,
  vazio,
  estaVazio = vazioPorPadrao,
  variante = 'lista',
  aoRecarregar,
}: {
  estado: EstadoDeConsulta<T>
  /** Só é chamado quando há dado. É o que torna o resto inalcançável. */
  children: (dados: T) => ReactNode
  /** A frase de "nenhum registro". Só sai em `ready` com dado vazio. */
  vazio?: ReactNode
  /**
   * Como reconhecer vazio nesta consulta. O padrão cobre array; dado
   * paginado (`{ entregas, total }`) precisa dizer o que é vazio nele.
   */
  estaVazio?: (dados: T) => boolean
  variante?: VarianteDeConsulta
  /**
   * Normalmente o `refetch` da query. Serve aos DOIS botões — o rótulo
   * é escolhido por `apresentar()`, não por quem chama, pra "Tentar
   * novamente" e "Atualizar" não divergirem de tela pra tela.
   *
   * Não passar nada é legítimo: a tela fica sem botão, e continua
   * dizendo a verdade sobre o estado.
   */
  aoRecarregar?: () => void
}) {
  const como = apresentar(estado, variante)

  if (como.mostraDados && estado.estado === 'ready') {
    return (
      <>
        <AvisoDaConsulta apresentacao={como} aoRecarregar={aoRecarregar} />
        {/* AQUI, e só aqui, "vazio" é uma afirmação verdadeira. */}
        {estaVazio(estado.dados) && vazio ? vazio : children(estado.dados)}
      </>
    )
  }

  if (como.emAndamento) return <Carregando />

  return <AvisoDaConsulta apresentacao={como} aoRecarregar={aoRecarregar} />
}

/**
 * O bloco de mensagem sozinho.
 *
 * Exportado porque a família A (bipar cartão, conferir PIN) precisa dele
 * INLINE, no meio de um formulário, sem o embrulho de dado do
 * `<Consulta>`. Duas cópias da mesma frase divergiriam — é o defeito que
 * `papeis.ts` já resolveu pro rótulo do signatário.
 */
export function AvisoDaConsulta({
  apresentacao,
  aoRecarregar,
}: {
  apresentacao: Apresentacao
  aoRecarregar?: () => void
}) {
  const { aviso, acao } = apresentacao
  if (!aviso) return null

  // `aviso` é âmbar (o mesmo de "sem internet" no resto do app);
  // `falha` é destructive. Ver o comentário de `TomDaConsulta`.
  const cor =
    aviso.tom === 'falha' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'

  return (
    <div className="flex flex-col items-start gap-1 text-sm">
      <p className={cor}>{aviso.titulo}</p>
      {aviso.detalhe && <p className="text-xs text-foreground/70">{aviso.detalhe}</p>}
      {/* Sem `acao` não há botão — e em `unavailable` nunca há, mesmo
          com `aoRecarregar` passado. Quem decide é `apresentar()`. */}
      {acao && aoRecarregar && (
        <Button variant="outline" size="sm" className="mt-1" onClick={aoRecarregar}>
          {acao.rotulo}
        </Button>
      )}
    </div>
  )
}

/**
 * UM CAMPO DE FORMULÁRIO QUE DEPENDE DE UMA CONSULTA.
 *
 * É composição diferente, não um segundo contrato — o vocabulário é o
 * mesmo `EstadoDeConsulta`, e quem decide continua sendo `apresentar()`.
 * O que muda é o ESCOPO: numa lista o `<Consulta>` domina a área de
 * conteúdo; num formulário ele não pode, porque o operador está no meio
 * de um lançamento.
 *
 *     lista        → a consulta É o conteúdo, pode substituí-lo
 *     campo        → a consulta é DEPENDÊNCIA de um campo
 *                    o formulário fica, só o campo trava
 *
 * Duas regras que vêm disso, e valem para quem for usar:
 *
 *   1. NÃO limpar o resto do formulário quando esta consulta cai. O que
 *      ficou indisponível foi a filial, não a observação que o caixa
 *      digitou.
 *   2. NÃO apagar uma seleção que já existia. Transformar
 *      indisponibilidade em perda de trabalho é pior que o problema —
 *      se o fluxo exigir revalidar, quem barra é o submit, não o campo.
 */
export function CampoDependente<T>({
  estado,
  rotulo,
  vazio,
  estaVazio = vazioPorPadrao,
  aoRecarregar,
  children,
}: {
  estado: EstadoDeConsulta<T>
  /** Substantivo no PLURAL: "Filiais", "Cidades". Ver a nota na lib. */
  rotulo: string
  /** A frase de "não há nenhuma". Só sai em `ready` com lista vazia. */
  vazio: ReactNode
  estaVazio?: (dados: T) => boolean
  aoRecarregar?: () => void
  /** `dados` só vem preenchido em `ready`; `habilitado` governa o campo. */
  children: (dados: T | undefined, habilitado: boolean) => ReactNode
}) {
  const pronto = estado.estado === 'ready'
  const dados = pronto ? estado.dados : undefined
  const semNenhum = pronto && estaVazio(estado.dados)
  // Habilitado só quando SABEMOS que há o que escolher.
  const habilitado = pronto && !semNenhum

  // O rótulo vai como VARIANTE, e quem escreve a frase continua sendo
  // `apresentar()`. A primeira versão disto montava o título aqui, e o
  // gate da fiação reprovou — com razão: escolher texto é decidir, e
  // decisão não mora na casca.
  const como = apresentar(estado, { campo: rotulo })

  return (
    <>
      {children(dados, habilitado)}
      {como.emAndamento && (
        <Carregando texto={`Carregando ${rotulo.toLowerCase()}`} className="text-xs" />
      )}
      {semNenhum && vazio}
      <AvisoDaConsulta apresentacao={como} aoRecarregar={aoRecarregar} />
    </>
  )
}

function vazioPorPadrao(dados: unknown): boolean {
  return Array.isArray(dados) && dados.length === 0
}
