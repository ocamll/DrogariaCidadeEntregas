import { useRef, useState, type KeyboardEvent } from 'react'
import type { AuthProfile } from '@/data/auth'
import type { NovaTransferencia } from '@/data/entregas'
import { enfileirarOperacao, donoDaFila } from '@/data/filaOffline'
import { useLojas, useTarifaDaLoja } from '@/data/lojas'
import { formatBRL } from '@/lib/money'
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
  const fornecedoras = (lojas ?? []).filter((loja) => loja.id !== lojaId)
  // mesma tarifa fixa da entrega de cliente: a transferência também é uma
  // corrida que a agência faz e cobra. Sempre 1 vale.
  const tarifaCents = useTarifaDaLoja(lojaId)

  const [id, setId] = useState(() => uuidv7())
  // filial que TEM o produto. Quem opera esta tela é a filial que está sem
  // ele e está pedindo — o motoboy passa na escolhida, pega, e entrega aqui.
  const [lojaOrigemId, setLojaOrigemId] = useState('')
  const [status, setStatus] = useState<Status>(null)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)

  const selectRef = useRef<HTMLSelectElement>(null)
  const hoje = new Date().toLocaleDateString('pt-BR')

  function resetForm() {
    setId(uuidv7())
    setLojaOrigemId('')
    selectRef.current?.focus()
  }

  function handleSalvar() {
    const origem = fornecedoras.find((loja) => loja.id === lojaOrigemId)
    if (!origem) {
      setErroValidacao('Escolhe a filial que tem o produto.')
      return
    }
    // Sem a tarifa carregada o vale iria pro banco valendo zero e ninguém
    // notaria — a transferência some do acerto com a agência em silêncio.
    // Melhor barrar e pedir pra tentar de novo.
    if (tarifaCents === null) {
      setErroValidacao('Ainda não carreguei a tarifa da sua filial. Tenta de novo em um instante.')
      return
    }
    setErroValidacao(null)

    const payload: NovaTransferencia = {
      id,
      tenantId: profile.tenantId,
      lojaId,
      lojaSolicitanteNome: profile.lojaNome ?? 'Filial',
      lojaOrigemId: origem.id,
      lojaOrigemNome: origem.nome,
      criadoPor: profile.id,
      ocorridoEmLocal: new Date().toISOString(),
      valorEntregaCents: tarifaCents,
    }

    // grava local e libera a tela na hora (mesmo padrão do cadastro de
    // entrega) — o número do vale só existe depois de sincronizar.
    void enfileirarOperacao('transferencia', donoDaFila(profile), payload, { chave: payload.id })
    setStatus({
      kind: 'ok',
      texto: `Transferência de ${payload.lojaOrigemNome} para ${payload.lojaSolicitanteNome} salva — sincronizando…`,
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
          {/* "Para" e não "De": quem lança é a filial que está sem o
              produto e vai recebê-lo. */}
          <p className="text-sm text-muted-foreground">
            {hoje} · Para: {profile.lojaNome ?? 'sua filial'}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="loja-origem">Filial que tem o produto</Label>
              {isLoading && <p className="text-sm text-muted-foreground">Carregando filiais…</p>}
              {isError && (
                <p className="text-sm text-destructive">Não consegui carregar as filiais.</p>
              )}
              {!isLoading && !isError && (
                <select
                  id="loja-origem"
                  ref={selectRef}
                  autoFocus
                  className={SELECT_CLASSNAME}
                  value={lojaOrigemId}
                  onChange={(e) => setLojaOrigemId(e.target.value)}
                  onKeyDown={handleKeyDown}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {fornecedoras.map((loja) => (
                    <option key={loja.id} value={loja.id}>
                      {loja.nome}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-foreground/70">
                O motoboy passa nela pra pegar o produto e entrega aqui.
              </p>
            </div>

            {/* Não é campo: o caixa não digita nem escolhe valor de
                entrega em lugar nenhum do sistema (tarifa fixa por
                filial). Está na tela só pra ele ver o que vai ser
                registrado, sem custar tecla nenhuma. */}
            <div className="flex items-baseline justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <span className="text-sm text-muted-foreground">Valor da entrega · 1 vale</span>
              <span className="text-sm font-medium">
                {tarifaCents === null ? '—' : formatBRL(tarifaCents)}
              </span>
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
