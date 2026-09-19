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
  indiceDaParcelaEmDinheiro,
  trocoParaAplicavel,
  trocoDoPrevisto,
  type FormaPagamento,
} from '@/data/pagamentos'
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
        Sua conta não tem filial. Fale com o administrador.
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
  // Cada linha carrega o PRÓPRIO id, cunhado aqui e reciclado no reset —
  // nunca dentro de `criarEntrega`, senão o reenvio da fila criaria um
  // previsto novo a cada oscilação de rede (E3.C).
  const [formas, setFormas] = useState<LinhaForma[]>(() => [linhaNova()])
  // "Troco para", em dígitos crus. Vazio = não há troco a preparar. Vale
  // quando há UMA parcela em dinheiro, sozinha ou no misto
  // (`trocoParaAplicavel`); quando deixa de valer, `mudarFormas` o limpa —
  // nada de valor escondido reaparecendo.
  const [trocoPara, setTrocoPara] = useState('')
  const [temReceita, setTemReceita] = useState(false)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)
  const [gravacao, setGravacao] = useState<Gravacao | null>(null)

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

  /**
   * O TROCO A LEVAR, recalculado a cada render a partir da PARCELA EM
   * DINHEIRO e do "troco para" — o caixa não faz a subtração. `null` quando o
   * campo não se aplica (nenhuma forma em dinheiro).
   *
   * No misto a parcela é o valor da linha de dinheiro — digitado ou derivado
   * (`valoresCents` já traz o resto calculado). Decisão de 2026-09-13: pix 40
   * + dinheiro 60 com troco para 100 → troco 40. Com uma forma só, a parcela
   * é a compra.
   */
  const indiceDinheiro = indiceDaParcelaEmDinheiro(formas)
  const trocoAplicavel = trocoParaAplicavel(formas)
  const resultadoTroco =
    indiceDinheiro !== null ? trocoDoPrevisto(valoresCents[indiceDinheiro], trocoPara) : null

  const previstos: FormaPrevistaDoCadastro[] = formas.map((linha, i) => ({
    pagamentoId: linha.pagamentoId,
    forma: linha.forma,
    valorCents: valoresCents[i],
    // O "troco para" NÃO vira valor: o valor continua sendo a parte da
    // compra, e o troco vai para `troco_cents` DA LINHA DE DINHEIRO — nunca
    // para o pix do misto. Sem troco aplicável, 0.
    trocoCents: resultadoTroco?.ok && i === indiceDinheiro ? resultadoTroco.trocoCents : 0,
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

  /**
   * UM VALE, A TARIFA DA FILIAL — passo 1, 2026-09-08.
   *
   * Não há mais multiplicação nem escolha de quantidade: o valor da
   * entrega É a tarifa acordada. `quantidadeVales` e
   * `entregaPagaClienteCents` continuam no payload e na linha `v` do
   * DCR1, com 1 e 0 — o contrato não encurta, só param de variar.
   *
   * O que saiu junto: a escolha de 1/2 vales, o aviso do que o cliente
   * pagava em mãos, e a exceção do convênio que bancava os dois.
   */
  const valorEntregaCents = tarifaCents ?? 0

  const nomeRef = useRef<HTMLInputElement>(null)
  const enderecoRef = useRef<HTMLInputElement>(null)
  const valorCompraRef = useRef<HTMLInputElement>(null)
  const formaRef = useRef<HTMLSelectElement>(null)
  // O "Troco para" entra na cadeia de Enter quando há parcela em dinheiro.
  const trocoParaRef = useRef<HTMLInputElement>(null)

  function advanceOnEnter<T extends HTMLInputElement | HTMLSelectElement>(nextRef: React.RefObject<T | null>) {
    return (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      nextRef.current?.focus()
      if ('select' in nextRef.current!) (nextRef.current as HTMLInputElement).select()
    }
  }

  /**
   * O ÚNICO caminho por onde as formas mudam depois de nascer — e é por isso
   * que ele limpa o "troco para" quando o campo deixa de se aplicar. Com o
   * limpador espalhado em cada handler, o próximo que mexesse nas formas
   * poderia esquecer, e um troco antigo voltaria ao trocar de volta para
   * dinheiro sem o caixa ter digitado.
   */
  function mudarFormas(proxima: (prev: LinhaForma[]) => LinhaForma[]) {
    const novas = proxima(formas)
    setFormas(novas)
    if (!trocoParaAplicavel(novas)) setTrocoPara('')
  }

  function addForma() {
    mudarFormas((prev) => {
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
    mudarFormas((prev) => {
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
    mudarFormas((prev) => prev.map((linha, i) => (i === index ? { ...linha, ...patch } : linha)))
  }

  function resetForm() {
    setId(uuidv7())
    setNome('')
    setEndereco('')
    setValorCompra('')
    // Linha nova, id novo. Reaproveitar o id faria o segundo vale do dia
    // colidir na PK com o primeiro.
    setFormas([linhaNova()])
    setTrocoPara('')
    setTemReceita(false)
    nomeRef.current?.focus()
  }

  function handleSalvar() {
    const nomeTrim = normalizarNome(nome)
    const enderecoTrim = normalizarEndereco(endereco)

    if (!nomeTrim || !enderecoTrim || valorCompraCents <= 0) {
      setErroValidacao('Preencha nome, endereço e valor da compra.')
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
    // Mesma regra, mesmo lugar: antes de enfileirar, nunca na sincronização.
    if (resultadoTroco && !resultadoTroco.ok) {
      setErroValidacao(resultadoTroco.erro)
      return
    }
    // Sem tarifa carregada não dá pra montar o valor da entrega — melhor
    // barrar que gravar entrega com valor zero em silêncio.
    if (tarifaCents === null) {
      setErroValidacao('Não foi possível carregar a tarifa da filial. Recarregue a página.')
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
      // CONSTANTES DESDE O PASSO 1, e mandadas explicitamente de
      // propósito: os três campos continuam no contrato persistido e na
      // linha `v` do DCR1. Omiti-los aqui seria encurtar o canônico pelo
      // lado do cliente, que é exatamente o que a transição proíbe —
      // eliminar campo é alteração coordenada TS↔SQL, feita no corte.
      quantidadeVales: 1,
      entregaPagaClienteCents: 0,
      ocorridoEmLocal: new Date().toISOString(),
      // O convênio deixou de ser identificado: a forma de pagamento
      // "Convênio" fica, e é ela que gera a pendência de papel (ver
      // `GERAM_DOCUMENTO_FISICO` em data/entregas.ts). Qual empresa é
      // vive no Trier.
      convenioId: null,
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

  // Enter na forma SALVA, sempre — o desvio para o select de convênio
  // saiu com a identificação da empresa (passo 1). A cadeia ficou um
  // passo mais curta que a medida em 2026-08-10, não mais longa.
  //
  // Aceita os dois elementos porque, com pagamento dividido, ele também
  // fica no campo de VALOR de cada linha — Enter ali salva, em vez de não
  // fazer nada, que é o que o caixa espera de um formulário deste app.
  //
  // COM PARCELA EM DINHEIRO, Enter vai ao "Troco para" antes de salvar —
  // relato do usuário em 2026-09-13 ("o enter vai da forma de pagamento pro
  // salvar direto, pulando o Troco para"). O campo tinha nascido FORA da
  // cadeia pra custar zero tecla; o custo agora é um Enter a mais em vale com
  // dinheiro (vazio + Enter salva). Sem dinheiro, nada muda: Enter salva.
  function handleFormaKeyDown(e: KeyboardEvent<HTMLSelectElement | HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (trocoAplicavel) {
      trocoParaRef.current?.focus()
      return
    }
    handleSalvar()
  }

  // No "Troco para", Enter salva — vazio (sem troco) ou preenchido.
  function handleTrocoKeyDown(e: KeyboardEvent<HTMLInputElement>) {
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
                onKeyDown={advanceOnEnter(formaRef)}
              />
            </div>
            {/* A tarifa não aparece na tela (pedido do usuário em
                2026-09-18, por visual mais limpo). Ela continua sendo
                anexada ao vale, e falha de carregamento vira erro no
                salvar — ver `tarifaCents === null` em handleSalvar. */}
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

            {/* "TROCO PARA" ESTÁ NA CADEIA DE ENTER desde 2026-09-13: Enter na
                forma chega aqui quando há parcela em dinheiro, e Enter aqui
                salva, vazio ou preenchido. Ver `handleFormaKeyDown`. */}
            {trocoAplicavel && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="troco-para">Troco para (R$)</Label>
                <CampoMoeda
                  id="troco-para"
                  ref={trocoParaRef}
                  digitos={trocoPara}
                  onDigitos={setTrocoPara}
                  onKeyDown={handleTrocoKeyDown}
                  // Chegando pelo Enter com um valor já digitado, digitar de
                  // novo troca o valor em vez de somar dígitos.
                  selecionaAoFocar
                />
                {/* No misto a tela diz SOBRE O QUÊ o troco é calculado: sem
                    isso, "troco para 100" numa compra de 100 parece troco
                    zero, e é troco de 40. */}
                {!umaFormaSo && indiceDinheiro !== null && (
                  <p className="text-xs text-foreground/70">
                    Sobre a parcela em dinheiro: {formatBRL(valoresCents[indiceDinheiro])}.
                  </p>
                )}
                {trocoPara !== '' &&
                  resultadoTroco &&
                  (resultadoTroco.ok ? (
                    <p className="text-sm">
                      Troco a levar: <strong>{formatBRL(resultadoTroco.trocoCents)}</strong>
                    </p>
                  ) : (
                    <p className="text-xs text-destructive">{resultadoTroco.erro}</p>
                  ))}
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
