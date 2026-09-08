import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type SignaturePad from 'signature_pad'
import type { AuthProfile } from '@/data/auth'
import { useCorridasAbertas, type CorridaAberta } from '@/data/corridas'
import {
  useContextoRetorno,
  aquecerContextosDeRetorno,
  type ContextoRetorno,
  type ValeDoContexto,
} from '@/data/contextoRetorno'
import {
  selarRomaneioRetorno,
  autorizarSaida,
  ErroDoServidor,
  type RetornoOfflineInput,
} from '@/data/romaneios'
import {
  identificarCredencial,
  identificarNoCache,
  sincronizarCacheDeCredenciais,
  pinAceitavel,
  publicIdDoToken,
} from '@/data/credenciais'
import { enfileirarOperacao, donoDaFila, useFilaOperacoesPendentes } from '@/data/filaOffline'
import { congelarRetorno, RetornoNaoCongelavel, type RetornoCongelado } from '@/lib/congelarRetorno'
import {
  custodiaInicial,
  reduzirCustodia,
  ctaTravado,
  podeGuardarSegredos,
  type EstadoCustodia,
  type EventoCustodia,
} from '@/lib/custodiaDoRetorno'
import {
  FORMAS_PAGAMENTO,
  MOTIVOS_INSUCESSO,
  type EntradaRetorno,
  type FormaPagamento,
  type MotivoInsucesso,
  type SituacaoDocumento,
  type TipoDocumentoFisico,
} from '@/lib/canonicoRetorno'
import { filtrarCorridasRetornaveis } from '@/lib/corridasBloqueadas'
import { selarSegredos, calcularOfflineEventHash, envelopeDisponivel } from '@/lib/envelope'
import { useOnline } from '@/lib/useOnline'
import { rotuloDoPapelNoMomento } from '@/lib/papeis'
import { FORMA_PAGAMENTO_LABEL } from '@/data/pagamentos'
import { INSUCESSO_MOTIVO_LABEL } from '@/data/corridas'
import { mensagemDeErro } from '@/lib/supabase'
import { uuidv7 } from '@/lib/uuid'
import { centsFromDigits, formatBRL } from '@/lib/money'
import { CampoMoeda } from '@/components/CampoMoeda'
import { CampoAssinatura } from '@/components/CampoAssinatura'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Carregando, EmAndamento } from '@/components/EmAndamento'
import { Consulta, AvisoDaConsulta } from '@/components/Consulta'
import { apresentar, derivarEstado, type Procedencia } from '@/lib/estadoDeConsulta'
import { normalizarParagrafo } from '@/lib/texto'

// =====================================================================
// RETORNO DE CORRIDA — a tela do Romaneio de Retorno (2D)
//
// Ela COLETA FATOS E MANIFESTAÇÕES; nunca decide o que é verdade oficial.
// Congela o mesmo `p_retorno` que vai ser assinado e entrega esse
// artefato a uma das duas portas já provadas na 2B/2C.
//
//     useContextoRetorno   fatos ANTIGOS, do documento assinado da saída
//           ↓
//     preenchimento        desfecho, pagamento realizado, documentos
//           ↓
//     congelarRetorno      ids novos, guard de colisão, documentHash
//           ↓
//     reduzirCustodia      cartão, PIN, as duas assinaturas
//           ↓
//     online → selar_romaneio_retorno | offline → fila romaneio_retorno
//
// As invariantes NÃO são reimplementadas aqui: a máquina de custódia já
// as garante, e o que este arquivo precisa é não contorná-las. As três
// que mais custam se forem contornadas:
//
//   1. o PIN em claro só existe enquanto `podeGuardarSegredos()`;
//   2. editar qualquer fato joga fora documento E custódia inteiros;
//   3. `pagamentoId` do realizado NUNCA é copiado do previsto.
// =====================================================================

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring md:text-sm dark:bg-input/30'

/** Espelha o limite do fluxo de divergência, que o caixa já conhece. */
const MAX_PAGAMENTOS = 4

const DOCUMENTO_LABEL: Record<TipoDocumentoFisico, string> = {
  convenio: 'Documento do convênio',
  crediario: 'Nota do crediário',
}

export function RetornoCorrida({
  profile,
  onVoltar,
}: {
  profile: AuthProfile
  onVoltar: () => void
}) {
  const consultaCorridas = useCorridasAbertas()
  const estadoCorridas = derivarEstado(consultaCorridas)
  const fila = useFilaOperacoesPendentes()
  // O `useOnline()` saiu daqui: ele existia só pra escolher entre duas
  // frases de "não carregou", e essa escolha agora é do derivador. O
  // componente de baixo tem o dele, que serve pra outra coisa — decidir
  // o rótulo do CTA de concluir.
  const [corridaId, setCorridaId] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Uma corrida com `romaneio_retorno` pendente na fila local não é
  // OFERECIDA. Não é proteção de integridade — quem impede o dano é o
  // `UNIQUE (corrida_id, tipo)` — é custo: sem isto o caixa colheria
  // duas assinaturas pra descobrir depois que só uma delas pode selar.
  //
  // `undefined` quando a consulta não respondeu, e é isso que separa
  // "não há corrida aberta" de "não sei quais estão abertas".
  const corridas =
    estadoCorridas.estado === 'ready'
      ? filtrarCorridasRetornaveis(estadoCorridas.dados, fila)
      : undefined

  // Baixa o contexto das corridas abertas ENQUANTO HÁ REDE. O retorno
  // acontece no fim da tarde, no balcão, e a 2C permite registrá-lo sem
  // internet — mas o documento da saída não pode ser inventado na hora.
  // Mesmo espírito do cache de credenciais.
  const idsAbertos = (corridas ?? []).map((c) => c.id).join(',')
  useEffect(() => {
    if (!navigator.onLine || !idsAbertos) return
    void aquecerContextosDeRetorno(idsAbertos.split(',')).catch(() => {})
  }, [idsAbertos])

  const corridaSelecionada = corridas?.find((c) => c.id === corridaId) ?? null

  if (corridaSelecionada) {
    return (
      <RetornoDaCorrida
        corrida={corridaSelecionada}
        profile={profile}
        onVoltar={() => setCorridaId(null)}
        onConcluido={(texto) => {
          setCorridaId(null)
          setAviso(texto)
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" className="mb-3" onClick={onVoltar}>
        ← Voltar para a lista
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Retorno de corrida</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {aviso && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
                <p>{aviso}</p>
                <Button variant="ghost" size="sm" className="mt-1" onClick={() => setAviso(null)}>
                  Fechar
                </Button>
              </div>
            )}
            {/* Mesma história da Nova Corrida (§50.2): "nenhuma corrida
                em aberto" é afirmação sobre o MUNDO, e sem lista
                carregada ela é mentira. O raciocínio estava certo aqui e
                escrito à mão; agora sai do derivador, num lugar só.

                O `estaVazio` é próprio porque a lista exibida é filtrada
                pela fila local: uma corrida com retorno pendente some
                sem a consulta ter mudado. */}
            <Consulta
              estado={estadoCorridas}
              estaVazio={(todas) => filtrarCorridasRetornaveis(todas, fila).length === 0}
              vazio={
                <p className="text-sm text-muted-foreground">Nenhuma corrida em aberto agora.</p>
              }
              aoRecarregar={() => void consultaCorridas.refetch()}
            >
              {(todas: CorridaAberta[]) =>
                filtrarCorridasRetornaveis(todas, fila).map((corrida) => (
              <button
                key={corrida.id}
                type="button"
                onClick={() => setCorridaId(corrida.id)}
                className="flex flex-col gap-1 rounded-lg border p-3 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-medium">
                  {corrida.mototaxistaNome}
                  {corrida.agenciaNome ? ` · ${corrida.agenciaNome}` : ''}
                </span>
                <span className="text-muted-foreground">
                  Saiu às{' '}
                  {corrida.saidaEm
                    ? new Date(corrida.saidaEm).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}{' '}
                  · {corrida.entregas.length} vale(s)
                </span>
                {/* OS VALES, e eles já vinham na consulta — só não eram
                    desenhados. Sem isto, duas corridas do mesmo motoboy
                    só se distinguem pelo horário, e quem está no balcão
                    com o papel na mão procura pelo NÚMERO DO VALE. */}
                <span className="flex flex-col gap-0.5 text-xs text-foreground/70">
                  {corrida.entregas.map((entrega) => (
                    <span key={entrega.id}>
                      <span className="font-medium">{entrega.numeroVale}</span>
                      {entrega.clienteNome ? ` · ${entrega.clienteNome}` : ''}
                    </span>
                  ))}
                </span>
              </button>
                ))
              }
            </Consulta>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------
// O portão do contexto
//
// Sem o documento assinado da saída não há retorno a montar, e a tela diz
// o que falta em vez de deixar o caixa concluir que o sistema perdeu
// alguma coisa. Nada de remendar com o que houver em tabela local: seria
// inventar o que o motoboy recebeu.
// ---------------------------------------------------------------------
function RetornoDaCorrida({
  corrida,
  profile,
  onVoltar,
  onConcluido,
}: {
  corrida: CorridaAberta
  profile: AuthProfile
  onVoltar: () => void
  onConcluido: (texto: string) => void
}) {
  const consultaContexto = useContextoRetorno(corrida.id)

  // ACHATAMENTO, e ele é honesto: esta consulta resolve a própria
  // disponibilidade, porque tem um cache local que o TanStack não
  // conhece — ela nunca lança, então o estado externo é sempre `ready`
  // depois da primeira resposta. O que o externo ainda diz é o intervalo
  // ANTES dela (loading) e o caso de a query nem correr (inactive).
  const externo = derivarEstado(consultaContexto)
  const estado = externo.estado === 'ready' ? externo.dados : externo

  const moldura = (conteudo: React.ReactNode) => (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" className="mb-3" onClick={onVoltar}>
        ← Voltar
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Retorno — {corrida.mototaxistaNome}</CardTitle>
        </CardHeader>
        <CardContent>{conteudo}</CardContent>
      </Card>
    </div>
  )

  if (estado.estado !== 'ready') {
    return moldura(
      estado.estado === 'loading' || estado.estado === 'inactive' ? (
        <Carregando />
      ) : (
        <div className="flex flex-col gap-1">
          <AvisoDaConsulta
            apresentacao={apresentar(estado)}
            aoRecarregar={() => void consultaContexto.refetch()}
          />
          {estado.estado === 'unavailable' && (
            <p className="text-xs text-foreground/70">
              O retorno é montado a partir do que o motoboy assinou ao sair, e isso não pode ser
              reconstruído aqui. Abra esta tela com internet uma vez — depois disso ela funciona
              offline.
            </p>
          )}
        </div>
      )
    )
  }

  // RECUSA: o servidor respondeu que esta corrida não tem saída selada.
  // Antes isto era um estado irmão de `erro` e de `indisponivel_offline`;
  // agora só é alcançável de dentro de uma resposta, que é o que ele é.
  if (estado.dados.veredito === 'recusado') {
    return moldura(<p className="text-sm text-muted-foreground">{estado.dados.mensagem}</p>)
  }

  return (
    <FluxoDeRetorno
      contexto={estado.dados.valor}
      procedencia={estado.procedencia}
      corrida={corrida}
      profile={profile}
      onVoltar={onVoltar}
      onConcluido={onConcluido}
    />
  )
}

// ---------------------------------------------------------------------
// O preenchimento — fatos NOVOS, ainda editáveis
//
// Sem `pagamentoId` nenhum: os ids nascem no congelamento, e é isso que
// torna a armadilha do §77 impossível de representar em vez de
// improvável. Copiar o previsto INTEIRO levaria junto o id do previsto —
// que é o uuid da entrega —, e o selo bateria em `on conflict do
// nothing`, gravando nada e afirmando tudo.
// ---------------------------------------------------------------------
type LinhaDePagamento = { forma: FormaPagamento; digitos: string; trocoDigitos: string }

type Preenchimento = {
  desfecho: 'entregue' | 'insucesso'
  motivo: MotivoInsucesso | null
  detalhe: string
  pagamentos: LinhaDePagamento[]
  /** Sem valor inicial DE PROPÓSITO — ver `documentoPendente`. */
  documentos: Partial<Record<TipoDocumentoFisico, SituacaoDocumento>>
}

function preenchimentoInicial(vale: ValeDoContexto): Preenchimento {
  return {
    desfecho: 'entregue',
    motivo: null,
    detalhe: '',
    // Pré-preenche forma, valor e troco. NUNCA o `pagamentoId`.
    pagamentos: vale.pagamentosPrevistos.map((p) => ({
      forma: p.forma as FormaPagamento,
      digitos: String(p.valorCents),
      trocoDigitos: p.trocoCents ? String(p.trocoCents) : '',
    })),
    documentos: {},
  }
}

type Resultado =
  | { kind: 'selado'; numero: string; finalHash: string | null }
  | { kind: 'offline' }
  | { kind: 'conflito'; numero: string | null }
  | { kind: 'erro'; texto: string }

function FluxoDeRetorno({
  contexto,
  procedencia,
  corrida,
  profile,
  onVoltar,
  onConcluido,
}: {
  contexto: ContextoRetorno
  procedencia: Procedencia
  corrida: CorridaAberta
  profile: AuthProfile
  onVoltar: () => void
  onConcluido: (texto: string) => void
}) {
  const queryClient = useQueryClient()
  const online = useOnline()

  const [preenchimento, setPreenchimento] = useState<Record<string, Preenchimento>>(() =>
    Object.fromEntries(contexto.vales.map((v) => [v.entregaId, preenchimentoInicial(v)]))
  )
  const [congelado, setCongelado] = useState<RetornoCongelado | null>(null)
  const [custodia, setCustodia] = useState<EstadoCustodia | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const [token, setToken] = useState('')
  const [expiraEm, setExpiraEm] = useState<string | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  // O PIN NÃO é estado do React. O input é não-controlado, e o que o
  // componente guarda é um BOOLEANO — o suficiente pra habilitar o
  // botão. Texto claro em `useState` acaba em devtools, em snapshot e em
  // qualquer log que serialize o componente.
  const pinRef = useRef<HTMLInputElement>(null)
  const [pinCompleto, setPinCompleto] = useState(false)

  // O material sensível vive AQUI e só aqui: nunca Dexie, nunca
  // localStorage, nunca payload de fila, nunca evento de auditoria.
  const segredosRef = useRef<{ pin: string; credentialToken: string } | null>(null)

  const responsavelPad = useRef<SignaturePad | null>(null)
  const motoboyPad = useRef<SignaturePad | null>(null)

  // A PERMISSÃO PRA O MATERIAL EXISTIR É DERIVADA DA MÁQUINA.
  //
  // Não é disciplina espalhada por cada handler: qualquer caminho de
  // invalidação passa por `recolher()`, que zera o sinal — e aqui a ref
  // se apaga em consequência. Online o sinal nunca é ligado, então o PIN
  // some assim que a autorização é emitida.
  const guardavel = custodia !== null && podeGuardarSegredos(custodia)
  useEffect(() => {
    if (!guardavel) segredosRef.current = null
  }, [guardavel])
  // E desmontar a tela apaga também: sair do fluxo não pode deixar PIN
  // pendurado em memória viva.
  useEffect(() => () => {
    segredosRef.current = null
  }, [])

  // OS CANVAS SEGUEM A MÁQUINA, PELO MESMO MOTIVO QUE A REF DO PIN.
  //
  // Quando a custódia é recolhida — trocar motoboy, autorização vencida,
  // falha de rede no selo —, os traços saem do estado. Se o desenho
  // continuasse na tela, ela estaria mostrando uma assinatura que o
  // documento não tem mais: a tela afirmando o que não sabe, de novo.
  //
  // Derivado, e não lembrado em cada handler: assim um caminho de
  // invalidação novo já nasce coberto.
  const temTracoResponsavel = custodia?.responsavelStrokes != null
  const temTracoMotoboy = custodia?.motoboyStrokes != null
  useEffect(() => {
    const pad = responsavelPad.current
    if (!pad) return
    // E o canvas TRAVA depois de registrado. Sem isto o caixa poderia
    // continuar rabiscando por cima de uma assinatura já colhida, e o
    // que está no documento deixaria de ser o que está na tela.
    if (temTracoResponsavel) pad.off()
    else {
      pad.clear()
      pad.on()
    }
  }, [temTracoResponsavel])
  useEffect(() => {
    const pad = motoboyPad.current
    if (!pad) return
    if (temTracoMotoboy) pad.off()
    else {
      pad.clear()
      pad.on()
    }
  }, [temTracoMotoboy])

  function despachar(evento: EventoCustodia) {
    setCustodia((atual) => (atual ? reduzirCustodia(atual, evento) : atual))
  }

  // O relógio da autorização. Ela vale ~2 minutos e nasce no passo do
  // PIN, então ela corre DURANTE as duas assinaturas — a tela mostra
  // quanto falta em vez de deixar o servidor recusar no fim.
  useEffect(() => {
    if (!expiraEm) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [expiraEm])

  const segundosRestantes = expiraEm
    ? Math.max(0, Math.round((new Date(expiraEm).getTime() - agora) / 1000))
    : null

  useEffect(() => {
    if (expiraEm && segundosRestantes === 0) {
      setExpiraEm(null)
      despachar({ tipo: 'AUTORIZACAO_EXPIROU' })
    }
    // `despachar` é estável o bastante (só usa setState) e entrar aqui
    // recriaria o efeito a cada render — a armadilha do §62.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiraEm, segundosRestantes])

  // O cache de credenciais é o que faz bipar funcionar sem rede.
  useEffect(() => {
    if (navigator.onLine) {
      void sincronizarCacheDeCredenciais().catch(() => {})
    }
  }, [])

  const idsPrevistos = useMemo(
    () => contexto.vales.flatMap((v) => v.pagamentosPrevistos.map((p) => p.pagamentoId)),
    [contexto]
  )

  function alterar(entregaId: string, mudanca: Partial<Preenchimento>) {
    setPreenchimento((antes) => ({
      ...antes,
      [entregaId]: { ...antes[entregaId], ...mudanca },
    }))
  }

  // ---- congelar ----------------------------------------------------
  function montarEntrada(): EntradaRetorno {
    return {
      saidaRomaneioId: contexto.saidaRomaneioId,
      saidaDocumentHash: contexto.saidaDocumentHash,
      motoboyId: contexto.motoboyId,
      // NUNCA um dropdown: a identidade de quem recebe sai da sessão, e
      // quem a persiste é o servidor, a partir do `auth.uid()`.
      responsavelId: profile.id,
      vales: contexto.vales.map((vale) => {
        const p = preenchimento[vale.entregaId]
        const entregue = p.desfecho === 'entregue'
        return {
          entregaId: vale.entregaId,
          desfecho: p.desfecho,
          motivo: entregue ? null : p.motivo,
          detalhe: entregue ? null : p.motivo === 'outro' ? normalizarParagrafo(p.detalhe) : null,
          // Pagamento em vale com insucesso é recusado pelo contrato: não
          // houve entrega, não houve pagamento na porta.
          pagamentosRealizados: entregue
            ? p.pagamentos.map((linha) => ({
                // uuidv7 NOVO, aqui, a cada congelamento. É o que separa
                // o realizado do previsto — cujo id é o uuid da entrega.
                pagamentoId: uuidv7(),
                forma: linha.forma,
                valorCents: centsFromDigits(linha.digitos),
                trocoCents: linha.trocoDigitos ? centsFromDigits(linha.trocoDigitos) : 0,
              }))
            : [],
          // A expectativa sai do canônico ASSINADO da saída. A tela não
          // cria linha que aquela saída não gerou — `selar_romaneio_retorno`
          // exige igualdade de conjunto, e sobra é recusa.
          documentos: vale.documentosEsperados.map((tipo) => ({
            tipo,
            situacao: p.documentos[tipo] as SituacaoDocumento,
          })),
        }
      }),
    }
  }

  function problemaDoPreenchimento(): string | null {
    for (const vale of contexto.vales) {
      const p = preenchimento[vale.entregaId]
      if (p.desfecho === 'insucesso' && !p.motivo) {
        return `Vale ${vale.numeroVale}: escolhe o motivo do insucesso.`
      }
      if (p.desfecho === 'insucesso' && p.motivo === 'outro' && !normalizarParagrafo(p.detalhe)) {
        return `Vale ${vale.numeroVale}: escreve o que aconteceu.`
      }
      if (p.desfecho === 'entregue') {
        for (const linha of p.pagamentos) {
          if (!linha.digitos || centsFromDigits(linha.digitos) <= 0) {
            return `Vale ${vale.numeroVale}: falta o valor de um pagamento.`
          }
        }
      }
      // Ausência NÃO vira `faltante`: normalizar inventaria um fato que
      // ninguém declarou, e o servidor recusa de qualquer jeito.
      for (const tipo of vale.documentosEsperados) {
        if (!p.documentos[tipo]) {
          return `Vale ${vale.numeroVale}: diz se ${DOCUMENTO_LABEL[tipo].toLowerCase()} voltou.`
        }
      }
    }
    return null
  }

  async function handleCongelar() {
    const problema = problemaDoPreenchimento()
    if (problema) return setErro(problema)
    setErro(null)
    setOcupado('congelando')
    try {
      const pacote = await congelarRetorno(montarEntrada(), idsPrevistos, uuidv7)
      setCongelado(pacote)
      setCustodia(
        custodiaInicial({ romaneioId: pacote.romaneioId, documentHash: pacote.documentHash })
      )
      despachar({ tipo: 'INICIAR' })
    } catch (e) {
      if (e instanceof RetornoNaoCongelavel) {
        // Não deveria acontecer — a tela nunca copia o `pagamentoId` do
        // previsto. Se aparecer, é defeito daqui, e o texto tem que dizer
        // isso em vez de culpar o caixa.
        setErro(
          `${e.message} Isso é um defeito do sistema, não do preenchimento — avise o desenvolvedor.`
        )
        return
      }
      setErro(mensagemDeErro(e))
    } finally {
      setOcupado(null)
    }
  }

  /** Editar destrói documento E custódia. Um documento novo, do zero. */
  function voltarAEditar() {
    despachar({ tipo: 'CANCELAR' })
    setCongelado(null)
    setCustodia(null)
    setToken('')
    setExpiraEm(null)
    setPinCompleto(false)
    if (pinRef.current) pinRef.current.value = ''
    segredosRef.current = null
    responsavelPad.current?.clear()
    motoboyPad.current?.clear()
    setResultado(null)
  }

  // ---- custódia ----------------------------------------------------
  async function handleBipar(valor: string) {
    setErro(null)
    const limpo = valor.trim()
    if (!publicIdDoToken(limpo)) {
      despachar({
        tipo: 'CARTAO_RECUSADO',
        mensagem: 'Isso não parece um cartão do sistema. Bipa de novo.',
      })
      return
    }
    setOcupado('bipando')
    try {
      const achada = navigator.onLine
        ? await identificarCredencial(limpo)
        : await identificarNoCache(limpo)

      if (!achada) {
        // ONLINE isto é RECUSA: o servidor respondeu que o token não
        // existe. OFFLINE é outra coisa — o cache local é a única fonte,
        // e ele não conhecer o cartão não prova que ele seja inválido.
        // O texto diz qual dos dois, e o estado também.
        despachar(
          navigator.onLine
            ? { tipo: 'CARTAO_RECUSADO', mensagem: 'Credencial não reconhecida.' }
            : {
                tipo: 'FALHA_NA_CONSULTA',
                mensagem:
                  'Cartão desconhecido neste computador. Sem internet, só dá pra reconhecer cartões que já apareceram aqui antes — isso não quer dizer que o cartão seja inválido.',
              }
        )
        return
      }

      // O DOCUMENTO JÁ NOMEIA O MOTOBOY — ele saiu do romaneio de saída.
      // Um cartão de outra pessoa não é "trocar de motoboy": é o cartão
      // errado, e a transação recusaria `outro_motoboy` depois de duas
      // assinaturas.
      if (achada.motoboyId !== contexto.motoboyId) {
        despachar({
          tipo: 'CARTAO_RECUSADO',
          mensagem: `Este cartão é de ${achada.motoboyNome}, e esta corrida saiu com ${contexto.motoboyNome ?? 'outro motoboy'}. Quem devolve a corrida é quem a levou.`,
        })
        return
      }

      setToken(limpo)
      despachar({
        tipo: 'CARTAO_LIDO',
        publicId: achada.publicId,
        motoboyId: achada.motoboyId,
      })
    } catch (e) {
      // ANTES ESTE `catch` NÃO DESPACHAVA NADA. A máquina ficava em
      // `aguardando_cartao` — como se nada tivesse sido tentado — com
      // um texto vermelho de erro no ar, vindo do canal paralelo. As
      // duas fontes descreviam momentos diferentes, e nenhuma das duas
      // era a autoridade.
      // O TÉCNICO VAI PRO CONSOLE, O BALCÃO RECEBE UMA FRASE.
      // `mensagemDeErro` junta message + details, e num erro de rede do
      // supabase o `details` é a STACK — o caixa via um stack trace na
      // tela. Perder o detalhe seria o §80 de novo, então ele continua
      // existindo, só que onde se depura.
      console.error('identificar credencial falhou:', e)
      despachar({
        tipo: 'FALHA_NA_CONSULTA',
        mensagem: 'Não consegui consultar a credencial agora.',
      })
    } finally {
      setOcupado(null)
    }
  }

  async function handleConferirPin() {
    const pin = pinRef.current?.value ?? ''
    const problema = pinAceitavel(pin)
    if (problema) return setErro(problema)
    if (!congelado) return
    setErro(null)

    // OFFLINE: o PIN é CAPTURADO, não conferido. Ninguém valida aqui —
    // o HMAC e o bcrypt vivem no servidor. Ele fica em memória efêmera
    // até o envelope existir, o que só acontece depois das duas
    // assinaturas (é o `offlineEventHash` que amarra os traços).
    if (!navigator.onLine) {
      if (!envelopeDisponivel()) {
        return setErro(
          'Chave de segurança não configurada neste ambiente (VITE_ROMANEIO_KEY_ID). Sem ela não dá pra proteger o PIN até a rede voltar. Fale com o administrador.'
        )
      }
      segredosRef.current = { pin, credentialToken: token }
      despachar({ tipo: 'SEGREDOS_CAPTURADOS' })
      if (pinRef.current) pinRef.current.value = ''
      setPinCompleto(false)
      return
    }

    // ONLINE: autentica AGORA e recebe a autorização de uso único, já
    // amarrada a este `documentHash`. Feito isso o PIN não precisa mais
    // existir — e por isso ele sai da memória neste mesmo passo.
    setOcupado('conferindo')
    try {
      const autorizacao = await autorizarSaida(token, pin, congelado.documentHash)
      if (!autorizacao.ok) {
        // RECUSA: o servidor conferiu e disse não.
        despachar({
          tipo: 'PIN_RECUSADO',
          mensagem:
            autorizacao.motivo === 'pin_incorreto'
              ? 'PIN incorreto.'
              : autorizacao.motivo === 'bloqueado'
                ? 'Credencial bloqueada por tentativas seguidas de PIN incorreto.'
                : 'Não consegui autenticar o motoboy.',
        })
        return
      }
      setExpiraEm(autorizacao.expiraEm)
      despachar({ tipo: 'PIN_AUTORIZADO', autorizacaoId: autorizacao.autorizacaoId })
    } catch (e) {
      // FALHA, não recusa. `PIN_RECUSADO` apagaria os segredos e diria
      // ao caixa que o motoboy errou o PIN; a falha na consulta diz que
      // a tentativa não completou, que é o que de fato aconteceu — e
      // deixa a máquina onde está, com o próximo passo intacto.
      console.error('autorizar saída falhou:', e)
      despachar({
        tipo: 'FALHA_NA_CONSULTA',
        mensagem: 'Não consegui conferir o PIN agora.',
      })
    } finally {
      if (pinRef.current) pinRef.current.value = ''
      setPinCompleto(false)
      setOcupado(null)
    }
  }

  function handleAssinarResponsavel() {
    if (!responsavelPad.current || responsavelPad.current.isEmpty()) {
      return setErro('Falta a sua assinatura.')
    }
    setErro(null)
    despachar({ tipo: 'ASSINOU_RESPONSAVEL', strokes: responsavelPad.current.toData() })
  }

  function handleAssinarMotoboy() {
    if (!motoboyPad.current || motoboyPad.current.isEmpty()) {
      return setErro('Falta a assinatura do motoboy.')
    }
    setErro(null)
    despachar({ tipo: 'ASSINOU_MOTOBOY', strokes: motoboyPad.current.toData() })
  }

  // ---- concluir ----------------------------------------------------
  async function handleConcluir() {
    if (!congelado || !custodia) return
    const responsavelStrokes = custodia.responsavelStrokes?.valor
    const motoboyStrokes = custodia.motoboyStrokes?.valor
    if (!responsavelStrokes || !motoboyStrokes) return setErro('Faltam as duas assinaturas.')
    setErro(null)

    const temRede = navigator.onLine
    const ocorridoEmLocal = new Date().toISOString()

    // OFFLINE: sela o envelope AGORA — é aqui, e só aqui, que ele é
    // construível, porque o `offlineEventHash` amarra os dois traços.
    if (!temRede) {
      const segredos = segredosRef.current
      if (!segredos) {
        return setErro(
          'O PIN não está mais em memória. Autentique o motoboy de novo antes de concluir.'
        )
      }
      setOcupado('concluindo')
      try {
        const offlineEventHash = await calcularOfflineEventHash({
          documentHash: congelado.documentHash,
          romaneioId: congelado.romaneioId,
          assinaturaInternaStrokes: responsavelStrokes,
          assinaturaMotoboyStrokes: motoboyStrokes,
          ocorridoEmLocal,
          geolocalizacao: null,
        })
        const envelope = await selarSegredos({
          pin: segredos.pin,
          credentialToken: segredos.credentialToken,
          operationId: congelado.romaneioId,
          documentHash: congelado.documentHash,
          offlineEventHash,
          // Explícito, e o retorno o EXIGE: ausência significa saída, e
          // isso é compatibilidade histórica com fila antiga — que não
          // existe pra este tipo.
          tipo: 'retorno',
        })
        despachar({ tipo: 'CONCLUIR', online: false, envelope })

        const paraFila: RetornoOfflineInput = {
          romaneioId: congelado.romaneioId,
          corridaId: corrida.id,
          saidaRomaneioId: contexto.saidaRomaneioId,
          saidaDocumentHash: contexto.saidaDocumentHash,
          motoboyId: contexto.motoboyId,
          versaoDocumento: 'DCRR1',
          // JÁ CONVERTIDO. A fila não reconverte nada: o que sobe é o
          // que foi assinado.
          retornoJsonb: congelado.retornoJsonb,
          documentHash: congelado.documentHash,
          responsavelStrokes,
          motoboyStrokes,
          ocorridoEmLocal,
          envelope,
          userId: profile.id,
        }
        // `dependeDeChave` e NENHUMA `chave`: ele espera a saída e o
        // fechamento legado saírem da fila, e nada depende dele — chave
        // igual a dependeDeChave seria deadlock silencioso (2C.3).
        await enfileirarOperacao('romaneio_retorno', donoDaFila(profile), paraFila, {
          dependeDeChave: corrida.id,
        })
        despachar({ tipo: 'ENFILEIRADO' })
        setResultado({ kind: 'offline' })
      } catch (e) {
        // Também não despachava nada: a máquina ficava em
        // `enfileirando` pra sempre enquanto uma string vermelha
        // aparecia. O caixa via "registrando…" travado sem saber que
        // tinha falhado.
        despachar({ tipo: 'ERRO_REDE', mensagem: mensagemDeErro(e) })
      } finally {
        setOcupado(null)
      }
      return
    }

    // ONLINE: não há envelope neste ramo, de propósito — o PIN saiu da
    // memória na autenticação. Ver a regra 4 da máquina.
    const autorizacaoId = custodia.autorizacaoId?.valor
    if (!autorizacaoId) return setErro('A autenticação do motoboy venceu. Refaça o PIN.')

    setOcupado('concluindo')
    despachar({ tipo: 'CONCLUIR', online: true })
    try {
      const selo = await selarRomaneioRetorno({
        romaneioId: congelado.romaneioId,
        saidaRomaneioId: contexto.saidaRomaneioId,
        saidaDocumentHash: contexto.saidaDocumentHash,
        motoboyId: contexto.motoboyId,
        retornoJsonb: congelado.retornoJsonb,
        documentHash: congelado.documentHash,
        autorizacaoId,
        responsavelStrokes,
        motoboyStrokes,
        ocorridoEmLocal,
      })

      if (selo.ok) {
        despachar({ tipo: 'SELADO' })
        setResultado({ kind: 'selado', numero: selo.numero, finalHash: selo.finalHash })
      } else {
        // Conflito NÃO é erro retryable: o servidor preservou a prova de
        // propósito, com as duas assinaturas. Sugerir "tente de novo"
        // aqui seria o oposto do que se deve fazer.
        despachar({ tipo: 'CONFLITO', detalhe: selo.conflitos })
        setResultado({ kind: 'conflito', numero: selo.numero })
      }
      for (const chave of [
        'entregas-hoje',
        'transferencias',
        'entregas-historico',
        'corridas-abertas',
        'romaneios-do-dia',
        'documentos-convenio-pendentes',
        'notificacoes-hoje',
        'notificacoes-todas',
        'eventos-auditoria',
      ]) {
        queryClient.invalidateQueries({ queryKey: [chave] })
      }
    } catch (e) {
      if (e instanceof ErroDoServidor) {
        // Recusa do servidor não vira "registrado offline" — insistir
        // repetiria o mesmo resultado, e mandar pra fila faria o caixa ir
        // embora achando que deu certo.
        //
        // E NÃO despacha `ERRO_REDE`: não houve falha de rede nenhuma, e
        // usar aquele evento aqui seria o vocabulário mentiroso que esta
        // frente vem evitando. A máquina fica em `selando` e a tela de
        // resultado assume — o CTA já está travado por ela.
        //
        // PENDÊNCIA DE CONTRATO, e ela é pequena: a 2D.1 previa um
        // estado `documento_alterado` pra este caso ("reconstruir é a
        // única saída"), e ele não existe na máquina. Enquanto não
        // existir, o caminho é sair e refazer.
        setResultado({ kind: 'erro', texto: e.message })
        return
      }
      // REGRA 4. Falha de REDE depois das duas assinaturas: o documento
      // fica de pé, a custódia cai inteira, e o caixa refaz cartão, PIN
      // e as duas assinaturas sobre o MESMO documento. Nada de fabricar
      // envelope sem PIN, nada de "tentar novamente" com as evidências
      // antigas.
      setExpiraEm(null)
      setToken('')
      responsavelPad.current?.clear()
      motoboyPad.current?.clear()
      despachar({ tipo: 'FALHA_DE_REDE_NO_SELO' })
    } finally {
      setOcupado(null)
    }
  }

  // ---- desenho -----------------------------------------------------
  const fase = custodia?.nome ?? 'preenchendo'
  const travado = custodia !== null && ctaTravado(custodia)
  const cargo = rotuloDoPapelNoMomento(profile.papel)

  if (resultado) {
    return (
      <div className="mx-auto max-w-3xl">
        <ResultadoDoRetorno
          resultado={resultado}
          onFechar={() =>
            onConcluido(
              resultado.kind === 'selado'
                ? `Retorno da corrida de ${corrida.mototaxistaNome} selado (${resultado.numero}).`
                : `Retorno da corrida de ${corrida.mototaxistaNome} registrado offline.`
            )
          }
          onVoltar={onVoltar}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" className="mb-3" onClick={onVoltar} disabled={travado}>
        ← Voltar
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span>Retorno — {contexto.motoboyNome ?? corrida.mototaxistaNome}</span>
            {contexto.agenciaNome && (
              <span className="text-sm font-normal text-foreground/70">
                {contexto.agenciaNome}
              </span>
            )}
            <Badge variant="outline">Saída {contexto.saidaNumero}</Badge>
          </CardTitle>
          {/* A procedência do documento da saída, e agora ela distingue
              os DOIS casos de cache que a consulta já separava e o
              `origem: 'cache'` colapsava: estar sem rede é diferente de
              a chamada ter falhado com rede disponível. Quem depura "por
              que este vale não aparece" precisa saber qual foi. */}
          {procedencia !== 'servidor' && (
            <p className="text-xs text-foreground/70">
              Documento da saída lido do que estava guardado neste computador
              {procedencia === 'cache_apos_falha'
                ? ' — não consegui falar com o servidor agora.'
                : ' — sem internet no momento.'}
            </p>
          )}
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <Secao numero={1} titulo="Conferência">
            {congelado ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3 text-sm">
                <span>
                  <strong>Documento congelado.</strong> {contexto.vales.length} vale(s) ·{' '}
                  <span className="font-mono text-xs">
                    {congelado.documentHash.slice(0, 16)}…
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={voltarAEditar} disabled={travado}>
                  Editar a conferência
                </Button>
                {/* Editar não é voltar um passo: é outro documento. */}
                <span className="text-xs text-foreground/70">
                  Editar descarta as assinaturas e a identificação já colhidas — o documento passa a
                  ser outro.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {contexto.vales.map((vale) => (
                  <ValeEmConferencia
                    key={vale.entregaId}
                    vale={vale}
                    preenchimento={preenchimento[vale.entregaId]}
                    onAlterar={(mudanca) => alterar(vale.entregaId, mudanca)}
                  />
                ))}
                <Button type="button" onClick={() => void handleCongelar()} disabled={!!ocupado}>
                  {ocupado === 'congelando' ? (
                    <EmAndamento>Conferindo</EmAndamento>
                  ) : (
                    'Conferir e seguir para a identificação'
                  )}
                </Button>
              </div>
            )}
          </Secao>

          <Secao numero={2} titulo="Identificação do motoboy" desabilitada={!congelado}>
            {custodia && <CustodiaDoMotoboy
              custodia={custodia}
              contexto={contexto}
              token={token}
              setToken={setToken}
              pinRef={pinRef}
              pinCompleto={pinCompleto}
              setPinCompleto={setPinCompleto}
              ocupado={ocupado}
              online={online}
              segundosRestantes={segundosRestantes}
              onBipar={(v) => void handleBipar(v)}
              onConferirPin={() => void handleConferirPin()}
              onTrocarMotoboy={() => {
                setToken('')
                setExpiraEm(null)
                despachar({ tipo: 'TROCAR_MOTOBOY' })
              }}
            />}
          </Secao>

          <Secao
            numero={3}
            titulo="Assinaturas"
            desabilitada={
              fase !== 'custodia_autorizada' &&
              fase !== 'segredos_capturados' &&
              fase !== 'assinando_motoboy' &&
              fase !== 'pronto_para_concluir'
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <CampoAssinatura
                  rotulo={`Responsável pela loja · ${profile.nome}${cargo ? ` · ${cargo}` : ''}`}
                  padRef={responsavelPad}
                />
                {custodia?.responsavelStrokes ? (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    ✓ Assinatura registrada
                  </p>
                ) : (
                  <Button type="button" variant="outline" size="sm" onClick={handleAssinarResponsavel}>
                    Registrar minha assinatura
                  </Button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <CampoAssinatura
                  rotulo={`Motoboy · ${contexto.motoboyNome ?? '—'}`}
                  padRef={motoboyPad}
                />
                {custodia?.motoboyStrokes ? (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    ✓ Assinatura registrada
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!custodia?.responsavelStrokes}
                    onClick={handleAssinarMotoboy}
                  >
                    Registrar a assinatura do motoboy
                  </Button>
                )}
              </div>
            </div>
          </Secao>

          {custodia?.motivoDoRecolhimento && (
            // O recolhimento é EXPLICADO, nunca silencioso: sem o motivo,
            // as assinaturas sumindo da tela pareceriam defeito.
            <p className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {custodia.motivoDoRecolhimento}
            </p>
          )}

          {/* A FALHA SAI DA MÁQUINA, e a cor sai do NOME DO ESTADO.
              Antes o motivo vinha de um `erro: string | null` paralelo, e
              nada amarrava os dois: o `catch` escrevia a string SEM
              despachar nada, então a máquina dizia `aguardando_cartao` e
              a tela mostrava um erro. Agora há uma fonte só.

              `cartao_recusado` e `pin_recusado` acusam (vermelho de
              recusa); `erro_rede` não acusa ninguém (âmbar de aviso), e
              acrescenta que a tentativa é que falhou. */}
          {custodia?.mensagem && (
            <div className="flex flex-col gap-1">
              <p
                className={
                  custodia.mensagem.tipo === 'falha'
                    ? 'text-sm text-amber-700 dark:text-amber-400'
                    : 'text-sm text-destructive'
                }
              >
                {custodia.mensagem.texto}
              </p>
              {custodia.mensagem.tipo === 'falha' && (
                <p className="text-xs text-foreground/70">
                  A tentativa é que não completou — nada foi recusado. Tentar de novo não conta
                  como erro pro motoboy.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm">
              <p>
                <strong>{contexto.vales.length}</strong> vale(s) nesta corrida
              </p>
              {!online && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Sem internet — o retorno fica registrado aqui e vai ser validado quando a rede
                  voltar.
                </p>
              )}
            </div>
            <Button
              type="button"
              onClick={() => void handleConcluir()}
              disabled={fase !== 'pronto_para_concluir' || !!ocupado || travado}
            >
              {ocupado === 'concluindo' ? (
                <EmAndamento>Registrando</EmAndamento>
              ) : online ? (
                'Concluir retorno'
              ) : (
                'Registrar retorno offline'
              )}
            </Button>
          </div>

          {/* O QUE SOBROU AQUI É VALIDAÇÃO LOCAL, e só ela: formato do
              PIN, assinatura faltando, chave de ambiente ausente. Nada
              disso é resposta de ninguém — são conferências feitas antes
              de qualquer transição, e a máquina nem chega a ser tocada.
              Recusa, indisponibilidade e falha vivem no bloco acima. */}
          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------
// Um vale em conferência
//
// Os fatos ANTIGOS vêm do SNAPSHOT da saída, nunca de `entregas`: o dado
// vigente pode ter sido corrigido depois, e mostrar o valor de hoje faria
// o caixa conferir contra algo que o motoboy nunca recebeu.
// ---------------------------------------------------------------------
function ValeEmConferencia({
  vale,
  preenchimento,
  onAlterar,
}: {
  vale: ValeDoContexto
  preenchimento: Preenchimento
  onAlterar: (mudanca: Partial<Preenchimento>) => void
}) {
  const entregue = preenchimento.desfecho === 'entregue'
  const somaRealizada = preenchimento.pagamentos.reduce(
    (soma, l) => soma + (l.digitos ? centsFromDigits(l.digitos) : 0),
    0
  )
  const divergeDaCompra =
    entregue &&
    preenchimento.pagamentos.length > 0 &&
    vale.valorCompraCents > 0 &&
    somaRealizada !== vale.valorCompraCents

  function alterarLinha(indice: number, mudanca: Partial<LinhaDePagamento>) {
    onAlterar({
      pagamentos: preenchimento.pagamentos.map((l, i) =>
        i === indice ? { ...l, ...mudanca } : l
      ),
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{vale.numeroVale}</span>
        {vale.tipo === 'transferencia' && <Badge variant="outline">Transferência</Badge>}
        <span className="text-sm">{vale.clienteNome}</span>
      </div>
      <p className="text-xs text-foreground/70">{vale.clienteEndereco}</p>
      <p className="text-xs text-foreground/70">
        Compra {formatBRL(vale.valorCompraCents)} · tele {formatBRL(vale.valorEntregaCents)}
        {vale.pagamentosPrevistos.length > 0 && (
          <>
            {' · previsto '}
            {vale.pagamentosPrevistos
              .map(
                (p) =>
                  `${FORMA_PAGAMENTO_LABEL[p.forma as FormaPagamento] ?? p.forma} (${formatBRL(p.valorCents)})`
              )
              .join(' + ')}
          </>
        )}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          className={SELECT_CLASSNAME}
          value={preenchimento.desfecho}
          onChange={(e) => {
            const desfecho = e.target.value as 'entregue' | 'insucesso'
            onAlterar({
              desfecho,
              motivo: desfecho === 'entregue' ? null : preenchimento.motivo,
              detalhe: desfecho === 'entregue' ? '' : preenchimento.detalhe,
              // Pagamento em vale com insucesso é recusado pelo contrato.
              // Limpar aqui evita o caixa preencher e a tela recusar
              // depois, sem ele entender por quê.
              pagamentos:
                desfecho === 'insucesso'
                  ? []
                  : preenchimento.pagamentos.length > 0
                    ? preenchimento.pagamentos
                    : vale.pagamentosPrevistos.map((p) => ({
                        forma: p.forma as FormaPagamento,
                        digitos: String(p.valorCents),
                        trocoDigitos: p.trocoCents ? String(p.trocoCents) : '',
                      })),
            })
          }}
        >
          <option value="entregue">Entregue</option>
          <option value="insucesso">Insucesso</option>
        </select>

        {!entregue && (
          <select
            className={SELECT_CLASSNAME}
            value={preenchimento.motivo ?? ''}
            onChange={(e) => onAlterar({ motivo: e.target.value as MotivoInsucesso })}
          >
            <option value="" disabled>
              Motivo…
            </option>
            {MOTIVOS_INSUCESSO.map((motivo) => (
              <option key={motivo} value={motivo}>
                {INSUCESSO_MOTIVO_LABEL[motivo]}
              </option>
            ))}
          </select>
        )}
      </div>

      {!entregue && preenchimento.motivo === 'outro' && (
        <Textarea
          value={preenchimento.detalhe}
          onChange={(e) => onAlterar({ detalhe: e.target.value })}
          placeholder="O que aconteceu?"
        />
      )}

      {entregue && vale.pagamentosPrevistos.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs">Como o cliente pagou</Label>
          {preenchimento.pagamentos.map((linha, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="flex w-40 flex-col gap-0.5">
                <Label className="text-[0.65rem] text-foreground/70">Forma</Label>
                <select
                  className={SELECT_CLASSNAME}
                  value={linha.forma}
                  onChange={(e) => alterarLinha(i, { forma: e.target.value as FormaPagamento })}
                >
                  {FORMAS_PAGAMENTO.map((forma) => (
                    <option key={forma} value={forma}>
                      {FORMA_PAGAMENTO_LABEL[forma] ?? forma}
                    </option>
                  ))}
                </select>
              </div>
              {/* OS DOIS CAMPOS PRECISAM DE RÓTULO, e isto não é
                  capricho: eles são visualmente idênticos, ficam lado a
                  lado, e um decide o que o documento assinado vai
                  afirmar que o cliente pagou. Sem rótulo, "R$ 1.312,90"
                  e "R$ 20,00" são dois campos iguais e a única defesa
                  contra trocá-los é a memória de quem digita. */}
              <div className="flex w-36 flex-col gap-0.5">
                <Label className="text-[0.65rem] text-foreground/70">Valor</Label>
                <CampoMoeda
                  digitos={linha.digitos}
                  onDigitos={(d) => alterarLinha(i, { digitos: d })}
                />
              </div>
              {linha.forma === 'dinheiro' && (
                <div className="flex w-32 flex-col gap-0.5">
                  <Label className="text-[0.65rem] text-foreground/70">Troco</Label>
                  <CampoMoeda
                    digitos={linha.trocoDigitos}
                    onDigitos={(d) => alterarLinha(i, { trocoDigitos: d })}
                  />
                </div>
              )}
              {preenchimento.pagamentos.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onAlterar({
                      pagamentos: preenchimento.pagamentos.filter((_, j) => j !== i),
                    })
                  }
                >
                  Remover
                </Button>
              )}
            </div>
          ))}
          {preenchimento.pagamentos.length < MAX_PAGAMENTOS && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                onAlterar({
                  pagamentos: [
                    ...preenchimento.pagamentos,
                    { forma: 'dinheiro', digitos: '', trocoDigitos: '' },
                  ],
                })
              }
            >
              + Outra forma
            </Button>
          )}
          {/* AVISO, não bloqueio. O DCRR1 não exige que a soma bata, e o
              servidor deriva a divergência comparando previsto ×
              realizado — travar aqui deixaria um vale sem como ser
              fechado às 20h, no balcão, por causa de dado antigo. O que
              não pode é a diferença passar despercebida. */}
          {divergeDaCompra && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              A soma dá {formatBRL(somaRealizada)} e a compra foi {formatBRL(vale.valorCompraCents)}.
              Confere antes de assinar — o documento vai afirmar o que estiver aqui.
            </p>
          )}
        </div>
      )}

      {vale.documentosEsperados.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs">Papel que saiu com o motoboy</Label>
          {vale.documentosEsperados.map((tipo) => (
            <div key={tipo} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-44">{DOCUMENTO_LABEL[tipo]}</span>
              {/* SEM VALOR INICIAL. `recebido` é presença física, e é uma
                  afirmação que ninguém pode conferir depois — deixá-la
                  marcada por inércia faria o documento assinado dizer que
                  o papel voltou porque o caixa não olhou. */}
              {(['recebido', 'faltante'] as const).map((situacao) => (
                <Button
                  key={situacao}
                  type="button"
                  size="sm"
                  variant={preenchimento.documentos[tipo] === situacao ? 'default' : 'outline'}
                  onClick={() =>
                    onAlterar({ documentos: { ...preenchimento.documentos, [tipo]: situacao } })
                  }
                >
                  {situacao === 'recebido' ? 'Voltou' : 'Não voltou'}
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// Cartão e PIN
//
// O vocabulário muda entre online e offline, e essa é a regra: a tela
// nunca afirma o que não sabe. Online a identidade foi CONFIRMADA pelo
// servidor; offline ela foi INFORMADA pelo cartão, e o PIN foi guardado
// sem que ninguém o conferisse.
// ---------------------------------------------------------------------
function CustodiaDoMotoboy({
  custodia,
  contexto,
  token,
  setToken,
  pinRef,
  pinCompleto,
  setPinCompleto,
  ocupado,
  online,
  segundosRestantes,
  onBipar,
  onConferirPin,
  onTrocarMotoboy,
}: {
  custodia: EstadoCustodia
  contexto: ContextoRetorno
  token: string
  setToken: (v: string) => void
  pinRef: React.RefObject<HTMLInputElement | null>
  pinCompleto: boolean
  setPinCompleto: (v: boolean) => void
  ocupado: string | null
  online: boolean
  segundosRestantes: number | null
  onBipar: (valor: string) => void
  onConferirPin: () => void
  onTrocarMotoboy: () => void
}) {
  const identificado = custodia.credencial !== null
  const autenticado = custodia.autorizacaoId !== null
  const capturado = podeGuardarSegredos(custodia)

  if (!identificado) {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor="cartao-retorno">Bipa a credencial de {contexto.motoboyNome ?? '—'}</Label>
        <Input
          id="cartao-retorno"
          autoFocus
          placeholder="Passe o cartão no leitor…"
          value={token}
          disabled={ocupado === 'bipando'}
          onChange={(e) => setToken(e.target.value)}
          // O leitor age como teclado e manda Enter no fim. Digitar à mão
          // também funciona — é a saída quando o leitor falha.
          onKeyDown={(e) => {
            if (e.key === 'Enter') onBipar(e.currentTarget.value)
          }}
        />
        <p className="text-xs text-foreground/70">
          Cartão e PIN de novo, sim: são duas transferências de custódia em sentidos opostos, e a
          autenticação da saída não prova um ato de agora.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <p className="font-medium">{contexto.motoboyNome ?? '—'}</p>
          <p className="text-xs text-foreground/70">{contexto.agenciaNome ?? '—'}</p>
        </div>
        <Badge variant={custodia.credencial?.valor.validadaPeloServidor ? 'secondary' : 'outline'}>
          {custodia.credencial?.valor.validadaPeloServidor
            ? 'Credencial reconhecida'
            : 'Credencial informada'}
        </Badge>
        <Button variant="ghost" size="sm" onClick={onTrocarMotoboy}>
          Trocar
        </Button>
      </div>

      {!autenticado && !capturado && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="pin-retorno">PIN do motoboy</Label>
          <div className="flex items-center gap-2">
            <Input
              id="pin-retorno"
              ref={pinRef}
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              className="max-w-40 tracking-[0.5em]"
              // NÃO CONTROLADO de propósito: o PIN em claro não entra em
              // estado do React. O que o componente guarda é este
              // booleano, e é só o que o botão precisa saber.
              onChange={(e) => {
                e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '')
                setPinCompleto(e.currentTarget.value.length === 6)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConferirPin()
              }}
            />
            <Button
              type="button"
              variant="outline"
              // Botão explícito, e não verificação automática ao completar
              // 6 dígitos: cada tentativa errada conta pro bloqueio
              // progressivo, e quem se atrapalha digitando queimaria o
              // bloqueio do motoboy sem ter errado o PIN de verdade.
              disabled={!pinCompleto || ocupado === 'conferindo'}
              onClick={onConferirPin}
            >
              {ocupado === 'conferindo' ? (
                <EmAndamento>Conferindo</EmAndamento>
              ) : online ? (
                'Confirmar identidade'
              ) : (
                'Guardar PIN'
              )}
            </Button>
          </div>
          {!online && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Sem internet o PIN não pode ser conferido — o HMAC e o bcrypt vivem no servidor. Ele
              fica guardado só na memória desta tela até o retorno ser registrado, e é validado na
              sincronização.
            </p>
          )}
        </div>
      )}

      {autenticado && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            ✓ Identidade confirmada — {contexto.motoboyNome}
          </p>
          {segundosRestantes !== null && (
            // O relógio aparece porque ele CORRE durante as assinaturas.
            // Vencido, a autorização e as duas assinaturas são recolhidas
            // — e é melhor o caixa ver o tempo do que descobrir depois.
            <p className="text-xs text-foreground/70">
              A autenticação vale por mais {Math.floor(segundosRestantes / 60)}:
              {String(segundosRestantes % 60).padStart(2, '0')} — assine dentro desse tempo.
            </p>
          )}
        </div>
      )}

      {capturado && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          PIN guardado, mas <strong>não conferido</strong> — sem internet não dá pra validar agora.
          Se estiver errado, o retorno não vai ser selado e a gestão precisa resolver.
        </p>
      )}
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

// "Registrado" e "validado" não podem se parecer. O retorno offline é uma
// afirmação do balcão; o selo é uma afirmação do servidor.
function ResultadoDoRetorno({
  resultado,
  onFechar,
  onVoltar,
}: {
  resultado: Resultado
  onFechar: () => void
  onVoltar: () => void
}) {
  const estilos: Record<Resultado['kind'], string> = {
    selado: 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/40',
    offline: 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/40',
    conflito: 'border-destructive/40 bg-destructive/5',
    erro: 'border-destructive/40 bg-destructive/5',
  }

  return (
    <div className={`rounded-lg border p-4 text-sm ${estilos[resultado.kind]}`}>
      {resultado.kind === 'selado' && (
        <p>
          <strong>Romaneio de retorno {resultado.numero} selado.</strong> A corrida está fechada.
          {resultado.finalHash && (
            <span className="block font-mono text-xs text-foreground/70">
              hash {resultado.finalHash.slice(0, 16)}…
            </span>
          )}
        </p>
      )}
      {resultado.kind === 'offline' && (
        <p>
          <strong>Retorno registrado offline.</strong> Ainda <em>não</em> foi validado pelo servidor
          — isso acontece sozinho quando a internet voltar, com esta mesma conta.
        </p>
      )}
      {resultado.kind === 'conflito' && (
        <p>
          <strong>Conflito ao selar{resultado.numero ? ` (${resultado.numero})` : ''}.</strong> A
          tentativa ficou registrada no servidor com as duas assinaturas preservadas — a gestão
          precisa resolver. Não adianta tentar de novo.
        </p>
      )}
      {resultado.kind === 'erro' && <p className="text-destructive">{resultado.texto}</p>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={onFechar}>
          Voltar para as corridas
        </Button>
        {resultado.kind === 'erro' && (
          <Button size="sm" variant="ghost" onClick={onVoltar}>
            Sair
          </Button>
        )}
      </div>
    </div>
  )
}
