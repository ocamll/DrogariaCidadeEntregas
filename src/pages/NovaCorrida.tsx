import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthProfile } from '@/data/auth'
import { useCidadeDaLoja } from '@/data/lojas'
import { useAgenciasDaCidade, useMototaxistas } from '@/data/corridas'
import {
  useValesParaSaida,
  prepararRomaneio,
  autorizarSaida,
  selarRomaneio,
  ErroDoServidor,
  documentHashLocal,
  type SaidaOfflineInput,
} from '@/data/romaneios'
import {
  identificarCredencial,
  identificarNoCache,
  sincronizarCacheDeCredenciais,
  definirPin,
  autenticarCredencial,
  MOTIVO_FALHA_PIN_LABEL,
  pinAceitavel,
  publicIdDoToken,
} from '@/data/credenciais'
import { selarSegredos, calcularOfflineEventHashSaidaV2, envelopeDisponivel } from '@/lib/envelope'
import { useOnline } from '@/lib/useOnline'
import {
  MOTIVOS_EXCECAO,
  MOTIVO_EXCECAO_LABEL,
  mensagemDaAutorizacao,
  type MotivoExcecao,
} from '@/lib/excecaoDoGerente'
import {
  enfileirarOperacao,
  donoDaFila,
  useFilaOperacoesPendentes,
} from '@/data/filaOffline'
import type { EntradaCanonica, ValeCanonico } from '@/lib/canonico'
import { mensagemDeErro } from '@/lib/supabase'
import { uuidv7 } from '@/lib/uuid'
import { formatBRL } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Carregando, EmAndamento } from '@/components/EmAndamento'
import { Consulta, AvisoDaConsulta } from '@/components/Consulta'
import {
  apresentar,
  derivarEstado,
  aceito,
  recusado,
  type ConsultaComVeredito,
  type Veredito,
  type Procedencia,
} from '@/lib/estadoDeConsulta'

export function NovaCorrida({ profile, onVoltar }: { profile: AuthProfile; onVoltar: () => void }) {
  if (!profile.lojaId) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center text-muted-foreground">
        Sua conta não tem uma loja associada — corrida precisa de uma loja. Fale com o
        administrador.
      </div>
    )
  }
  return <NovaCorridaFluxo profile={profile} lojaId={profile.lojaId} onVoltar={onVoltar} />
}

type Credencial = {
  motoboyId: string
  motoboyNome: string
  agenciaId: string | null
  agenciaNome: string | null
  temPin: boolean
  // Online a identidade foi CONFIRMADA pelo servidor (o HMAC do token
  // bateu). Offline ela foi só INFORMADA pelo cartão, resolvida por um
  // cache local. A tela precisa dizer qual das duas é.
  verificada: boolean
}

type Resultado =
  | { kind: 'selado'; numero: string; finalHash: string | null }
  | { kind: 'offline' }
  | { kind: 'conflito'; numero: string | null; detalhe: unknown }
  | { kind: 'erro'; texto: string }

// ---------------------------------------------------------------------
// AS DUAS CONSULTAS DESTA TELA — e só elas.
//
// `bipar cartão` e `conferir PIN` perguntam algo e recebem uma resposta.
// `criar PIN` e `confirmar saída` ESCREVEM, e continuam com `ocupado`:
// transformar `EstadoDeConsulta` num estado genérico de qualquer async
// só pra zerar ocorrências de `ocupado` apagaria a distinção que ele
// existe pra marcar.
//
// Elas não vêm de `useQuery` — são imperativas, com `try/finally`. O
// vocabulário é o mesmo; o que muda é quem o produz. `derivarEstado` é
// UM produtor (o do TanStack), não o único.
// ---------------------------------------------------------------------

/**
 * Por que um cartão foi recusado. Todos são RESPOSTA — o sistema sabe e
 * está dizendo. O que NÃO está aqui é "não consegui perguntar", que é
 * `unavailable`, e "a tentativa falhou", que é `error`.
 */
type MotivoDoCartao =
  /** Nem chegou a consultar: não tem a cara de um cartão nosso. */
  | 'formato_invalido'
  /** O servidor respondeu: esse token não existe. */
  | 'nao_reconhecida'
  /** Existe, mas está bloqueada por tentativas de PIN. */
  | 'bloqueada'
  /** Existe, mas é de uma agência que não atende esta filial. */
  | 'fora_de_escopo'
  /**
   * Cartão de gerente — mas de OUTRA filial. A autorização excepcional é
   * conferida contra a filial do documento, então abrir o caminho seria
   * oferecer o impossível: o selo recusaria depois, com o motoboy
   * esperando. Offline este caso nem chega aqui, porque o cache só guarda
   * os gerentes da própria filial.
   */
  | 'gerente_de_outra_filial'

/** Idem para o PIN. `error` continua sendo outra coisa — ver o handler. */
type MotivoDoPin = 'pin_incorreto' | 'bloqueado' | 'nao_autenticado'

type EstadoDoCartao = ConsultaComVeredito<Credencial, MotivoDoCartao>
type EstadoDoPin = ConsultaComVeredito<true, MotivoDoPin>

/**
 * Embrulha um veredito em `ready`. Existe porque o veredito de domínio
 * só é alcançável DENTRO de uma resposta — e escrever isso à mão em cada
 * ramo convidaria alguém a criar um `recusado` solto.
 *
 * A `procedencia` fica honesta mesmo sem ser exibida hoje: o cartão
 * resolvido pelo cache offline não veio do servidor, e o dia em que
 * alguém quiser mostrar isso vai encontrar o dado certo em vez de um
 * `'servidor'` que nunca foi verdade.
 */
function prontoCom<T, M extends string>(
  veredito: Veredito<T, M>,
  procedencia: Procedencia = 'servidor'
): ConsultaComVeredito<T, M> {
  return { estado: 'ready', dados: veredito, procedencia }
}

type GerenteDaExcecao = {
  nome: string
  lojaNome: string | null
  temPin: boolean
  // Mesma distinção do cartão do motoboy: online o servidor RECONHECEU o
  // cartão; offline ele foi só INFORMADO, pelo cache.
  verificada: boolean
}

function NovaCorridaFluxo({
  profile,
  lojaId,
  onVoltar,
}: {
  profile: AuthProfile
  lojaId: string
  onVoltar: () => void
}) {
  const consultaVales = useValesParaSaida(lojaId)
  const estadoVales = derivarEstado(consultaVales)
  const vales = estadoVales.estado === 'ready' ? estadoVales.dados : undefined
  const cidadeId = useCidadeDaLoja(lojaId)
  const { data: agenciasDaCidade } = useAgenciasDaCidade(cidadeId)
  const pendentesDaFila = useFilaOperacoesPendentes()
  const queryClient = useQueryClient()

  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [token, setToken] = useState('')

  // A credencial deixou de ser estado próprio: ela é o que a consulta do
  // cartão devolveu quando ACEITOU. Assim não há como existir credencial
  // sem que tenha havido resposta — o que antes dependia de os dois
  // `setState` andarem sempre juntos.
  const [estadoCartao, setEstadoCartao] = useState<EstadoDoCartao>({ estado: 'inactive' })
  const credencial =
    estadoCartao.estado === 'ready' && estadoCartao.dados.veredito === 'aceito'
      ? estadoCartao.dados.valor
      : null
  // Só pra EXIBIÇÃO. Quem decide o caminho (handleConfirmar, criar PIN,
  // conferir identidade) continua lendo `navigator.onLine` na hora da
  // ação — entre o render e o clique a rede pode ter mudado, e ali o que
  // vale é o instante da ação. Ver a nota em lib/useOnline.ts.
  const online = useOnline()
  const [pin, setPin] = useState('')
  const [pinConfirmacao, setPinConfirmacao] = useState('')

  // O PIN precisa ser conferido ANTES de a tela liberar a confirmação.
  //
  // A primeira versão só checava `pinAceitavel(pin)`, que valida FORMATO
  // (6 dígitos, não sequência, não repetido) e nada mais — a verificação
  // de verdade só acontecia no "Confirmar saída", lá no fim. O servidor
  // recusava certo, mas a tela liberava tudo e o caixa só descobria o PIN
  // errado depois de colher as duas assinaturas. Pra quem está no balcão
  // isso é indistinguível de "qualquer PIN é aceito", e com razão.
  //
  // ISTO ERA `null | 'ok' | 'offline'`, E OS TRÊS ESTAVAM MISTURADOS.
  // O `null` significava ao mesmo tempo "ainda não perguntei", "o
  // servidor recusou" e "a rede caiu no meio" — as três terminavam em
  // `setPinConferido(null)` + uma string vermelha, então a tela voltava
  // a oferecer "Confirmar identidade" nos três casos. Certo pro PIN
  // errado; errado pro timeout, onde o operador não errou nada e
  // repetir nem chega a contar no bloqueio progressivo.
  const [estadoPin, setEstadoPin] = useState<EstadoDoPin>({ estado: 'inactive' })

  // O RAMO OFFLINE É CUSTÓDIA, NÃO CONSULTA — e por isso mora fora do
  // vocabulário acima. Sem rede ninguém RESPONDE nada sobre este PIN:
  // ele é capturado, vai selado no envelope e é conferido na
  // sincronização. Chamar isso de `ready` seria inventar uma resposta;
  // de `unavailable`, seria dizer que o fluxo não pode seguir — e ele
  // pode, é justamente o caminho que o projeto passou dias provando.
  const [pinCapturadoOffline, setPinCapturadoOffline] = useState(false)

  // ---------------------------------------------------------------------
  // A AUTORIZAÇÃO EXCEPCIONAL DO GERENTE — 4B
  //
  // Existe pra quando o motoboy NÃO TEM o que apresentar: perdeu o cartão
  // ou esqueceu o PIN. Por isso nada aqui pede o cartão nem o PIN dele —
  // pedir seria exigir justamente o que falta.
  //
  //   bipar o cartão do gerente  → abre este caminho
  //   motoboy                    → ESCOLHIDO pelo nome (identificado, não
  //                                autenticado); os vales ficam no nome dele
  //   motivo                     → cartão perdido ou PIN esquecido
  //   PIN                        → o do GERENTE, conferido no servidor
  //
  // Quem decide se o cartão é mesmo de um gerente ativo daquela filial é o
  // servidor, duas vezes (na autorização e de novo no selo). A tela só
  // não oferece o caminho pra quem visivelmente não pode usá-lo.
  // ---------------------------------------------------------------------
  const [gerente, setGerente] = useState<GerenteDaExcecao | null>(null)
  const [motoboyEscolhidoId, setMotoboyEscolhidoId] = useState('')
  const [motivo, setMotivo] = useState<MotivoExcecao | null>(null)
  const { data: mototaxistas } = useMototaxistas()
  // Só motoboy de agência que atende esta cidade — a mesma regra que o
  // cartão do motoboy já aplica em `handleBipar`. Oferecer um de outra
  // cidade seria oferecer uma saída que ninguém deveria fazer.
  const motoboysElegiveis = (mototaxistas ?? []).filter((m) =>
    agenciasDaCidade?.some((a) => a.id === m.agenciaId)
  )
  const motoboyEscolhido = motoboysElegiveis.find((m) => m.id === motoboyEscolhidoId) ?? null
  const nomeDaAgencia = (agenciaId: string | null) =>
    agenciaId ? (agenciasDaCidade?.find((a) => a.id === agenciaId)?.nome ?? null) : null

  const pinConfirmado = estadoPin.estado === 'ready' && estadoPin.dados.veredito === 'aceito'
  /**
   * A confirmação libera por DOIS caminhos, e eles não se confundem:
   * o servidor confirmou (online) ou o PIN foi capturado pra validação
   * posterior (offline). A tela diz qual foi, com todas as letras — o
   * que ela não pode é tratar os dois como a mesma afirmação.
   */
  const custodiaPronta = pinConfirmado || pinCapturadoOffline

  /** Recolhe TUDO que dependia da identidade. Trocar de cartão, mexer nos
   *  vales ou limpar a tela passam por aqui — nunca por um `setState`
   *  solto que esqueça um dos três. */
  function recolherCustodia() {
    setEstadoCartao({ estado: 'inactive' })
    setEstadoPin({ estado: 'inactive' })
    setPinCapturadoOffline(false)
    setToken('')
    setPin('')
    // A exceção depende da identidade tanto quanto o cartão do motoboy.
    setGerente(null)
    setMotoboyEscolhidoId('')
    setMotivo(null)
  }

  // O cartão lido era do gerente: abre o caminho excepcional. O token
  // FICA (é ele que vai ser autenticado); o motoboy e o motivo também
  // ficam, se já tinham sido pré-escolhidos por `chamarGerente`.
  function abrirExcecao(g: GerenteDaExcecao) {
    setGerente(g)
    setEstadoCartao({ estado: 'inactive' })
    setEstadoPin({ estado: 'inactive' })
    setPinCapturadoOffline(false)
    setPin('')
  }

  // O motoboy bipou o próprio cartão e o PIN não saiu. A identificação
  // dele já é certa, então ela fica PRÉ-ESCOLHIDA pro gerente — ler o
  // cartão do motoboy é atalho, nunca requisito do caminho excepcional.
  function chamarGerente() {
    const preEscolhido = credencial?.motoboyId ?? ''
    recolherCustodia()
    setMotoboyEscolhidoId(preEscolhido)
    setMotivo(preEscolhido ? 'pin_esquecido' : null)
  }
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)


  // O cache de credenciais é o que faz bipar funcionar sem rede. Atualiza
  // quando a tela monta e houver internet; se falhar, o cache anterior
  // continua valendo — que é exatamente pra isso que ele existe.
  //
  // A FILIAL VAI JUNTO desde o 4B.1: ela decide quais cartões de gerente
  // ficam guardados neste terminal — só os de quem pode autorizar AQUI.
  useEffect(() => {
    if (navigator.onLine) {
      void sincronizarCacheDeCredenciais(profile.lojaId).catch(() => {})
    }
  }, [profile.lojaId])

  // Vale que já saiu numa operação AINDA NA FILA não pode reaparecer aqui.
  //
  // Sem isto, offline: o caixa registra a saída, o vale continua
  // `pendente` no servidor (que é o certo — ver CLAUDE.md), a tela abre de
  // novo e oferece o mesmo vale. Ele sai duas vezes fisicamente, e o
  // servidor só descobre na sincronização, virando conflito. O servidor
  // recusa certo; o ponto é não deixar chegar lá.
  const jaNaFila = new Set(
    pendentesDaFila
      .filter((i) => i.tipo === 'romaneio_saida' && i.status !== 'terminal')
      .flatMap((i) => (i.payload as SaidaOfflineInput).entregaIds)
  )

  const disponiveis = (vales ?? []).filter((v) => !jaNaFila.has(v.entregaId))

  // Vales criados offline e ainda na fila NÃO podem sair, e a tela precisa
  // dizer isso — senão o caixa lança o vale, abre esta tela e conclui que
  // o sistema perdeu o lançamento.
  //
  // O motivo é o `numero_vale`: ele é gerado pelo BANCO (sequência
  // V-000001…, regra do CLAUDE.md) e entra no canônico, que é o documento
  // que as duas partes assinam. Um vale que ainda não subiu não tem
  // número, logo não tem como constar de um documento assinado. Não é
  // limitação de cache — cachear a lista não resolveria isto.
  const criadosNaFila = pendentesDaFila.filter(
    (i) => (i.tipo === 'entrega' || i.tipo === 'transferencia') && i.status !== 'terminal'
  ).length
  const escolhidos: ValeCanonico[] = disponiveis.filter((v) => selecionadas.has(v.entregaId))
  const totalEntrega = escolhidos.reduce((soma, v) => soma + v.valorEntregaCents, 0)
  const totalVales = escolhidos.reduce((soma, v) => soma + v.quantidadeVales, 0)

  function toggle(id: string) {
    setResultado(null)
    setSelecionadas((antes) => {
      const proximo = new Set(antes)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
    // Mexer nos vales muda o document_hash, e com ele qualquer autorização
    // já emitida deixa de valer. Limpar aqui evita a tela dizer "confirmado"
    // sobre um documento que não é mais o mesmo.
    recolherCustodia()
  }

  function montarEntrada(): EntradaCanonica {
    return {
      tenantId: profile.tenantId,
      lojaId,
      // Na exceção o motoboy é o ESCOLHIDO, e a agência é a dele — o
      // canônico afirma quem leva os vales, não quem autenticou.
      agenciaId: gerente ? (motoboyEscolhido?.agenciaId ?? null) : (credencial?.agenciaId ?? null),
      motoboyId: gerente ? (motoboyEscolhido?.id ?? '') : (credencial?.motoboyId ?? ''),
      caixaId: profile.id,
      vales: escolhidos,
    }
  }

  async function handleBipar(valor: string) {
    setErro(null)
    const limpo = valor.trim()

    // RECUSA, e não erro: nós SABEMOS que isto não é um cartão nosso —
    // a regra é local e não precisou perguntar a ninguém. Uma resposta
    // autoritativa negativa continua sendo uma resposta.
    if (!publicIdDoToken(limpo)) {
      setEstadoCartao(prontoCom(recusado('formato_invalido', 'Isso não parece um cartão do sistema. Bipa de novo.')))
      return
    }
    setToken(limpo)
    setEstadoCartao({ estado: 'loading' })

    try {
      let achada: Credencial | null = null

      if (navigator.onLine) {
        const online = await identificarCredencial(limpo)
        if (online && online.titular === 'gerente') {
          // Gerente de outra filial não autoriza saída DAQUI. O servidor
          // recusaria no selo; a tela não oferece.
          if (online.lojaId !== lojaId) {
            setEstadoCartao(
              prontoCom(
                recusado(
                  'gerente_de_outra_filial',
                  `${online.gerenteNome} é gerente${online.lojaNome ? ' da ' + online.lojaNome : ' de outra filial'}. Só o gerente desta filial autoriza a saída daqui.`
                )
              )
            )
            setToken('')
            return
          }
          if (online.bloqueadoAte && new Date(online.bloqueadoAte) > new Date()) {
            setEstadoCartao(
              prontoCom(
                recusado(
                  'bloqueada',
                  `Cartão do gerente bloqueado até ${new Date(online.bloqueadoAte).toLocaleTimeString('pt-BR')} por tentativas de PIN.`
                )
              )
            )
            setToken('')
            return
          }
          abrirExcecao({
            nome: online.gerenteNome,
            lojaNome: online.lojaNome,
            temPin: online.temPin,
            verificada: true,
          })
          return
        }
        if (online) {
          achada = {
            motoboyId: online.motoboyId,
            motoboyNome: online.motoboyNome,
            agenciaId: online.agenciaId,
            agenciaNome: online.agenciaNome,
            temPin: online.temPin,
            verificada: true,
          }
          if (online.bloqueadoAte && new Date(online.bloqueadoAte) > new Date()) {
            setEstadoCartao(
              prontoCom(
                recusado(
                  'bloqueada',
                  `Credencial bloqueada até ${new Date(online.bloqueadoAte).toLocaleTimeString('pt-BR')} por tentativas de PIN.`
                )
              )
            )
            return
          }
        }
        if (!achada) {
          // O servidor respondeu, e a resposta é "não existe".
          setEstadoCartao(prontoCom(recusado('nao_reconhecida', 'Credencial não reconhecida.')))
          setToken('')
          return
        }
      } else {
        const local = await identificarNoCache(limpo)
        if (!local) {
          // NÃO É RECUSA. Offline, o cache local é a única fonte, e ele
          // não saber deste cartão não significa que ele não exista —
          // significa que não há a quem perguntar. Dizer "credencial não
          // reconhecida" aqui seria acusar um cartão possivelmente
          // válido a partir da própria ignorância.
          setEstadoCartao({ estado: 'unavailable' })
          setToken('')
          return
        }
        // O cache guarda os dois titulares, e o do gerente é SÓ da própria
        // filial (lib/credencialNoCache.ts) — por isso não há recusa de
        // "outra filial" aqui. Saber de quem é o cartão não depende do
        // HMAC; o PIN do gerente é capturado e conferido na sincronização,
        // como o do motoboy.
        if (local.titular === 'gerente') {
          abrirExcecao({
            nome: local.titularNome,
            lojaNome: local.lojaNome,
            temPin: local.temPin,
            verificada: false,
          })
          return
        }
        achada = {
          motoboyId: local.motoboyId as string,
          motoboyNome: local.titularNome,
          agenciaId: local.agenciaId,
          agenciaNome: local.agenciaNome,
          temPin: local.temPin,
          // INFORMADA, não reconhecida — o cache resolveu o nome, o HMAC
          // não foi conferido por ninguém. A tela diz qual das duas é.
          verificada: false,
        }
      }

      // Uma agência de outra cidade não atende esta filial. É a mesma
      // regra do dropdown antigo, agora aplicada ao que o cartão trouxe.
      const permitida = agenciasDaCidade?.some((a) => a.id === achada.agenciaId)
      if (agenciasDaCidade && !permitida) {
        setEstadoCartao(
          prontoCom(
            recusado(
              'fora_de_escopo',
              `${achada.motoboyNome} é de ${achada.agenciaNome ?? 'uma agência sem cidade'}, que não atende esta filial.`
            )
          )
        )
        setToken('')
        return
      }

      setEstadoCartao(
        prontoCom(aceito(achada), achada.verificada ? 'servidor' : 'cache_sem_rede')
      )
    } catch (e) {
      // A TENTATIVA FALHOU — e isso não é uma afirmação sobre o cartão.
      // Antes caía no mesmo `setErro` das recusas, com a mesma cor, e o
      // caixa concluía que o cartão do motoboy tinha problema.
      setEstadoCartao({ estado: 'error', erro: e })
      setToken('')
    }
  }

  async function handleCriarPin() {
    setErro(null)
    const problema = pinAceitavel(pin)
    if (problema) return setErro(problema)
    if (pin !== pinConfirmacao) return setErro('Os dois PINs não são iguais.')
    if (!navigator.onLine) {
      return setErro('Criar PIN precisa de internet. Faça isso antes da próxima saída offline.')
    }

    setOcupado('pin')
    try {
      await definirPin(token, pin)
      // A credencial agora tem PIN. Ela vive DENTRO do veredito da
      // consulta do cartão, então a atualização entra lá — sem sair de
      // `ready`, porque a resposta sobre o cartão continua valendo.
      setEstadoCartao((atual) =>
        atual.estado === 'ready' && atual.dados.veredito === 'aceito'
          ? prontoCom(aceito({ ...atual.dados.valor, temPin: true }), atual.procedencia)
          : atual
      )
      setPinConfirmacao('')
      // Zera o campo e NÃO marca como conferido: acabou de criar, mas
      // ainda tem que digitar de novo e passar pelo servidor — é o que
      // prova que quem digitou lembra do que escolheu.
      setPin('')
      setEstadoPin({ estado: 'inactive' })
      setPinCapturadoOffline(false)
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setOcupado(null)
    }
  }

  // Confere o PIN contra o servidor ANTES de liberar a confirmação — o do
  // motoboy, ou o do gerente na exceção (a mesma função serve os dois
  // cartões, e é o servidor que sabe de quem é cada um).
  //
  // Usa `autenticarCredencial` e não `autorizarSaida` de propósito: a
  // autorização vale 2 minutos e está amarrada ao document_hash, então
  // emiti-la aqui a faria expirar enquanto a farmácia confere o resumo.
  // Aqui só se pergunta "é ele?"; a autorização de uso único nasce no
  // confirmar, fresca. São duas passadas de bcrypt (~600ms no total), o
  // que é barato perto de descobrir o PIN errado só na hora do selo.
  async function handleConferirPin() {
    setErro(null)
    const problema = pinAceitavel(pin)
    if (problema) return setErro(problema)

    // O RAMO OFFLINE PREVISTO. Não passa pelo vocabulário de consulta —
    // ninguém respondeu, e ninguém vai responder agora. O PIN é
    // CAPTURADO e validado na sincronização.
    if (!navigator.onLine) {
      setPinCapturadoOffline(true)
      setEstadoPin({ estado: 'inactive' })
      return
    }

    setEstadoPin({ estado: 'loading' })
    try {
      const r = await autenticarCredencial(token, pin)
      if (r.ok) {
        setEstadoPin(prontoCom(aceito(true as const)))
        return
      }
      // RECUSA: o servidor conferiu e disse não. Aqui repetir faz
      // sentido, e cada tentativa conta no bloqueio progressivo.
      setEstadoPin(
        prontoCom(
          recusado(
            r.motivo === 'bloqueado' ? 'bloqueado' : r.motivo === 'pin_incorreto' ? 'pin_incorreto' : 'nao_autenticado',
            r.motivo === 'bloqueado' && r.bloqueadoAte
              ? `${MOTIVO_FALHA_PIN_LABEL.bloqueado} Libera às ${new Date(r.bloqueadoAte).toLocaleTimeString('pt-BR')}.`
              : MOTIVO_FALHA_PIN_LABEL[r.motivo]
          )
        )
      )
    } catch (e) {
      // ERRO, E ISTO É O CONSERTO DE COMPORTAMENTO DO LOTE C.
      //
      // Antes este `catch` e a recusa acima terminavam os dois em
      // `setPinConferido(null)` + string vermelha: a tela voltava ao
      // início e reoferecia "Confirmar identidade" nos dois casos, sem
      // dizer qual tinha sido. O caixa relia o PIN no papel do motoboy
      // procurando um erro que podia não existir.
      //
      // Falha de rede NÃO é PIN errado, e a tela não pode sugerir que o
      // operador errou.
      setEstadoPin({ estado: 'error', erro: e })
    }
  }

  async function handleConfirmar() {
    setErro(null)
    if (escolhidos.length === 0) return setErro('Marca pelo menos um vale.')
    if (gerente) {
      if (!motoboyEscolhido) return setErro('Escolha o motoboy que vai levar os vales.')
      if (!motivo) return setErro('Informe o motivo: cartão perdido ou PIN esquecido.')
      if (!gerente.temPin) {
        return setErro('O cartão do gerente ainda não tem PIN. O gerente ativa em "Meu cartão".')
      }
      if (pinAceitavel(pin)) return setErro('Falta o PIN do gerente.')
    } else {
      if (!credencial) return setErro('Falta bipar o cartão do motoboy.')
      if (!credencial.temPin) return setErro('Este motoboy ainda precisa criar o PIN dele.')
      if (pinAceitavel(pin)) return setErro('Falta o PIN do motoboy.')
    }
    // Redundante com `podeConfirmar` (o botão já estaria desabilitado),
    // e fica de propósito: é a última barreira antes do selo, e formato
    // válido nunca substituiu identidade.
    if (!custodiaPronta) {
      return setErro(gerente ? 'Confirma o PIN do gerente antes.' : 'Confirma a identidade do motoboy antes.')
    }
    if (!envelopeDisponivel()) {
      // Sem a chave pública não há como proteger o PIN se isto precisar
      // cair na fila. Preferimos barrar a selar sem rede de segurança.
      return setErro(
        'Chave de segurança da saída não configurada neste ambiente (VITE_ROMANEIO_KEY_ID). Fale com o administrador.'
      )
    }

    setOcupado('confirmar')
    const entrada = montarEntrada()
    const romaneioId = uuidv7()
    const corridaId = uuidv7()
    const ocorridoEmLocal = new Date().toISOString()
    // QUEM VALIDOU, e por quê. Entram no hash offline, dentro do envelope e
    // na autorização — e o servidor confere os três contra o cartão que de
    // fato autenticou.
    const validacao = gerente ? ('gerente' as const) : ('motoboy' as const)
    const motivoExcecao: MotivoExcecao | null = gerente ? motivo : null

    try {
      const hashLocal = await documentHashLocal(entrada)
      let documentHash = hashLocal
      let autorizacaoId: string | null = null

      if (navigator.onLine) {
        // O servidor calcula o canônico por conta própria. Comparar aqui
        // transforma uma divergência entre as duas implementações num erro
        // imediato e legível, em vez de numa saída que "não sincroniza
        // nunca" descoberta semanas depois.
        const preparado = await prepararRomaneio({
          lojaId,
          agenciaId: entrada.agenciaId,
          motoboyId: entrada.motoboyId,
          entregaIds: escolhidos.map((v) => v.entregaId),
        })
        if (preparado.documentHash !== hashLocal) {
          setResultado({
            kind: 'erro',
            texto:
              'O documento calculado aqui não bate com o do servidor. Não dá pra assinar assim — avise o desenvolvedor.',
          })
          setOcupado(null)
          return
        }
        documentHash = preparado.documentHash

        const autorizacao = await autorizarSaida(
          token,
          pin,
          documentHash,
          gerente && motivo ? { motoboyId: entrada.motoboyId, motivo } : undefined
        )
        if (!autorizacao.ok) {
          setErro(mensagemDaAutorizacao(autorizacao.motivo, { porGerente: gerente !== null, operacao: 'saida' }))
          setOcupado(null)
          return
        }
        autorizacaoId = autorizacao.autorizacaoId
      }

      // O envelope é selado SEMPRE, mesmo online: se o selo falhar por
      // rede no meio do caminho, a operação cai na fila e lá o PIN já
      // precisa estar protegido. Selar custa milissegundos.
      // VERSÃO 2 (4B): sem traço. O hash prende ao envelope o que viaja no
      // corpo e NÃO está no canônico — o relógio do balcão, quem validou, o
      // motivo e o motoboy (que, na exceção, foi escolhido na tela).
      const offlineEventHash = await calcularOfflineEventHashSaidaV2({
        documentHash,
        romaneioId,
        validacao,
        motivoExcecao,
        motoboyId: entrada.motoboyId,
        ocorridoEmLocal,
      })
      const envelope = await selarSegredos({
        pin,
        credentialToken: token,
        operationId: romaneioId,
        documentHash,
        offlineEventHash,
        tipo: 'saida',
        // Selados junto do PIN: a Edge Function compara com o corpo e
        // recusa se alguém trocar o modo ou o motivo no caminho.
        validacao,
        motivoExcecao,
      })

      const paraFila: SaidaOfflineInput = {
        romaneioId,
        corridaId,
        lojaId,
        agenciaId: entrada.agenciaId,
        motoboyId: entrada.motoboyId,
        entregaIds: escolhidos.map((v) => v.entregaId),
        documentHash,
        validacao,
        motivoExcecao,
        ocorridoEmLocal,
        envelope,
        userId: profile.id,
      }

      if (autorizacaoId) {
        try {
          const selo = await selarRomaneio({
            romaneioId,
            corridaId,
            lojaId,
            agenciaId: entrada.agenciaId,
            motoboyId: entrada.motoboyId,
            entregaIds: paraFila.entregaIds,
            documentHash,
            autorizacaoId,
            ocorridoEmLocal,
          })
          setResultado(
            selo.ok
              ? { kind: 'selado', numero: selo.numero, finalHash: selo.finalHash }
              : { kind: 'conflito', numero: selo.numero, detalhe: selo.conflitos }
          )
          // Sem isto a tela continua oferecendo os vales que acabaram
          // de sair — a query tem cache e ninguém a invalidava.
          queryClient.invalidateQueries({ queryKey: ['vales-para-saida'] })
          queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
          queryClient.invalidateQueries({ queryKey: ['custodia-vales'] })
          queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
          limpar()
          return
        } catch (e) {
          // Recusa do servidor NÃO vira "registrada offline". Mandar pra
          // fila aqui faria o caixa ir embora achando que deu certo, e a
          // fila repetiria o mesmo erro pra sempre — foi exatamente o que
          // aconteceu no primeiro uso real, com um erro de FK aparecendo
          // como se fosse falta de internet.
          if (e instanceof ErroDoServidor) {
            setResultado({ kind: 'erro', texto: e.message })
            setOcupado(null)
            return
          }
          // Falha de rede no meio do selo: aí sim. A retirada física pode
          // ter acontecido, então NÃO se perde — vai pra fila com os
          // mesmos ids, e o reenvio é no-op se por acaso já tiver selado.
        }
      }

      await enfileirarOperacao('romaneio_saida', donoDaFila(profile), paraFila, {
        chave: corridaId,
      })
      setResultado({ kind: 'offline' })
      limpar()
    } catch (e) {
      setResultado({ kind: 'erro', texto: mensagemDeErro(e) })
    } finally {
      setOcupado(null)
    }
  }

  function limpar() {
    setSelecionadas(new Set())
    setPinConfirmacao('')
    recolherCustodia()
  }

  // `custodiaPronta` e não `pinAceitavel(pin)`: formato bem escrito não é
  // identidade confirmada. O caminho offline também libera — mas aí a
  // tela diz, com todas as letras, que a verificação ficou pra
  // sincronização.
  //
  // E repare no que NÃO libera: `unavailable` e `error`. Uma consulta
  // que não respondeu nunca vira autorização — se virasse, a tela
  // estaria trocando "não consegui conferir" por "conferi".
  const podeConfirmar =
    escolhidos.length > 0 &&
    custodiaPronta &&
    (gerente
      ? gerente.temPin && motoboyEscolhido !== null && motivo !== null
      : credencial !== null && credencial.temPin)

  // O resumo da conferência fala do MOTOBOY RESPONSÁVEL, venha ele do
  // cartão (fluxo normal) ou da escolha (exceção).
  const nomeDoMotoboy = gerente ? (motoboyEscolhido?.nome ?? null) : (credencial?.motoboyNome ?? null)
  const agenciaDoMotoboy = gerente
    ? nomeDaAgencia(motoboyEscolhido?.agenciaId ?? null)
    : (credencial?.agenciaNome ?? null)

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" className="mb-3" onClick={onVoltar}>
        ← Voltar para a lista
      </Button>

      {resultado && <ResultadoDaSaida resultado={resultado} onFechar={() => setResultado(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>Nova corrida</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Secao numero={1} titulo="Vales">
            {/* ESTA TELA JÁ TRATAVA O CASO À MÃO, e certo — foi ela que
                pagou o §50.2. O que ela tinha era a REGRA duplicada: o
                mesmo raciocínio de "não carregou ≠ não há", escrito aqui
                e agora escrito no derivador. Duas cópias, e a próxima
                correção precisaria ser feita nas duas por quem lembrasse
                das duas.

                O `estaVazio` é próprio porque "nenhum vale disponível"
                aqui não é `vales.length === 0`: um vale que já está numa
                operação da fila some da lista sem a consulta ter mudado. */}
            <Consulta
              estado={estadoVales}
              estaVazio={(todos) => todos.filter((v) => !jaNaFila.has(v.entregaId)).length === 0}
              vazio={
                <p className="text-sm text-muted-foreground">
                  Nenhum vale pendente pra sair agora.
                </p>
              }
              aoRecarregar={() => void consultaVales.refetch()}
            >
              {(todos) => {
                const lista = todos.filter((v) => !jaNaFila.has(v.entregaId))
                return (
                  <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                    {lista.map((vale) => (
                      <label key={vale.entregaId} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selecionadas.has(vale.entregaId)}
                          onChange={() => toggle(vale.entregaId)}
                        />
                        <span>
                          <strong>{vale.numeroVale}</strong> — {vale.clienteNome} (
                          {vale.clienteEndereco})
                          {vale.quantidadeVales > 1 && ` · ${vale.quantidadeVales} vales`}
                          {/* Entra no documento como linha `r`: confirmar a saída é
                              confirmar que esta receita tem que voltar. */}
                          {vale.temReceita && ' · traz receita'}
                        </span>
                      </label>
                    ))}
                  </div>
                )
              }}
            </Consulta>

            {/* Fora do `<Consulta>`: isto não fala da consulta, fala da
                FILA local — e continua verdadeiro mesmo sem resposta do
                servidor. Vale criado offline não tem `numero_vale`, que é
                gerado pelo banco e entra no documento assinado. */}
            {criadosNaFila > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {criadosNaFila} vale(s) lançado(s) sem internet ainda não aparecem aqui. O número do
                vale é gerado pelo servidor e faz parte do documento assinado, então eles só podem
                sair depois de sincronizar.
              </p>
            )}
          </Secao>

          <Secao numero={2} titulo="Motoboy" desabilitada={escolhidos.length === 0}>
            {!credencial && !gerente && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cartao">Bipa a credencial</Label>
                {/* O caminho excepcional começa AQUI, no mesmo campo: o
                    motoboy sem cartão ou sem PIN não tem o que bipar, e o
                    gerente bipa o dele. Não é um botão escondido. */}
                <p className="text-xs text-foreground/70">
                  {motoboyEscolhidoId
                    ? 'O motoboy já está identificado. Agora o gerente bipa o cartão dele.'
                    : 'Motoboy sem cartão ou sem PIN? O gerente da filial bipa o cartão dele aqui.'}
                </p>
                <Input
                  id="cartao"
                  autoFocus
                  placeholder="Passe o cartão no leitor…"
                  value={token}
                  disabled={escolhidos.length === 0 || estadoCartao.estado === 'loading'}
                  onChange={(e) => setToken(e.target.value)}
                  // O leitor age como teclado e manda Enter no fim. Digitar
                  // à mão também funciona — é a saída quando o leitor falha.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleBipar(e.currentTarget.value)
                  }}
                />
                {/* CADA DESFECHO NO SEU CANAL, e a cor dizendo qual é:
                    recusa acusa o cartão (vermelho), indisponível e erro
                    não (âmbar / vermelho de falha, com o texto certo).
                    Antes os três saíam do mesmo `setErro`, com a mesma
                    cor, e "não consegui perguntar" ficava idêntico a
                    "esse cartão não presta". */}
                {estadoCartao.estado === 'loading' && <Carregando texto="Consultando credencial" />}
                {estadoCartao.estado === 'ready' &&
                  estadoCartao.dados.veredito === 'recusado' && (
                    <p className="text-sm text-destructive">{estadoCartao.dados.mensagem}</p>
                  )}
                {estadoCartao.estado === 'unavailable' && (
                  <div className="flex flex-col gap-1">
                    <AvisoDaConsulta apresentacao={apresentar(estadoCartao, 'verificacao')} />
                    <p className="text-xs text-foreground/70">
                      Sem internet, só dá pra reconhecer cartões que já apareceram neste computador
                      antes — isso não quer dizer que o cartão seja inválido.
                    </p>
                  </div>
                )}
                {estadoCartao.estado === 'error' && (
                  <AvisoDaConsulta
                    apresentacao={apresentar(estadoCartao, 'verificacao')}
                    aoRecarregar={() => void handleBipar(token)}
                  />
                )}
              </div>
            )}

            {(credencial || gerente) && (
              <div className="flex flex-col gap-3">
                {credencial ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="font-medium">{credencial.motoboyNome}</p>
                        <p className="text-xs text-foreground/70">{credencial.agenciaNome ?? '—'}</p>
                      </div>
                      <Badge variant={credencial.verificada ? 'secondary' : 'outline'}>
                        {credencial.verificada ? 'Credencial reconhecida' : 'Credencial informada'}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={recolherCustodia}>
                        Trocar
                      </Button>
                    </div>
                    {/* Secundário, e só enquanto a identidade não está
                        estabelecida: com o PIN confirmado não há exceção a
                        pedir. */}
                    {!custodiaPronta && (
                      <button
                        type="button"
                        className="self-start text-xs text-foreground/70 underline underline-offset-2"
                        onClick={chamarGerente}
                      >
                        PIN esquecido? Chamar o gerente
                      </button>
                    )}
                  </>
                ) : gerente ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="font-medium">{gerente.nome}</p>
                        <p className="text-xs text-foreground/70">
                          Gerente{gerente.lojaNome ? ` · ${gerente.lojaNome}` : ''}
                        </p>
                      </div>
                      <Badge variant={gerente.verificada ? 'secondary' : 'outline'}>
                        {gerente.verificada ? 'Cartão do gerente reconhecido' : 'Cartão do gerente informado'}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={recolherCustodia}>
                        Cancelar
                      </Button>
                    </div>
                    <p className="text-sm">
                      Cartão do gerente identificado. Selecione o motoboy responsável e informe o PIN
                      do gerente para autorizar a saída.
                    </p>

                    <div className="flex flex-col gap-1">
                      <Label htmlFor="motoboy-excecao">Motoboy responsável</Label>
                      <select
                        id="motoboy-excecao"
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                        value={motoboyEscolhidoId}
                        onChange={(e) => {
                          // Trocar o motoboy muda o documento (ele entra no
                          // canônico), então a conferência do PIN recomeça.
                          setMotoboyEscolhidoId(e.target.value)
                          setEstadoPin({ estado: 'inactive' })
                          setPinCapturadoOffline(false)
                          setPin('')
                        }}
                      >
                        <option value="" disabled>
                          Selecione o motoboy
                        </option>
                        {motoboysElegiveis.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.nome}
                            {nomeDaAgencia(m.agenciaId) ? ` · ${nomeDaAgencia(m.agenciaId)}` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-foreground/70">
                        Os vales ficam no nome dele. O cartão do gerente só autoriza.
                      </p>
                    </div>

                    <fieldset className="flex flex-col gap-1">
                      <legend className="text-sm font-medium">Motivo</legend>
                      <div className="flex flex-wrap gap-4">
                        {MOTIVOS_EXCECAO.map((m) => (
                          <label key={m} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="motivo-excecao"
                              checked={motivo === m}
                              onChange={() => setMotivo(m)}
                            />
                            {MOTIVO_EXCECAO_LABEL[m]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                ) : null}

                {credencial && !credencial.temPin ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
                    <p className="text-sm">
                      Esta credencial ainda não foi ativada. <strong>{credencial.motoboyNome}</strong> cria o PIN
                      dele agora — ninguém mais vê o que ele escolher.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="Crie o PIN"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      />
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="Confirme"
                        value={pinConfirmacao}
                        onChange={(e) => setPinConfirmacao(e.target.value.replace(/\D/g, ''))}
                      />
                      <Button onClick={() => void handleCriarPin()} disabled={ocupado === 'pin'}>
                        Salvar PIN
                      </Button>
                    </div>
                  </div>
                ) : gerente && !gerente.temPin ? (
                  // O gerente ativa o PIN em "Meu cartão", e não aqui: é o
                  // cartão DELE, e o balcão não é lugar pra ele escolher PIN
                  // com o motoboy do lado. Criar PIN exige internet.
                  <p className="text-sm text-destructive">
                    O cartão do gerente ainda não tem PIN. O gerente ativa em "Meu cartão" antes de
                    autorizar — criar PIN exige internet.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pin">{gerente ? 'PIN do gerente' : 'PIN do motoboy'}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="pin"
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="••••••"
                        className="max-w-40 tracking-[0.5em]"
                        value={pin}
                        // Trava só quando a custódia está estabelecida.
                        // `unavailable` e `error` NÃO travam: neles o
                        // operador precisa poder tentar de novo.
                        disabled={custodiaPronta}
                        onChange={(e) => {
                          setPin(e.target.value.replace(/\D/g, ''))
                          setEstadoPin({ estado: 'inactive' })
                        }}
                        // Enter confirma: o motoboy digita e aperta, sem
                        // procurar botão com o caixa esperando.
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleConferirPin()
                        }}
                      />
                      {!custodiaPronta ? (
                        // Botão explícito, e não verificação automática ao
                        // completar 6 dígitos: cada tentativa errada conta
                        // pro bloqueio progressivo, e quem se atrapalha
                        // digitando queimaria o bloqueio do motoboy sem ter
                        // errado o PIN de verdade.
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!!pinAceitavel(pin) || estadoPin.estado === 'loading'}
                          onClick={() => void handleConferirPin()}
                        >
                          {estadoPin.estado === 'loading' ? (
                            <EmAndamento>Conferindo</EmAndamento>
                          ) : (
                            'Confirmar identidade'
                          )}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPin('')
                            setEstadoPin({ estado: 'inactive' })
                            setPinCapturadoOffline(false)
                          }}
                        >
                          Trocar PIN
                        </Button>
                      )}
                    </div>

                    {pinConfirmado && (
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                        {gerente
                          ? `✓ PIN do gerente confirmado — ${gerente.nome}`
                          : `✓ Identidade confirmada — ${credencial?.motoboyNome ?? ''}`}
                      </p>
                    )}

                    {/* RECUSA: o servidor conferiu e disse não. Repetir faz
                        sentido, e cada tentativa conta no bloqueio. */}
                    {estadoPin.estado === 'ready' && estadoPin.dados.veredito === 'recusado' && (
                      <p className="text-sm text-destructive">{estadoPin.dados.mensagem}</p>
                    )}

                    {/* ERRO: a tentativa falhou. NÃO é PIN errado, e a tela
                        não pode deixar o operador achar que errou — era o
                        que acontecia quando este caso e a recusa acima
                        terminavam os dois em `null` + string vermelha. */}
                    {estadoPin.estado === 'error' && (
                      <div className="flex flex-col gap-1">
                        <AvisoDaConsulta
                          apresentacao={apresentar(estadoPin, 'verificacao')}
                          aoRecarregar={() => void handleConferirPin()}
                        />
                        <p className="text-xs text-foreground/70">
                          O PIN <strong>não</strong> foi recusado — não deu pra conferir. Tentar de
                          novo não conta como erro pro motoboy.
                        </p>
                      </div>
                    )}

                    {/* Sem rede não há como conferir: o HMAC e o bcrypt
                        vivem no servidor. O PIN vai selado no envelope e é
                        validado na sincronização — se estiver errado, a
                        saída não sela e vira ocorrência pra gestão. A tela
                        precisa dizer isso antes, não depois.

                        Isto NÃO é `unavailable`: o fluxo previsto segue,
                        e chamá-lo de indisponível diria que não segue. */}
                    {pinCapturadoOffline && (
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        PIN guardado, mas <strong>não conferido</strong> — sem internet não dá pra
                        validar agora. Se estiver errado, a saída não vai ser selada e a gestão
                        precisa resolver.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </Secao>

          {/* SEM ASSINATURA MANUSCRITA desde o 4B. O ato da farmácia é o
              toque em "Confirmar saída", na sessão de quem está no balcão
              — e a tela diz isso, pra estar logado não parecer
              manifestação. O resumo mostra o que vai ficar no documento,
              ANTES de confirmar. */}
          <Secao numero={3} titulo="Conferência" desabilitada={!podeConfirmar}>
            <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
              <p>
                Motoboy responsável: <strong>{nomeDoMotoboy ?? '—'}</strong>
                {agenciaDoMotoboy ? ` · ${agenciaDoMotoboy}` : ''}
              </p>
              {gerente && (
                <p className="text-amber-800 dark:text-amber-300">
                  {motivo ? `${MOTIVO_EXCECAO_LABEL[motivo]}. ` : ''}
                  Autorizado por <strong>{gerente.nome}</strong>, gerente, com cartão e PIN próprios.
                </p>
              )}
              <p className="text-foreground/70">
                Ao tocar em “Confirmar saída”, <strong>{profile.nome}</strong> confirma pela farmácia
                os vales acima.
              </p>
            </div>
          </Secao>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm">
              <p>
                <strong>{escolhidos.length}</strong> entrega(s) · <strong>{totalVales}</strong>{' '}
                vale(s) · <strong>{formatBRL(totalEntrega)}</strong> em teles
              </p>
              {!online && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Sem internet — a saída fica registrada aqui e vai ser validada quando a rede
                  voltar.
                </p>
              )}
            </div>
            <Button onClick={() => void handleConfirmar()} disabled={!podeConfirmar || !!ocupado}>
              {ocupado === 'confirmar'
                ? <EmAndamento>Registrando</EmAndamento>
                : online
                  ? 'Confirmar saída'
                  : 'Registrar saída offline'}
            </Button>
          </div>

          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function Secao({
  numero,
  titulo,
  desabilitada = false,
  children,
}: {
  numero: number
  titulo: string
  desabilitada?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={desabilitada ? 'pointer-events-none opacity-40' : undefined}>
      <h3 className="mb-2 text-xs font-semibold tracking-wider text-foreground/70 uppercase">
        {numero}. {titulo}
      </h3>
      {children}
    </section>
  )
}

// "Registrado" e "validado" não podem se parecer. A saída offline é uma
// afirmação do balcão; o selo é uma afirmação do servidor.
function ResultadoDaSaida({
  resultado,
  onFechar,
}: {
  resultado: Resultado
  onFechar: () => void
}) {
  const estilos: Record<Resultado['kind'], string> = {
    selado: 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40',
    offline: 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/40',
    conflito: 'border-destructive/40 bg-destructive/5',
    erro: 'border-destructive/40 bg-destructive/5',
  }

  return (
    <div className={`mb-3 rounded-lg border p-3 text-sm ${estilos[resultado.kind]}`}>
      {resultado.kind === 'selado' && (
        <p>
          <strong>Romaneio {resultado.numero} selado.</strong> Os vales estão em rota.
          {resultado.finalHash && (
            <span className="block font-mono text-xs text-foreground/70">
              hash {resultado.finalHash.slice(0, 16)}…
            </span>
          )}
        </p>
      )}
      {resultado.kind === 'offline' && (
        <p>
          <strong>Saída registrada offline.</strong> Ainda <em>não</em> foi validada pelo servidor —
          isso acontece sozinho quando a internet voltar, com esta mesma conta.
        </p>
      )}
      {resultado.kind === 'conflito' && (
        <p>
          <strong>Conflito ao selar{resultado.numero ? ` (${resultado.numero})` : ''}.</strong> Algum
          vale já saiu em outra corrida. A tentativa ficou registrada com a validação apresentada — a
          gestão precisa resolver.
        </p>
      )}
      {resultado.kind === 'erro' && <p className="text-destructive">{resultado.texto}</p>}
      <Button variant="ghost" size="sm" className="mt-1" onClick={onFechar}>
        Fechar
      </Button>
    </div>
  )
}
