import { useRef, useState, type KeyboardEvent } from 'react'
import type { AuthProfile } from '@/data/auth'
import type { NovaEntrega } from '@/data/entregas'
import { enfileirarOperacao, donoDaFila } from '@/data/filaOffline'
import { FORMA_PAGAMENTO_OPTIONS, type FormaPagamento } from '@/data/pagamentos'
import { useConveniosCadastro } from '@/data/cadastros'
import { uuidv7 } from '@/lib/uuid'
import { useTarifaDaLoja } from '@/data/lojas'
import { centsFromDigits, formatBRL } from '@/lib/money'
import { CampoMoeda } from '@/components/CampoMoeda'
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
  // dígitos crus da máscara de centavos ('' = vazio, '12345' = R$ 123,45)
  const [valorCompra, setValorCompra] = useState('')
  // 1 normal, 2 em endereço distante. O caixa não digita valor de
  // entrega: a tarifa é fixa por filial e o valor sai daqui.
  const [quantidadeVales, setQuantidadeVales] = useState(1)
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('dinheiro')
  const [convenioId, setConvenioId] = useState('')
  const [temReceita, setTemReceita] = useState(false)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)

  const { data: convenios } = useConveniosCadastro()
  const conveniosAtivos = (convenios ?? []).filter((c) => c.ativo)
  const tarifaCents = useTarifaDaLoja(lojaId)

  // O vale extra do endereço distante o cliente paga em mãos ao motoboy —
  // não entra no acerto da farmácia com a agência. Menos quando o
  // convênio escolhido banca a entrega inteira (caso do Minerva).
  const convenioIntegral =
    formaPagamento === 'convenio' &&
    !!conveniosAtivos.find((c) => c.id === convenioId)?.farmaciaPagaEntregaIntegral

  const valorEntregaCents = (tarifaCents ?? 0) * quantidadeVales
  const entregaPagaClienteCents =
    quantidadeVales > 1 && !convenioIntegral ? (tarifaCents ?? 0) * (quantidadeVales - 1) : 0

  const nomeRef = useRef<HTMLInputElement>(null)
  const enderecoRef = useRef<HTMLInputElement>(null)
  const valorCompraRef = useRef<HTMLInputElement>(null)
  const valesRef = useRef<HTMLSelectElement>(null)
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
    setQuantidadeVales(1)
    setFormaPagamento('dinheiro')
    setConvenioId('')
    setTemReceita(false)
    nomeRef.current?.focus()
  }

  function handleSalvar() {
    const nomeTrim = nome.trim()
    const enderecoTrim = endereco.trim()
    const valorCompraCents = centsFromDigits(valorCompra)

    if (!nomeTrim || !enderecoTrim || valorCompraCents <= 0) {
      setErroValidacao('Preenche nome, endereço e valor da compra antes de salvar.')
      return
    }
    if (formaPagamento === 'convenio' && !convenioId) {
      setErroValidacao('Escolhe o convênio.')
      return
    }
    // Sem tarifa carregada não dá pra montar o valor da entrega — melhor
    // barrar que gravar entrega com valor zero em silêncio.
    if (tarifaCents === null) {
      setErroValidacao('Não consegui carregar a tarifa da filial. Recarrega a página.')
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
      valorCompraCents,
      valorEntregaCents,
      quantidadeVales,
      entregaPagaClienteCents,
      formaPagamento,
      ocorridoEmLocal: new Date().toISOString(),
      convenioId: formaPagamento === 'convenio' ? convenioId : null,
      temReceita,
    }

    // grava na fila local primeiro (sempre funciona, mesmo sem rede) e já
    // libera a tela pro próximo cliente — sincroniza em segundo plano. O
    // número do vale só existe depois de sincronizar (é o banco que gera),
    // por isso não aparece aqui; confere na lista "Hoje" depois.
    void enfileirarOperacao('entrega', donoDaFila(profile), payload, { chave: payload.id })
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
              <Label htmlFor="valor-compra">Valor da compra</Label>
              <CampoMoeda
                id="valor-compra"
                ref={valorCompraRef}
                digitos={valorCompra}
                onDigitos={setValorCompra}
                onKeyDown={advanceOnEnter(valesRef)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="quantidade-vales">Entrega</Label>
              {/* A tarifa é fixa, então o caixa escolhe QUANTOS vales em vez
                  de digitar valor — no caso normal ele só passa com Enter,
                  sem digitar nada. Endereço distante cobra 2. */}
              <select
                id="quantidade-vales"
                ref={valesRef}
                className={SELECT_CLASSNAME}
                value={quantidadeVales}
                onChange={(e) => setQuantidadeVales(Number(e.target.value))}
                onKeyDown={advanceOnEnter(formaRef)}
              >
                <option value={1}>
                  1 vale{tarifaCents !== null ? ` — ${formatBRL(tarifaCents)}` : ''}
                </option>
                <option value={2}>
                  2 vales (endereço distante)
                  {tarifaCents !== null ? ` — ${formatBRL(tarifaCents * 2)}` : ''}
                </option>
              </select>
              {quantidadeVales > 1 && (
                <p className="text-xs text-muted-foreground">
                  {entregaPagaClienteCents > 0
                    ? `Cliente paga ${formatBRL(entregaPagaClienteCents)} em mãos ao motoboy.`
                    : 'Convênio banca a entrega inteira — nada a receber do cliente.'}
                </p>
              )}
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
