import { useRef, useState, type KeyboardEvent } from 'react'
import type { AuthProfile } from '@/data/auth'
import type { NovaEntrega } from '@/data/entregas'
import { enfileirarOperacao } from '@/data/filaOffline'
import { FORMA_PAGAMENTO_OPTIONS, type FormaPagamento } from '@/data/pagamentos'
import { useConveniosCadastro } from '@/data/cadastros'
import { uuidv7 } from '@/lib/uuid'
import { toCents } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Status = { kind: 'ok'; texto: string } | { kind: 'error'; texto: string } | null

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

export function CadastroEntrega({
  profile,
  onVoltar,
}: {
  profile: AuthProfile
  onVoltar: () => void
}) {
  if (!profile.lojaId) {
    return (
      <div className="mx-auto max-w-sm py-12 text-center text-muted-foreground">
        Sua conta não tem uma loja associada — cadastro de entrega precisa de uma loja. Fale com
        o administrador.
      </div>
    )
  }
  const lojaId = profile.lojaId

  return <CadastroEntregaForm profile={profile} lojaId={lojaId} onVoltar={onVoltar} />
}

function CadastroEntregaForm({
  profile,
  lojaId,
  onVoltar,
}: {
  profile: AuthProfile
  lojaId: string
  onVoltar: () => void
}) {
  const [id, setId] = useState(() => uuidv7())
  const [nome, setNome] = useState('')
  const [endereco, setEndereco] = useState('')
  const [valorCompra, setValorCompra] = useState('')
  const [valorEntrega, setValorEntrega] = useState('')
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('dinheiro')
  const [convenioId, setConvenioId] = useState('')
  const [temReceita, setTemReceita] = useState(false)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)

  const { data: convenios } = useConveniosCadastro()
  const conveniosAtivos = (convenios ?? []).filter((c) => c.ativo)

  const nomeRef = useRef<HTMLInputElement>(null)
  const enderecoRef = useRef<HTMLInputElement>(null)
  const valorCompraRef = useRef<HTMLInputElement>(null)
  const valorEntregaRef = useRef<HTMLInputElement>(null)
  const formaRef = useRef<HTMLSelectElement>(null)
  const convenioRef = useRef<HTMLSelectElement>(null)

  const hoje = new Date().toLocaleDateString('pt-BR')

  function advanceOnEnter<T extends HTMLInputElement | HTMLSelectElement>(nextRef: React.RefObject<T | null>) {
    return (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      nextRef.current?.focus()
      if ('select' in nextRef.current!) (nextRef.current as HTMLInputElement).select()
    }
  }

  function resetForm() {
    setId(uuidv7())
    setNome('')
    setEndereco('')
    setValorCompra('')
    setValorEntrega('')
    setFormaPagamento('dinheiro')
    setConvenioId('')
    setTemReceita(false)
    nomeRef.current?.focus()
  }

  function handleSalvar() {
    const nomeTrim = nome.trim()
    const enderecoTrim = endereco.trim()
    const valorCompraTrim = valorCompra.trim()

    if (!nomeTrim || !enderecoTrim || !valorCompraTrim) {
      setErroValidacao('Preenche nome, endereço e valor da compra antes de salvar.')
      return
    }
    if (formaPagamento === 'convenio' && !convenioId) {
      setErroValidacao('Escolhe o convênio.')
      return
    }
    setErroValidacao(null)

    const payload: NovaEntrega = {
      id,
      tenantId: profile.tenantId,
      lojaId,
      criadoPor: profile.id,
      clienteNome: nomeTrim,
      clienteEndereco: enderecoTrim,
      valorCompraCents: toCents(valorCompraTrim),
      valorEntregaCents: toCents(valorEntrega),
      formaPagamento,
      ocorridoEmLocal: new Date().toISOString(),
      convenioId: formaPagamento === 'convenio' ? convenioId : null,
      temReceita,
    }

    // grava na fila local primeiro (sempre funciona, mesmo sem rede) e já
    // libera a tela pro próximo cliente — sincroniza em segundo plano. O
    // número do vale só existe depois de sincronizar (é o banco que gera),
    // por isso não aparece aqui; confere na lista "Hoje" depois.
    void enfileirarOperacao('entrega', payload.id, payload)
    setStatus({ kind: 'ok', texto: `Entrega de ${payload.clienteNome} salva — sincronizando…` })

    resetForm()
  }

  // Forma "convênio" precisa dizer qual — Enter aqui vai pro select de
  // convênio em vez de salvar direto. Qualquer outra forma salva na hora,
  // igual sempre foi (o checkbox de receita fica fora dessa cadeia de
  // propósito, ver campo abaixo).
  function handleFormaKeyDown(e: KeyboardEvent<HTMLSelectElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (formaPagamento === 'convenio') {
      convenioRef.current?.focus()
      return
    }
    handleSalvar()
  }

  function handleConvenioKeyDown(e: KeyboardEvent<HTMLSelectElement>) {
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
          <CardTitle>Cadastro de entrega</CardTitle>
          <p className="text-sm text-muted-foreground">{hoje}</p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nome">Nome do cliente</Label>
              <Input
                id="nome"
                ref={nomeRef}
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={advanceOnEnter(enderecoRef)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="endereco">Endereço</Label>
              <Input
                id="endereco"
                ref={enderecoRef}
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                onKeyDown={advanceOnEnter(valorCompraRef)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="valor-compra">Valor da compra (R$)</Label>
              <Input
                id="valor-compra"
                ref={valorCompraRef}
                inputMode="decimal"
                value={valorCompra}
                onChange={(e) => setValorCompra(e.target.value)}
                onKeyDown={advanceOnEnter(valorEntregaRef)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="valor-entrega">Valor da entrega (R$)</Label>
              <Input
                id="valor-entrega"
                ref={valorEntregaRef}
                inputMode="decimal"
                value={valorEntrega}
                onChange={(e) => setValorEntrega(e.target.value)}
                onKeyDown={advanceOnEnter(formaRef)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="forma-pagamento">Forma de pagamento</Label>
              <select
                id="forma-pagamento"
                ref={formaRef}
                className={SELECT_CLASSNAME}
                value={formaPagamento}
                onChange={(e) => setFormaPagamento(e.target.value as FormaPagamento)}
                onKeyDown={handleFormaKeyDown}
              >
                {FORMA_PAGAMENTO_OPTIONS.map(([valor, label]) => (
                  <option key={valor} value={valor}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {formaPagamento === 'convenio' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="convenio">Convênio</Label>
                <select
                  id="convenio"
                  ref={convenioRef}
                  className={SELECT_CLASSNAME}
                  value={convenioId}
                  onChange={(e) => setConvenioId(e.target.value)}
                  onKeyDown={handleConvenioKeyDown}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {conveniosAtivos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={temReceita}
                onChange={(e) => setTemReceita(e.target.checked)}
              />
              Precisa de receita
            </label>

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
