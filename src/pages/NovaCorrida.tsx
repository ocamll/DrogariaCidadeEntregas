import { useEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'
import type { AuthProfile } from '@/data/auth'
import { useCidadeDaLoja } from '@/data/lojas'
import { useAgenciasDaCidade } from '@/data/corridas'
import {
  useValesParaSaida,
  prepararRomaneio,
  autorizarSaida,
  selarRomaneio,
  documentHashLocal,
  capturarGeolocalizacao,
  type SaidaOfflineInput,
} from '@/data/romaneios'
import {
  identificarCredencial,
  identificarNoCache,
  sincronizarCacheDeCredenciais,
  definirPin,
  pinAceitavel,
  publicIdDoToken,
} from '@/data/credenciais'
import { selarSegredos, calcularOfflineEventHash, envelopeDisponivel } from '@/lib/envelope'
import { enfileirarOperacao, donoDaFila } from '@/data/filaOffline'
import type { EntradaCanonica, ValeCanonico } from '@/lib/canonico'
import { uuidv7 } from '@/lib/uuid'
import { formatBRL } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

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

function NovaCorridaFluxo({
  profile,
  lojaId,
  onVoltar,
}: {
  profile: AuthProfile
  lojaId: string
  onVoltar: () => void
}) {
  const { data: vales, isLoading } = useValesParaSaida()
  const cidadeId = useCidadeDaLoja(lojaId)
  const { data: agenciasDaCidade } = useAgenciasDaCidade(cidadeId)

  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [token, setToken] = useState('')
  const [credencial, setCredencial] = useState<Credencial | null>(null)
  const [pin, setPin] = useState('')
  const [pinConfirmacao, setPinConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const caixaPad = useRef<SignaturePad | null>(null)
  const motoboyPad = useRef<SignaturePad | null>(null)

  // O cache de credenciais é o que faz bipar funcionar sem rede. Atualiza
  // quando a tela monta e houver internet; se falhar, o cache anterior
  // continua valendo — que é exatamente pra isso que ele existe.
  useEffect(() => {
    if (navigator.onLine) void sincronizarCacheDeCredenciais().catch(() => {})
  }, [])

  const escolhidos: ValeCanonico[] = (vales ?? []).filter((v) => selecionadas.has(v.entregaId))
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
    setCredencial(null)
    setToken('')
    setPin('')
  }

  function montarEntrada(): EntradaCanonica {
    return {
      tenantId: profile.tenantId,
      lojaId,
      agenciaId: credencial?.agenciaId ?? null,
      motoboyId: credencial?.motoboyId ?? '',
      caixaId: profile.id,
      vales: escolhidos,
    }
  }

  async function handleBipar(valor: string) {
    setErro(null)
    const limpo = valor.trim()
    if (!publicIdDoToken(limpo)) {
      setErro('Isso não parece um cartão do sistema. Bipa de novo.')
      return
    }
    setToken(limpo)
    setOcupado('bipando')

    try {
      let achada: Credencial | null = null

      if (navigator.onLine) {
        const online = await identificarCredencial(limpo)
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
            setErro(
              `Credencial bloqueada até ${new Date(online.bloqueadoAte).toLocaleTimeString('pt-BR')} por tentativas de PIN.`
            )
            setOcupado(null)
            return
          }
        }
      } else {
        const local = await identificarNoCache(limpo)
        if (local) {
          achada = {
            motoboyId: local.motoboyId,
            motoboyNome: local.motoboyNome,
            agenciaId: local.agenciaId,
            agenciaNome: local.agenciaNome,
            temPin: local.temPin,
            verificada: false,
          }
        }
      }

      if (!achada) {
        setErro(
          navigator.onLine
            ? 'Credencial não reconhecida.'
            : 'Cartão desconhecido neste computador. Sem internet, só dá pra reconhecer cartões que já apareceram aqui antes.'
        )
        setToken('')
        setOcupado(null)
        return
      }

      // Uma agência de outra cidade não atende esta filial. É a mesma
      // regra do dropdown antigo, agora aplicada ao que o cartão trouxe.
      const permitida = agenciasDaCidade?.some((a) => a.id === achada.agenciaId)
      if (agenciasDaCidade && !permitida) {
        setErro(
          `${achada.motoboyNome} é de ${achada.agenciaNome ?? 'uma agência sem cidade'}, que não atende esta filial.`
        )
        setToken('')
        setOcupado(null)
        return
      }

      setCredencial(achada)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
      setToken('')
    } finally {
      setOcupado(null)
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
      setCredencial((c) => (c ? { ...c, temPin: true } : c))
      setPinConfirmacao('')
      setPin('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(null)
    }
  }

  async function handleConfirmar() {
    setErro(null)
    if (escolhidos.length === 0) return setErro('Marca pelo menos um vale.')
    if (!credencial) return setErro('Falta bipar o cartão do motoboy.')
    if (!credencial.temPin) return setErro('Este motoboy ainda precisa criar o PIN dele.')
    if (pinAceitavel(pin)) return setErro('Falta o PIN do motoboy.')
    if (!caixaPad.current || caixaPad.current.isEmpty()) return setErro('Falta a sua assinatura.')
    if (!motoboyPad.current || motoboyPad.current.isEmpty()) {
      return setErro('Falta a assinatura do motoboy.')
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
    const caixaStrokes = caixaPad.current.toData()
    const motoboyStrokes = motoboyPad.current.toData()

    try {
      const geolocalizacao = await capturarGeolocalizacao()
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

        const autorizacao = await autorizarSaida(token, pin, documentHash)
        if (!autorizacao.ok) {
          setErro(
            autorizacao.motivo === 'pin_incorreto'
              ? 'PIN incorreto.'
              : autorizacao.motivo === 'bloqueado'
                ? 'Credencial bloqueada por tentativas seguidas de PIN incorreto.'
                : 'Não consegui autenticar o motoboy.'
          )
          setOcupado(null)
          return
        }
        autorizacaoId = autorizacao.autorizacaoId
      }

      // O envelope é selado SEMPRE, mesmo online: se o selo falhar por
      // rede no meio do caminho, a operação cai na fila e lá o PIN já
      // precisa estar protegido. Selar custa milissegundos.
      const offlineEventHash = await calcularOfflineEventHash({
        documentHash,
        romaneioId,
        caixaStrokes,
        motoboyStrokes,
        ocorridoEmLocal,
        geolocalizacao,
      })
      const envelope = await selarSegredos({
        pin,
        credentialToken: token,
        operationId: romaneioId,
        documentHash,
        offlineEventHash,
      })

      const paraFila: SaidaOfflineInput = {
        romaneioId,
        corridaId,
        lojaId,
        agenciaId: entrada.agenciaId,
        motoboyId: entrada.motoboyId,
        entregaIds: escolhidos.map((v) => v.entregaId),
        documentHash,
        caixaStrokes,
        motoboyStrokes,
        ocorridoEmLocal,
        geolocalizacao,
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
            caixaStrokes,
            motoboyStrokes,
            ocorridoEmLocal,
            geolocalizacao,
          })
          setResultado(
            selo.ok
              ? { kind: 'selado', numero: selo.numero, finalHash: selo.finalHash }
              : { kind: 'conflito', numero: selo.numero, detalhe: selo.conflitos }
          )
          limpar()
          return
        } catch {
          // Caiu no meio do selo online. A retirada física pode ter
          // acontecido, então NÃO se perde: vai pra fila com os mesmos
          // ids, e o reenvio é no-op se por acaso já tiver selado.
        }
      }

      await enfileirarOperacao('romaneio_saida', donoDaFila(profile), paraFila, {
        chave: corridaId,
      })
      setResultado({ kind: 'offline' })
      limpar()
    } catch (e) {
      setResultado({ kind: 'erro', texto: e instanceof Error ? e.message : String(e) })
    } finally {
      setOcupado(null)
    }
  }

  function limpar() {
    setSelecionadas(new Set())
    setToken('')
    setCredencial(null)
    setPin('')
    setPinConfirmacao('')
    caixaPad.current?.clear()
    motoboyPad.current?.clear()
  }

  const podeConfirmar =
    escolhidos.length > 0 && credencial !== null && credencial.temPin && !pinAceitavel(pin)

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
            {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {!isLoading && (vales ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum vale pendente pra sair agora.</p>
            )}
            {(vales ?? []).length > 0 && (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                {vales!.map((vale) => (
                  <label key={vale.entregaId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selecionadas.has(vale.entregaId)}
                      onChange={() => toggle(vale.entregaId)}
                    />
                    <span>
                      <strong>{vale.numeroVale}</strong> — {vale.clienteNome} ({vale.clienteEndereco}
                      )
                      {vale.quantidadeVales > 1 && ` · ${vale.quantidadeVales} vales`}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Secao>

          <Secao numero={2} titulo="Motoboy" desabilitada={escolhidos.length === 0}>
            {!credencial && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="cartao">Bipa a credencial</Label>
                <Input
                  id="cartao"
                  autoFocus
                  placeholder="Passe o cartão no leitor…"
                  value={token}
                  disabled={escolhidos.length === 0 || ocupado === 'bipando'}
                  onChange={(e) => setToken(e.target.value)}
                  // O leitor age como teclado e manda Enter no fim. Digitar
                  // à mão também funciona — é a saída quando o leitor falha.
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleBipar(e.currentTarget.value)
                  }}
                />
              </div>
            )}

            {credencial && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div>
                    <p className="font-medium">{credencial.motoboyNome}</p>
                    <p className="text-xs text-foreground/70">{credencial.agenciaNome ?? '—'}</p>
                  </div>
                  <Badge variant={credencial.verificada ? 'secondary' : 'outline'}>
                    {credencial.verificada ? 'Credencial reconhecida' : 'Credencial informada'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCredencial(null)
                      setToken('')
                      setPin('')
                    }}
                  >
                    Trocar
                  </Button>
                </div>

                {!credencial.temPin ? (
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
                ) : (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="pin">PIN do motoboy</Label>
                    <Input
                      id="pin"
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="••••••"
                      className="max-w-40 tracking-[0.5em]"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                )}
              </div>
            )}
          </Secao>

          <Secao numero={3} titulo="Custódia" desabilitada={!podeConfirmar}>
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoAssinatura rotulo={`Caixa · ${profile.nome}`} padRef={caixaPad} />
              <CampoAssinatura
                rotulo={`Motoboy · ${credencial?.motoboyNome ?? '—'}`}
                padRef={motoboyPad}
              />
            </div>
          </Secao>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm">
              <p>
                <strong>{escolhidos.length}</strong> entrega(s) · <strong>{totalVales}</strong>{' '}
                vale(s) · <strong>{formatBRL(totalEntrega)}</strong> em teles
              </p>
              {!navigator.onLine && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Sem internet — a saída fica registrada aqui e vai ser validada quando a rede
                  voltar.
                </p>
              )}
            </div>
            <Button onClick={() => void handleConfirmar()} disabled={!podeConfirmar || !!ocupado}>
              {ocupado === 'confirmar'
                ? 'Registrando…'
                : navigator.onLine
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

function CampoAssinatura({
  rotulo,
  padRef,
}: {
  rotulo: string
  padRef: React.RefObject<SignaturePad | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d')?.scale(ratio, ratio)

    const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' })
    padRef.current = pad
    return () => {
      pad.off()
      padRef.current = null
    }
  }, [padRef])

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{rotulo}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => padRef.current?.clear()}>
          Limpar
        </Button>
      </div>
      <canvas ref={canvasRef} className="h-32 w-full touch-none rounded-lg border bg-white" />
    </div>
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
          vale já saiu em outra corrida. A tentativa ficou registrada com as assinaturas — a gestão
          precisa resolver.
        </p>
      )}
      {resultado.kind === 'erro' && <p className="text-destructive">{resultado.texto}</p>}
      <Button variant="ghost" size="sm" className="mt-1" onClick={onFechar}>
        Fechar
      </Button>
    </div>
  )
}
