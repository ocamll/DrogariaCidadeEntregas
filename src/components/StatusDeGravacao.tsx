import { useEffect, useRef, useState } from 'react'
import { useSituacaoDaOperacao } from '@/data/filaOffline'
import { Reticencias } from '@/components/Reticencias'

/**
 * O aviso que aparece depois de a tela enfileirar alguma coisa.
 *
 * ANTES: cada tela montava a frase inteira à mão
 * (`"Entrega de X salva — sincronizando…"`) e a punha num estado que
 * NUNCA era limpo. A frase só saía do ar quando outra gravação a
 * substituía, ou quando a tela era desmontada. Na prática ela ficava lá
 * — e ficava afirmando que havia sincronização em curso muito depois de
 * a operação ter subido. Pior: ficava exatamente igual se a operação
 * tivesse FALHADO.
 *
 * AGORA a frase é derivada do estado real da fila, e ela tem fim:
 *
 *   na fila            → "… salva — sincronizando" + reticências animadas
 *   saiu da fila       → "… salva — sincronizada", e o aviso some sozinho
 *   falhou (retentável)→ diz que não subiu e que vai tentar de novo
 *   recusa definitiva  → manda olhar o indicador do topo, e NÃO some
 *   `put` falhou       → diz que NÃO salvou (antes isso era engolido)
 *
 * Só o caso feliz se apaga sozinho. Aviso de problema que desaparece
 * enquanto ninguém olha é a mesma classe de defeito que este componente
 * veio corrigir, de cabeça pra baixo.
 *
 * Offline a frase fica em "sincronizando" indefinidamente, e isso é o
 * certo: é verdade, e o indicador do cabeçalho conta quantas estão
 * paradas.
 */
export type Gravacao = {
  /** O fato, sem cláusula de sincronização: "Entrega de José salva". */
  texto: string
  /** O que `enfileirarOperacao` devolve. A promessa resolve depois do
   *  `put`, então até lá a resposta honesta é "sincronizando". */
  enfileirando: Promise<string>
}

/**
 * Monta a `Gravacao`. Use SEMPRE isto, nunca o objeto literal.
 *
 * O `catch` vazio parece decorativo e não é. Quem trata a rejeição de
 * verdade é o efeito lá embaixo — mas efeito roda num tick posterior, e
 * até lá o navegador já decidiu que a promessa é uma
 * `Uncaught (in promise)` e despejou o erro no console. Anexar uma
 * reação AQUI, no mesmo tick em que a promessa nasce, marca-a como
 * tratada sem tirar nada de quem trata depois: `.catch()` registra uma
 * reação sobre a original, não a consome.
 *
 * Medido: sem esta linha, cada falha de gravação suja o console com um
 * erro não tratado, ao lado da mensagem correta na tela.
 */
export function gravacaoEnfileirada(texto: string, enfileirando: Promise<string>): Gravacao {
  void enfileirando.catch(() => {})
  return { texto, enfileirando }
}

/** Quanto o "sincronizada" fica no ar antes de o aviso sumir. */
const MS_ATE_SUMIR = 2_500

export function StatusDeGravacao({
  gravacao,
  onLimpar,
}: {
  gravacao: Gravacao | null
  onLimpar: () => void
}) {
  const [idFila, setIdFila] = useState<string | null>(null)
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null)

  useEffect(() => {
    setIdFila(null)
    setErroAoSalvar(null)
    if (!gravacao) return
    // `vivo` porque uma gravação nova pode chegar antes de a anterior
    // resolver — sem isso o id velho sobrescreveria o novo e o aviso
    // passaria a acompanhar a operação errada.
    let vivo = true
    gravacao.enfileirando.then(
      (id) => {
        if (vivo) setIdFila(id)
      },
      (e: unknown) => {
        if (vivo) setErroAoSalvar(e instanceof Error ? e.message : String(e))
      }
    )
    return () => {
      vivo = false
    }
  }, [gravacao])

  const situacao = useSituacaoDaOperacao(idFila)

  // O sumiço mora aqui e não em quem chama, senão cada tela teria que
  // lembrar de agendá-lo — e foi justamente esquecer disso três vezes que
  // deixou a frase parada na tela. O timer é reiniciado pelo próprio
  // efeito quando a gravação muda, então um "sumir" agendado nunca apaga
  // um aviso mais novo que o dele.
  //
  // `onLimpar` NÃO entra nas dependências, e isto não é descuido: as três
  // telas passam uma arrow inline, que é uma função nova a cada render.
  // Com ela na lista, qualquer re-render do pai — o caixa digitando a
  // próxima entrega, por exemplo — recriaria o timer do zero, e o aviso
  // ficaria na tela pra sempre enquanto alguém estivesse trabalhando. Ou
  // seja: exatamente o defeito que este componente veio corrigir,
  // reintroduzido pela porta dos fundos. A ref mantém a chamada atual sem
  // fazer a identidade dela virar dependência.
  const limparRef = useRef(onLimpar)
  useEffect(() => {
    limparRef.current = onLimpar
  })

  const podeSumir = situacao === 'sincronizada' && !erroAoSalvar
  useEffect(() => {
    if (!podeSumir) return
    const t = setTimeout(() => limparRef.current(), MS_ATE_SUMIR)
    return () => clearTimeout(t)
  }, [podeSumir, gravacao])

  if (!gravacao) return null

  if (erroAoSalvar) {
    return (
      <p className="text-sm text-destructive">
        Não consegui salvar neste computador: {erroAoSalvar}. Tenta de novo.
      </p>
    )
  }

  if (situacao === 'erro') {
    return (
      <p className="text-sm text-destructive">
        {gravacao.texto}, mas ainda não subiu — vou tentar de novo sozinho.
      </p>
    )
  }

  if (situacao === 'atencao') {
    return (
      <p className="text-sm text-destructive">
        {gravacao.texto}, mas a sincronização parou. Abre "Precisa de atenção" no topo da tela.
      </p>
    )
  }

  if (situacao === 'bloqueada') {
    return (
      <p className="text-sm text-destructive">
        {gravacao.texto}, mas está registrada por outra conta — só sincroniza quando ela entrar
        neste computador.
      </p>
    )
  }

  if (situacao === 'sincronizada') {
    return <p className="text-sm text-muted-foreground">{gravacao.texto} — sincronizada.</p>
  }

  // `situacao === null` (a promessa ainda não resolveu) cai aqui de
  // propósito: nesse instante a operação está mesmo a caminho da fila.
  return (
    <p className="text-sm text-muted-foreground">
      {gravacao.texto} — sincronizando
      <Reticencias />
    </p>
  )
}
