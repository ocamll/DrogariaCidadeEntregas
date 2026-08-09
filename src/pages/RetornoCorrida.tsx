import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useCorridasAbertas,
  INSUCESSO_MOTIVO_OPTIONS,
  type CorridaAberta,
  type FecharCorridaInput,
  type InsucessoMotivo,
} from '@/data/corridas'
import { enfileirarOperacao } from '@/data/filaOffline'
import { uuidv7 } from '@/lib/uuid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Status = { kind: 'ok'; texto: string } | { kind: 'error'; texto: string } | null

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

export function RetornoCorrida({ profile, onVoltar }: { profile: AuthProfile; onVoltar: () => void }) {
  const { data: corridas, isLoading, isError, error } = useCorridasAbertas()
  const [corridaId, setCorridaId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)

  const corridaSelecionada = corridas?.find((c) => c.id === corridaId) ?? null

  if (corridaSelecionada) {
    return (
      <FecharCorridaForm
        corrida={corridaSelecionada}
        profile={profile}
        onVoltar={() => setCorridaId(null)}
        onFechada={(texto) => {
          setCorridaId(null)
          setStatus({ kind: 'ok', texto })
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
            {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {isError && (
              <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
            )}
            {!isLoading && !isError && corridas?.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma corrida em aberto agora.</p>
            )}
            {status && (
              <p className={status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {status.texto}
              </p>
            )}
            {corridas?.map((corrida) => (
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
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

type ResultadoEntrega = {
  status: 'entregue' | 'insucesso'
  motivo: InsucessoMotivo | null
  detalhe: string
}

function FecharCorridaForm({
  corrida,
  profile,
  onVoltar,
  onFechada,
}: {
  corrida: CorridaAberta
  profile: AuthProfile
  onVoltar: () => void
  onFechada: (texto: string) => void
}) {
  const [resultados, setResultados] = useState<Record<string, ResultadoEntrega>>(() =>
    Object.fromEntries(
      corrida.entregas.map((e) => [e.id, { status: 'entregue', motivo: null, detalhe: '' }])
    )
  )
  const [erro, setErro] = useState<string | null>(null)

  function setResultadoStatus(entregaId: string, statusEntrega: 'entregue' | 'insucesso') {
    setResultados((prev) => ({
      ...prev,
      [entregaId]: {
        status: statusEntrega,
        motivo: statusEntrega === 'entregue' ? null : prev[entregaId].motivo,
        detalhe: statusEntrega === 'entregue' ? '' : prev[entregaId].detalhe,
      },
    }))
  }

  function setResultadoMotivo(entregaId: string, motivo: InsucessoMotivo) {
    setResultados((prev) => ({
      ...prev,
      [entregaId]: { ...prev[entregaId], motivo, detalhe: motivo === 'outro' ? prev[entregaId].detalhe : '' },
    }))
  }

  function setResultadoDetalhe(entregaId: string, detalhe: string) {
    setResultados((prev) => ({ ...prev, [entregaId]: { ...prev[entregaId], detalhe } }))
  }

  function handleConfirmar() {
    for (const entrega of corrida.entregas) {
      const resultado = resultados[entrega.id]
      if (resultado.status === 'insucesso' && !resultado.motivo) {
        setErro(`Vale ${entrega.numeroVale}: escolhe o motivo do insucesso.`)
        return
      }
      if (resultado.status === 'insucesso' && resultado.motivo === 'outro' && !resultado.detalhe.trim()) {
        setErro(`Vale ${entrega.numeroVale}: escreve o motivo do insucesso.`)
        return
      }
    }
    setErro(null)

    const payload: FecharCorridaInput = {
      corridaId: corrida.id,
      tenantId: profile.tenantId,
      retornoPor: profile.id,
      autorNome: profile.nome,
      retornoEm: new Date().toISOString(),
      entregas: corrida.entregas.map((e) => {
        const resultado = resultados[e.id]
        const detalhe = resultado.motivo === 'outro' ? resultado.detalhe.trim() : ''
        return {
          entregaId: e.id,
          numeroVale: e.numeroVale,
          statusEntrega: resultado.status,
          insucessoMotivo: resultado.motivo,
          insucessoDetalhe: detalhe || null,
          eventoIdempotencyKey: detalhe ? uuidv7() : null,
        }
      }),
    }

    // grava local e volta pra lista na hora (mesmo padrão do cadastro de
    // entrega) — sincroniza em segundo plano.
    void enfileirarOperacao('fechamento_corrida', payload.corridaId, payload)
    onFechada(`Corrida de ${corrida.mototaxistaNome} fechada — sincronizando…`)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" className="mb-3" onClick={onVoltar}>
        ← Voltar
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>
            Retorno — {corrida.mototaxistaNome}
            {corrida.agenciaNome ? ` (${corrida.agenciaNome})` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {corrida.entregas.map((entrega) => {
              const resultado = resultados[entrega.id]
              return (
                <div key={entrega.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    {entrega.numeroVale} — {entrega.clienteNome}
                  </p>
                  <p className="text-xs text-muted-foreground">{entrega.clienteEndereco}</p>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Label className="sr-only">Resultado</Label>
                    <select
                      className={SELECT_CLASSNAME}
                      value={resultado.status}
                      onChange={(e) =>
                        setResultadoStatus(entrega.id, e.target.value as 'entregue' | 'insucesso')
                      }
                    >
                      <option value="entregue">Entregue</option>
                      <option value="insucesso">Insucesso</option>
                    </select>

                    {resultado.status === 'insucesso' && (
                      <select
                        className={SELECT_CLASSNAME}
                        value={resultado.motivo ?? ''}
                        onChange={(e) => setResultadoMotivo(entrega.id, e.target.value as InsucessoMotivo)}
                      >
                        <option value="" disabled>
                          Motivo…
                        </option>
                        {INSUCESSO_MOTIVO_OPTIONS.map(([valor, label]) => (
                          <option key={valor} value={valor}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {resultado.status === 'insucesso' && resultado.motivo === 'outro' && (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`detalhe-${entrega.id}`} className="text-xs">
                        Motivo do insucesso
                      </Label>
                      <Textarea
                        id={`detalhe-${entrega.id}`}
                        value={resultado.detalhe}
                        onChange={(e) => setResultadoDetalhe(entrega.id, e.target.value)}
                        placeholder="O que aconteceu?"
                      />
                    </div>
                  )}
                </div>
              )
            })}

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <Button type="button" onClick={handleConfirmar}>
              Confirmar retorno e fechar corrida
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
