import { useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { AuthProfile } from '@/data/auth'
import type { NovaEntrega, FormaPrevistaDoCadastro } from '@/data/entregas'
import { enfileirarOperacao, donoDaFila, gravacaoEnfileirada } from '@/data/filaOffline'
import {
  FORMA_PAGAMENTO_LABEL,
  FORMA_PAGAMENTO_OPTIONS,
  MAX_FORMAS_PREVISTAS,
  validarFormasPrevistas,
  resolverValoresDasFormas,
  digitosDoValor,
  type FormaPagamento,
} from '@/data/pagamentos'
import { useConveniosCadastro } from '@/data/cadastros'
import { uuidv7 } from '@/lib/uuid'
import { useTarifaDaLoja } from '@/data/lojas'
import { centsFromDigits, formatBRL } from '@/lib/money'
import { CampoMoeda } from '@/components/CampoMoeda'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDeGravacao, type Gravacao } from '@/components/StatusDeGravacao'
import { normalizarNome, normalizarEndereco } from '@/lib/texto'

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring md:text-sm dark:bg-input/30'

/**
 * Uma linha de forma de pagamento prevista — E4.
 *
 * `digitos` são os dígitos crus da máscara de centavos, igual em todo
 * campo de dinheiro do projeto — nunca texto livre com "," ou ".".
 *
 * **Ele é IGNORADO enquanto houver uma linha só**, e isso é o coração do
 * desenho: com uma forma, o valor previsto É o valor da compra, não há o
 * que dividir, e o campo nem aparece. O caminho de 29 em cada 30
 * entregas continua sendo exatamente o de antes do E4 — mesmo número de
 * teclas, mesma cadeia de Enter, mesmo orçamento de 25 segundos.
 */
type LinhaForma = { pagamentoId: string; forma: FormaPagamento; digitos: string }

function linhaNova(): LinhaForma {
  return { pagamentoId: uuidv7(), forma: 'dinheiro', digitos: '' }
}

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
  // Cada linha carrega o PRÓPRIO id, cunhado aqui e reciclado no reset —
  // nunca dentro de `criarEntrega`, senão o reenvio da fila criaria um
  // previsto novo a cada oscilação de rede (E3.C).
  const [formas, setFormas] = useState<LinhaForma[]>(() => [linhaNova()])
  const [convenioId, setConvenioId] = useState('')
  const [temReceita, setTemReceita] = useState(false)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)
  const [gravacao, setGravacao] = useState<Gravacao | null>(null)

  const { data: convenios } = useConveniosCadastro()
  const conveniosAtivos = (convenios ?? []).filter((c) => c.ativo)
  const tarifaCents = useTarifaDaLoja(lojaId)

  const umaFormaSo = formas.length === 1
  const valorCompraCents = centsFromDigits(valorCompra)

  /**
   * As formas previstas, prontas pro payload — E4.
   *
   * **Com uma linha só, o valor É o da compra**, e o campo de valor nem
   * existe na tela: não há divisão a fazer, e pedir ao caixa que
   * redigite o total que ele acabou de digitar seria gastar o orçamento
   * dos 25 segundos em nada.
   *
   * Uma derivação só, usada pela validação, pelo total exibido e pelo
   * payload. Se fossem duas expressões, a tela poderia validar uma coisa
   * e gravar outra.
   */
  const { valoresCents, indiceDerivado } = resolverValoresDasFormas(
    formas.map((linha) => linha.digitos),
    valorCompraCents
  )

  const previstos: FormaPrevistaDoCadastro[] = formas.map((linha, i) => ({
    pagamentoId: linha.pagamentoId,
    forma: linha.forma,
    valorCents: valoresCents[i],
  }))

  const totalPrevistoCents = previstos.reduce((soma, p) => soma + p.valorCents, 0)

  /**
   * O AVISO DA DIVISÃO — e ele diz QUANTO falta, não só que não bate.
   *
   * O texto antigo era `Total: X de Y da compra`, e ele informava que a
   * soma estava errada sem nunca dizer o tamanho do erro. Num valor
   * quebrado é exatamente o número que falta que o caixa precisa, e
   * calculá-lo de cabeça com fila no balcão é o que essa mudança veio
   * tirar do caminho.
   *
   * Nada disto aparece com uma forma só: lá não há divisão, e o bloco
   * inteiro fica fora da tela.
   */
  const faltaCents = valorCompraCents - totalPrevistoCents
  const nenhumaDigitada = formas.every((linha) => linha.digitos === '')
  const avisoDaDivisao: { texto: string; erro: boolean } = nenhumaDigitada
    ? // Estado de partida, logo depois do "+ outra forma": nada foi
      // decidido ainda, então cobrar a soma seria acusar o caixa de um
      // erro que ele não cometeu. O aviso ENSINA a regra no exato
      // momento em que ela passa a valer.
      { texto: 'Informe o valor de uma das formas — a outra recebe o restante.', erro: false }
    : {
        texto:
          `Total: ${formatBRL(totalPrevistoCents)} de ${formatBRL(valorCompraCents)} da compra` +
          (faltaCents > 0
            ? ` — faltam ${formatBRL(faltaCents)}`
            : faltaCents < 0
              ? ` — ${formatBRL(-faltaCents)} a mais que a compra`
              : indiceDerivado !== null
                ? `. ${FORMA_PAGAMENTO_LABEL[formas[indiceDerivado].forma]} recebe o restante.`
                : ''),
        erro: faltaCents !== 0,
      }

  // BASTA UMA linha ser convênio — E4, e foi decisão do usuário em
  // 2026-08-27. O convênio pode compor o pagamento com outra forma, e a
  // regra do `farmacia_paga_entrega_integral` (caso do Minerva) continua
  // valendo mesmo quando ele cobre só parte da compra: quem banca a
  // entrega é o convênio, e isso não depende de quanto da COMPRA ele
  // pagou.
  //
  // `entregas.convenio_id` é uma coluna só, e é por isso que
  // `validarFormasPrevistas` recusa duas linhas de convênio: seriam dois
  // acordos disputando o mesmo campo.
  const temConvenio = formas.some((linha) => linha.forma === 'convenio')
  const convenioIntegral =
    temConvenio && !!conveniosAtivos.find((c) => c.id === convenioId)?.farmaciaPagaEntregaIntegral

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

  function addForma() {
    setFormas((prev) => {
      if (prev.length >= MAX_FORMAS_PREVISTAS) return prev
      // AS DUAS LINHAS FICAM VAZIAS, e isso é o inverso do que se fazia
      // aqui antes. A primeira herdava o valor cheio da compra pra o
      // caixa TIRAR dela o que a segunda cobrisse — o que custava apagar
      // um campo já preenchido antes de digitar (a máscara continua da
      // direita, então digitar por cima de "137,43" empurra o número em
      // vez de trocá-lo).
      //
      // Com a derivação, ele digita numa linha vazia e a outra se
      // resolve: menos teclas, e nenhuma subtração de cabeça.
      return [...prev, linhaNova()]
    })
  }

  function removeForma(index: number) {
    setFormas((prev) => {
      if (prev.length <= 1) return prev
      const restantes = prev.filter((_, i) => i !== index)
      // VOLTANDO A UMA LINHA, ela precisa voltar a ser vazia — e este é
      // o único ponto onde o invariante poderia se perder.
      //
      // Com uma forma só o campo de valor não é renderizado, então um
      // resto de dígitos ali seria um valor que o caixa não vê e não
      // consegue corrigir: a soma passaria a não bater e o erro
      // apareceria no submit apontando pra um campo invisível.
      //
      // Limpar aqui é o que sustenta "linha única ⇒ vale a compra
      // inteira" (o caminho de 29 em cada 30 entregas) sem precisar de
      // um segundo caso especial na derivação — que é onde ele viraria
      // uma regra duplicada, capaz de discordar da que grava.
      return restantes.length === 1 ? [{ ...restantes[0], digitos: '' }] : restantes
    })
  }

  function updateForma(index: number, patch: Partial<LinhaForma>) {
    setFormas((prev) => prev.map((linha, i) => (i === index ? { ...linha, ...patch } : linha)))
  }

  function resetForm() {
    setId(uuidv7())
    setNome('')
    setEndereco('')
    setValorCompra('')
    setQuantidadeVales(1)
    // Linha nova, id novo. Reaproveitar o id faria o segundo vale do dia
    // colidir na PK com o primeiro.
    setFormas([linhaNova()])
    setConvenioId('')
    setTemReceita(false)
    nomeRef.current?.focus()
  }

  function handleSalvar() {
    const nomeTrim = normalizarNome(nome)
    const enderecoTrim = normalizarEndereco(endereco)

    if (!nomeTrim || !enderecoTrim || valorCompraCents <= 0) {
      setErroValidacao('Preenche nome, endereço e valor da compra antes de salvar.')
      return
    }
    if (temConvenio && !convenioId) {
      setErroValidacao('Escolhe o convênio.')
      return
    }
    // A VALIDAÇÃO DAS FORMAS ACONTECE AQUI, ANTES DE ENFILEIRAR — nunca
    // em `criarEntrega`. Revalidar na sincronização poderia recusar uma
    // operação já aceita no balcão, e o item iria pra `erro` e pro
    // backoff pra sempre (§50.4).
    //
    // Com uma forma só ela é sempre satisfeita por construção (o valor É
    // o da compra), então o caminho rápido nunca esbarra nela.
    const erroFormas = validarFormasPrevistas(
      previstos.map((p) => ({ forma: p.forma, valor_cents: p.valorCents })),
      valorCompraCents
    )
    if (erroFormas) {
      setErroValidacao(erroFormas)
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
      formasPrevistas: previstos,
      tenantId: profile.tenantId,
      lojaId,
      criadoPor: profile.id,
      clienteNome: nomeTrim,
      clienteEndereco: enderecoTrim,
      valorCompraCents,
      valorEntregaCents,
      quantidadeVales,
      entregaPagaClienteCents,
      ocorridoEmLocal: new Date().toISOString(),
      convenioId: temConvenio ? convenioId : null,
      temReceita,
    }

    // grava na fila local primeiro (sempre funciona, mesmo sem rede) e já
    // libera a tela pro próximo cliente — sincroniza em segundo plano. O
    // número do vale só existe depois de sincronizar (é o banco que gera),
    // por isso não aparece aqui; confere na lista "Hoje" depois.
    // A cláusula de sincronização NÃO entra no texto: quem a escreve é o
    // `StatusDeGravacao`, olhando a fila de verdade. Aqui só se afirma o
    // fato que já aconteceu — a gravação local.
    setGravacao(
      gravacaoEnfileirada(
        `Entrega de ${payload.clienteNome} salva`,
        enfileirarOperacao('entrega', donoDaFila(profile), payload, { chave: payload.id })
      )
    )

    resetForm()
  }

  // Forma "convênio" precisa dizer qual — Enter aqui vai pro select de
  // convênio em vez de salvar direto. Qualquer outra forma salva na hora,
  // igual sempre foi (o checkbox de receita fica fora dessa cadeia de
  // propósito, ver campo abaixo).
  // Aceita os dois elementos porque, com pagamento dividido, ele também
  // fica no campo de VALOR de cada linha — Enter ali salva, em vez de não
  // fazer nada, que é o que o caixa espera de um formulário deste app.
  function handleFormaKeyDown(e: KeyboardEvent<HTMLSelectElement | HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (temConvenio) {
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
              <div className="flex items-center justify-between">
                <Label htmlFor="forma-pagamento">
                  {umaFormaSo ? 'Forma de pagamento' : 'Formas de pagamento'}
                </Label>
                {/* O GATILHO DA SEGUNDA FORMA FICA FORA DA CADEIA DE
                    ENTER, e é isso que protege os 25 segundos.

                    Com uma forma, a tela é a de sempre: Enter no select
                    salva. Quem divide o pagamento — 1 ou 2 em cada 30 —
                    clica aqui, e o custo cai só sobre esse caso. Pôr
                    "dividir" como opção do próprio select cobraria uma
                    linha a mais do dropdown em TODA entrega, e ainda
                    misturaria "como pagou" com "em quantas formas". */}
                {formas.length < MAX_FORMAS_PREVISTAS && (
                  <Button type="button" variant="ghost" size="sm" onClick={addForma}>
                    + outra forma
                  </Button>
                )}
              </div>

              {formas.map((linha, index) => (
                <div key={linha.pagamentoId} className="flex items-center gap-2">
                  <select
                    // O id/ref só na PRIMEIRA linha: é ela que está na
                    // cadeia de Enter que vem do campo de vales.
                    id={index === 0 ? 'forma-pagamento' : undefined}
                    ref={index === 0 ? formaRef : undefined}
                    className={SELECT_CLASSNAME}
                    value={linha.forma}
                    onChange={(e) =>
                      updateForma(index, { forma: e.target.value as FormaPagamento })
                    }
                    onKeyDown={handleFormaKeyDown}
                  >
                    {FORMA_PAGAMENTO_OPTIONS.map(([valor, label]) => (
                      <option key={valor} value={valor}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {/* O campo de valor só existe quando há o que dividir.
                      Com uma forma, o valor previsto É o da compra —
                      pedir pra redigitar o total seria gastar o
                      orçamento dos 25s sem informação nova. */}
                  {!umaFormaSo && (
                    <>
                      <CampoMoeda
                        className="w-28"
                        // A LINHA DERIVADA EXIBE O QUE VAI SER GRAVADO —
                        // `valoresCents` é a mesma derivação que monta
                        // `previstos` e o total. Reformatar aqui a
                        // partir de outra expressão deixaria a tela
                        // capaz de mostrar um número e gravar outro.
                        digitos={
                          index === indiceDerivado
                            ? digitosDoValor(valoresCents[index])
                            : linha.digitos
                        }
                        onDigitos={(digitos) => updateForma(index, { digitos })}
                        onKeyDown={handleFormaKeyDown}
                        selecionaAoFocar={index === indiceDerivado}
                        aria-label={`Valor em ${FORMA_PAGAMENTO_LABEL[linha.forma]}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remover forma"
                        onClick={() => removeForma(index)}
                      >
                        <X />
                      </Button>
                    </>
                  )}
                </div>
              ))}

              {!umaFormaSo && (
                <p
                  className={
                    avisoDaDivisao.erro ? 'text-xs text-destructive' : 'text-xs text-foreground/70'
                  }
                >
                  {avisoDaDivisao.texto}
                </p>
              )}
            </div>

            {temConvenio && (
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

            <StatusDeGravacao gravacao={gravacao} onLimpar={() => setGravacao(null)} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
