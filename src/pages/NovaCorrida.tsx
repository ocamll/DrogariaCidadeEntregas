import { useEffect, useRef, useState } from 'react'
import SignaturePad from 'signature_pad'
import type { AuthProfile } from '@/data/auth'
import {
  useAgencias,
  useMototaxistas,
  useEntregasPendentesSemCorrida,
  type NovaCorridaComAssinatura,
} from '@/data/corridas'
import { enfileirarOperacao } from '@/data/filaOffline'
import { uuidv7 } from '@/lib/uuid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

type Status = { kind: 'ok'; texto: string } | { kind: 'error'; texto: string } | null

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

export function NovaCorrida({ profile, onVoltar }: { profile: AuthProfile; onVoltar: () => void }) {
  if (!profile.lojaId) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center text-muted-foreground">
        Sua conta não tem uma loja associada — corrida precisa de uma loja. Fale com o
        administrador.
      </div>
    )
  }
  const lojaId = profile.lojaId

  return <NovaCorridaForm profile={profile} lojaId={lojaId} onVoltar={onVoltar} />
}

function NovaCorridaForm({
  profile,
  lojaId,
  onVoltar,
}: {
  profile: AuthProfile
  lojaId: string
  onVoltar: () => void
}) {
  const { data: agencias, isLoading: carregandoAgencias } = useAgencias()
  const { data: mototaxistas, isLoading: carregandoMoto } = useMototaxistas()
  const { data: entregas, isLoading: carregandoEntregas } = useEntregasPendentesSemCorrida()

  const [agenciaId, setAgenciaId] = useState('')
  const [mototaxistaId, setMototaxistaId] = useState('')
  const motoboysDaAgencia = mototaxistas?.filter((m) => m.agenciaId === agenciaId) ?? []
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)

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
  }, [])

  function toggleEntrega(id: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function limparAssinatura() {
    padRef.current?.clear()
  }

  function limparFormulario() {
    setAgenciaId('')
    setMototaxistaId('')
    setSelecionadas(new Set())
    limparAssinatura()
  }

  function handleAgenciaChange(novaAgenciaId: string) {
    setAgenciaId(novaAgenciaId)
    setMototaxistaId('') // motoboy escolhido pode não ser dessa agência
  }

  function handleConfirmar() {
    if (!agenciaId) {
      setErro('Escolhe a agência de tele.')
      return
    }
    if (!mototaxistaId) {
      setErro('Escolhe o motoboy.')
      return
    }
    if (selecionadas.size === 0) {
      setErro('Marca pelo menos um vale pra essa saída.')
      return
    }
    if (!padRef.current || padRef.current.isEmpty()) {
      setErro('Falta a assinatura do motoboy.')
      return
    }
    setErro(null)

    const payload: NovaCorridaComAssinatura = {
      corridaId: uuidv7(),
      assinaturaId: uuidv7(),
      tenantId: profile.tenantId,
      lojaId,
      agenciaId,
      mototaxistaId,
      entregaIds: [...selecionadas],
      strokes: padRef.current.toData(),
      criadoPor: profile.id,
      ocorridoEmLocal: new Date().toISOString(),
    }

    // grava local e libera a tela na hora (mesmo padrão do cadastro de
    // entrega) — os números dos vales já existem (foram gerados na criação
    // da entrega), mas a confirmação da corrida em si só é definitiva depois
    // de sincronizar.
    void enfileirarOperacao('corrida', payload.corridaId, payload)
    setStatus({ kind: 'ok', texto: 'Corrida registrada — sincronizando…' })
    limparFormulario()
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" className="mb-3" onClick={onVoltar}>
        ← Voltar para a lista
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Nova corrida — assinatura na retirada</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="agencia">Agência de tele</Label>
              {carregandoAgencias && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {!carregandoAgencias && (
                <select
                  id="agencia"
                  className={SELECT_CLASSNAME}
                  value={agenciaId}
                  onChange={(e) => handleAgenciaChange(e.target.value)}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {agencias?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="mototaxista">Motoboy</Label>
              {carregandoMoto && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {!carregandoMoto && !agenciaId && (
                <p className="text-sm text-muted-foreground">Escolhe a agência primeiro.</p>
              )}
              {!carregandoMoto && agenciaId && motoboysDaAgencia.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum motoboy ativo nessa agência.</p>
              )}
              {!carregandoMoto && agenciaId && motoboysDaAgencia.length > 0 && (
                <select
                  id="mototaxista"
                  className={SELECT_CLASSNAME}
                  value={mototaxistaId}
                  onChange={(e) => setMototaxistaId(e.target.value)}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {motoboysDaAgencia.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Vales pra essa saída</Label>
              {carregandoEntregas && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {!carregandoEntregas && entregas?.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum vale pendente pra sair agora.</p>
              )}
              {!carregandoEntregas && entregas && entregas.length > 0 && (
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                  {entregas.map((entrega) => (
                    <label key={entrega.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selecionadas.has(entrega.id)}
                        onChange={() => toggleEntrega(entrega.id)}
                      />
                      <span>
                        {entrega.numeroVale} — {entrega.clienteNome} ({entrega.clienteEndereco})
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Assinatura do motoboy</Label>
                <Button type="button" variant="ghost" size="sm" onClick={limparAssinatura}>
                  Limpar
                </Button>
              </div>
              <canvas
                ref={canvasRef}
                className="h-48 w-full touch-none rounded-lg border bg-white"
              />
              <p className="text-xs text-muted-foreground">
                Assina confirmando que retirou os vales pra entrega — não é prova de chegada no
                endereço.
              </p>
            </div>

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <Button type="button" onClick={handleConfirmar}>
              Confirmar saída
            </Button>

            {status && (
              <p className={status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {status.texto}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
