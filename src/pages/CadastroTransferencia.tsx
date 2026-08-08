import { useRef, useState, type KeyboardEvent } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useCriarTransferencia } from '@/data/entregas'
import { useLojas } from '@/data/lojas'
import { uuidv7 } from '@/lib/uuid'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

type Status = { kind: 'ok'; texto: string } | { kind: 'error'; texto: string } | null

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

export function CadastroTransferencia({
  profile,
  onVoltar,
}: {
  profile: AuthProfile
  onVoltar: () => void
}) {
  if (!profile.lojaId) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center text-muted-foreground">
        Sua conta não tem uma loja associada — transferência precisa de uma loja de origem. Fale
        com o administrador.
      </div>
    )
  }
  const lojaId = profile.lojaId

  return <CadastroTransferenciaForm profile={profile} lojaId={lojaId} onVoltar={onVoltar} />
}

function CadastroTransferenciaForm({
  profile,
  lojaId,
  onVoltar,
}: {
  profile: AuthProfile
  lojaId: string
  onVoltar: () => void
}) {
  const { data: lojas, isLoading, isError } = useLojas()
  const destinos = (lojas ?? []).filter((loja) => loja.id !== lojaId)

  const [id, setId] = useState(() => uuidv7())
  const [lojaDestinoId, setLojaDestinoId] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)

  const selectRef = useRef<HTMLSelectElement>(null)
  const criarTransferencia = useCriarTransferencia()
  const hoje = new Date().toLocaleDateString('pt-BR')

  function resetForm() {
    setId(uuidv7())
    setLojaDestinoId('')
    selectRef.current?.focus()
  }

  function handleSalvar() {
    const destino = destinos.find((loja) => loja.id === lojaDestinoId)
    if (!destino) {
      setErroValidacao('Escolhe a filial de destino.')
      return
    }
    setErroValidacao(null)

    const payload = {
      id,
      tenantId: profile.tenantId,
      lojaId,
      lojaOrigemNome: profile.lojaNome ?? 'Filial',
      lojaDestinoId: destino.id,
      lojaDestinoNome: destino.nome,
      criadoPor: profile.id,
      ocorridoEmLocal: new Date().toISOString(),
    }

    criarTransferencia.mutate(payload, {
      onSuccess: (resultado) => {
        setStatus({
          kind: 'ok',
          texto: `Transferência salva: ${payload.lojaOrigemNome} para ${payload.lojaDestinoNome} (vale ${resultado.numeroVale})`,
        })
      },
      onError: (error) => {
        setStatus({ kind: 'error', texto: `Não salvou a transferência: ${error.message}` })
      },
    })

    resetForm()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLSelectElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    handleSalvar()
  }

  return (
    <div className="mx-auto max-w-sm">
      <Button variant="ghost" className="mb-3" onClick={onVoltar}>
        ← Voltar para a lista
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Transferência entre filiais</CardTitle>
          <p className="text-sm text-muted-foreground">
            {hoje} · De: {profile.lojaNome ?? 'sua filial'}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="loja-destino">Filial de destino</Label>
              {isLoading && <p className="text-sm text-muted-foreground">Carregando filiais…</p>}
              {isError && (
                <p className="text-sm text-destructive">Não consegui carregar as filiais.</p>
              )}
              {!isLoading && !isError && (
                <select
                  id="loja-destino"
                  ref={selectRef}
                  autoFocus
                  className={SELECT_CLASSNAME}
                  value={lojaDestinoId}
                  onChange={(e) => setLojaDestinoId(e.target.value)}
                  onKeyDown={handleKeyDown}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {destinos.map((loja) => (
                    <option key={loja.id} value={loja.id}>
                      {loja.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {erroValidacao && <p className="text-sm text-destructive">{erroValidacao}</p>}

            <Button type="button" onClick={handleSalvar}>
              Salvar (Enter)
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
