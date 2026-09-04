import { useState } from 'react'
import { X } from 'lucide-react'
import type { AuthProfile } from '@/data/auth'
import {
  FORMA_PAGAMENTO_LABEL,
  FORMA_PAGAMENTO_OPTIONS,
  textoDoPagamentoAlterado,
  divergiuDoPrevisto,
  resolverValoresDasFormas,
  digitosDoValor,
  type FormaPagamento,
  type FormaComValor,
  type MarcarDivergenciaInput,
} from '@/data/pagamentos'
import type { NotificarFaltaReceitaInput } from '@/data/documentos'
import { enfileirarOperacao, donoDaFila } from '@/data/filaOffline'
import { uuidv7 } from '@/lib/uuid'
import { formatBRL } from '@/lib/money'
import { CampoMoeda } from '@/components/CampoMoeda'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { normalizarParagrafo } from '@/lib/texto'

const FORMA_PADRAO: FormaPagamento = 'dinheiro'
const MAX_LINHAS = 4

type Opcao = 'pagamento' | 'receita'

// `valor` são os dígitos crus da máscara de centavos, igual no cadastro
// de entrega — nunca texto livre com "," ou ".".
type Linha = { forma: FormaPagamento; valor: string }

// NASCE VAZIA, e continua exibindo o valor cheio — quem o põe lá é a
// derivação (`resolverValoresDasFormas`): com uma linha só, ela é a
// única vazia e absorve o esperado inteiro.
//
// Preencher `valor` aqui daria a MESMA tela e quebraria a divisão: ao
// clicar "+ Adicionar forma", a linha 1 contaria como digitada, sobraria
// resto zero, e o caixa teria que apagar um campo cheio antes de digitar
// — que é exatamente o atrito que a derivação veio tirar.
function linhaInicial(): Linha {
  return { forma: FORMA_PADRAO, valor: '' }
}

export function NotificarOcorrenciaDialog({
  entregaId,
  tipo,
  previstos,
  valorCents,
  temReceita,
  profile,
  open,
  onOpenChange,
}: {
  entregaId: string
  tipo: 'cliente' | 'transferencia'
  previstos: FormaComValor[]
  valorCents: number
  temReceita: boolean
  profile: AuthProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mostrarPagamento = tipo !== 'transferencia'
  const mostrarReceita = temReceita
  const [opcao, setOpcao] = useState<Opcao>(mostrarPagamento ? 'pagamento' : 'receita')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notificar ocorrência</DialogTitle>
          {mostrarPagamento && mostrarReceita && (
            <DialogDescription>Escolhe o que aconteceu com esse vale.</DialogDescription>
          )}
        </DialogHeader>

        {mostrarPagamento && mostrarReceita && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant={opcao === 'pagamento' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setOpcao('pagamento')}
            >
              Divergência de pagamento
            </Button>
            <Button
              type="button"
              variant={opcao === 'receita' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => setOpcao('receita')}
            >
              Falta de receita
            </Button>
          </div>
        )}

        {opcao === 'pagamento' && mostrarPagamento && (
          <DivergenciaPagamentoForm
            entregaId={entregaId}
            previstos={previstos}
            valorCents={valorCents}
            profile={profile}
            onConcluido={() => onOpenChange(false)}
          />
        )}
        {opcao === 'receita' && mostrarReceita && (
          <FaltaReceitaForm entregaId={entregaId} profile={profile} onConcluido={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DivergenciaPagamentoForm({
  entregaId,
  previstos,
  valorCents,
  profile,
  onConcluido,
}: {
  entregaId: string
  previstos: FormaComValor[]
  valorCents: number
  profile: AuthProfile
  onConcluido: () => void
}) {
  // Só serve pro vale LEGADO, que nunca teve previsto gravado — aí o
  // caixa informa qual era a forma esperada. Um vale nascido depois do
  // E4 tem os previstos dele, e este select nem aparece.
  //
  // Continua sendo UM select, e não uma lista: o retroativo descreve um
  // vale de antes de o modelo aceitar N. Oferecer N aqui seria pedir ao
  // caixa que reconstruísse, de memória, uma divisão que aquele vale
  // nunca teve como registrar.
  const [formaEsperada, setFormaEsperada] = useState<FormaPagamento>(
    previstos[0]?.forma ?? FORMA_PADRAO
  )
  const [linhas, setLinhas] = useState<Linha[]>([linhaInicial()])
  const [justificativa, setJustificativa] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function addLinha() {
    setLinhas((prev) => (prev.length >= MAX_LINHAS ? prev : [...prev, { forma: FORMA_PADRAO, valor: '' }]))
  }

  function removeLinha(index: number) {
    setLinhas((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function updateLinha(index: number, patch: Partial<Linha>) {
    setLinhas((prev) => prev.map((linha, i) => (i === index ? { ...linha, ...patch } : linha)))
  }

  // A LINHA QUE O CAIXA NÃO DIGITOU ABSORVE O RESTO — a mesma regra do
  // cadastro de entrega, e aqui ela pesa mais: são até QUATRO linhas
  // para dividir, e este dialog registra um fato já consumado (o cliente
  // pagou metade em pix, metade em dinheiro), quase sempre em valor
  // quebrado.
  const { valoresCents, indiceDerivado } = resolverValoresDasFormas(
    linhas.map((linha) => linha.valor),
    valorCents
  )
  const totalRealizadoCents = valoresCents.reduce((soma, cents) => soma + cents, 0)
  const totalBate = totalRealizadoCents === valorCents

  // Diz QUANTO falta, não só que não bate — ver o comentário gêmeo em
  // `CadastroEntrega`. O vocabulário aqui é "esperado", não "da compra":
  // este dialog compara com o previsto do vale.
  const faltaCents = valorCents - totalRealizadoCents
  const nenhumaDigitada = linhas.every((linha) => linha.valor === '')
  const avisoDaDivisao: { texto: string; erro: boolean } =
    nenhumaDigitada && linhas.length > 1
      ? { texto: 'Informe o valor de uma das formas — a outra recebe o restante.', erro: false }
      : {
          texto:
            `Total: ${formatBRL(totalRealizadoCents)} de ${formatBRL(valorCents)} esperado` +
            (faltaCents > 0
              ? ` — faltam ${formatBRL(faltaCents)}`
              : faltaCents < 0
                ? ` — ${formatBRL(-faltaCents)} a mais que o esperado`
                : indiceDerivado !== null && linhas.length > 1
                  ? `. ${FORMA_PAGAMENTO_LABEL[linhas[indiceDerivado].forma]} recebe o restante.`
                  : ''),
          erro: !totalBate,
        }

  const semPrevisto = previstos.length === 0

  /**
   * O previsto CONTRA O QUAL se compara — e é o MESMO valor que vai ser
   * gravado como `de` do evento.
   *
   * Um só, de propósito. Se a comparação usasse uma coisa e o registro
   * outra, a tela poderia recusar "não é divergência" e ainda assim
   * gravar um evento dizendo que divergiu de outra coisa. O jeito de
   * isso não acontecer é não haver duas expressões.
   *
   * No vale legado (sem previsto nenhum) a base é a forma que o caixa
   * acabou de informar. Sem isso a comparação seria contra lista vazia,
   * que diverge de qualquer realizado — e a guarda "isso bate com o que
   * já era esperado" nunca dispararia justamente onde ela é útil.
   */
  const previstosParaComparar: FormaComValor[] = semPrevisto
    ? [{ forma: formaEsperada, valor_cents: valorCents }]
    : previstos

  function handleConfirmar() {
    // `valoresCents`, nunca `centsFromDigits(linha.valor)`: a linha
    // derivada não tem dígitos, e reler os crus aqui gravaria zero
    // justamente na forma que a tela mostrava preenchida.
    if (valoresCents.some((cents) => cents <= 0)) {
      setErro('Toda linha precisa de um valor maior que zero.')
      return
    }
    if (!totalBate) {
      setErro(
        `A soma (${formatBRL(totalRealizadoCents)}) não bate com o valor da compra (${formatBRL(valorCents)}).`
      )
      return
    }
    // E4 — ERA DECIDIDO POR CONTAGEM, e isso discordava do servidor:
    //
    //     linhas.length > 1 || linhas[0].forma !== formaEsperada
    //
    // Enquanto existia um previsto só, a contagem acertava por acidente.
    // Com dois, um vale previsto `pix + dinheiro` e pago exatamente
    // `pix + dinheiro` seria divergência aqui e fidelidade em
    // `selar_romaneio_retorno_interno`, que compara conjuntos de
    // `forma|valor`. Os dois escritores do mesmo fato afirmando coisas
    // diferentes.
    const realizados: FormaComValor[] = linhas.map((linha, i) => ({
      forma: linha.forma,
      valor_cents: valoresCents[i],
    }))
    if (!divergiuDoPrevisto(previstosParaComparar, realizados)) {
      setErro('Isso bate com o que já era esperado — não é divergência.')
      return
    }
    if (!justificativa.trim()) {
      setErro('Justificativa é obrigatória.')
      return
    }

    const payload: MarcarDivergenciaInput = {
      tenantId: profile.tenantId,
      entregaId,
      // TODOS os previstos — E4. Era `formaAnterior: FormaPagamento`,
      // uma forma só, e ela virava o `de` do evento `pagamento_alterado`.
      //
      // `pagamento_alterado` tem DOIS escritores. O E3.B corrigiu o do
      // servidor (`limit 1` → agrega todos); este é o outro, e ficou
      // escalar. Com dois previstos ele afirmaria que a divergência foi
      // de UMA das formas e descartaria a outra em silêncio, num evento
      // que é append-only e nunca vai ser reescrito.
      // O QUE O BANCO SABE, e só isso. Vale sem previsto manda lista
      // vazia, e o evento grava `de: null` — que é a verdade.
      previstos,
      // O QUE A PESSOA DECLAROU, em campo próprio. Só existe quando não
      // havia previsto; é a mesma lista usada pra decidir se houve
      // divergência, mas ela NÃO se passa por estado persistido.
      referenciaInformada: semPrevisto ? previstosParaComparar : null,
      pagamentosRealizados: realizados.map((r) => ({
        id: uuidv7(),
        forma: r.forma,
        valorCents: r.valor_cents,
      })),
      // `criarPrevisto` e `pagamentoPrevistoId` SAÍRAM no E4.1. Esta tela
      // não escreve mais pagamento previsto — o único escritor é o
      // cadastro (e o replay dele pela fila). Ver `marcarDivergencia`.
      justificativa: normalizarParagrafo(justificativa),
      registradoPor: profile.id,
      autorNome: profile.nome,
      eventoIdempotencyKey: uuidv7(),
      registradoEmLocal: new Date().toISOString(),
    }

    // grava local e fecha o dialog na hora (mesmo padrão do cadastro de
    // entrega) — sincroniza em segundo plano.
    void enfileirarOperacao('divergencia', donoDaFila(profile), payload)
    onConcluido()
  }

  return (
    <>
      <DialogDescription>
        {semPrevisto
          ? 'Essa entrega não tem forma de pagamento registrada ainda — informa a esperada e como foi pago de verdade.'
          : // `textoDoPagamentoAlterado` é o MESMO formatador que o
            // Registro de Auditoria e as Ocorrências usam pro `de` do
            // evento. Aqui ele mostra "Pix (R$ 50,00) + Dinheiro
            // (R$ 73,90)" — o valor por forma importa nesta tela, ao
            // contrário da coluna da lista, porque é contra ele que o
            // caixa confere o que recebeu.
            `Era: ${textoDoPagamentoAlterado(previstos)}. Registra como foi pago de verdade — pode ser em mais de uma forma.`}
      </DialogDescription>

      {semPrevisto && (
        <div className="flex flex-col gap-2">
          <Label>Forma esperada (prevista)</Label>
          <Select value={formaEsperada} onValueChange={(v) => setFormaEsperada(v as FormaPagamento)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMA_PAGAMENTO_OPTIONS.map(([valor, label]) => (
                <SelectItem key={valor} value={valor}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label>Forma(s) realizada(s)</Label>
          {linhas.length < MAX_LINHAS && (
            <Button type="button" variant="ghost" size="sm" onClick={addLinha}>
              + Adicionar forma
            </Button>
          )}
        </div>

        {linhas.map((linha, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select value={linha.forma} onValueChange={(v) => updateLinha(index, { forma: v as FormaPagamento })}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMA_PAGAMENTO_OPTIONS.map(([valor, label]) => (
                  <SelectItem key={valor} value={valor}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <CampoMoeda
              className="w-28"
              // A derivada exibe o que vai ser GRAVADO — `valoresCents` é
              // a mesma expressão que monta `realizados`.
              digitos={
                index === indiceDerivado ? digitosDoValor(valoresCents[index]) : linha.valor
              }
              onDigitos={(valor) => updateLinha(index, { valor })}
              selecionaAoFocar={index === indiceDerivado}
              aria-label={`Valor em ${FORMA_PAGAMENTO_LABEL[linha.forma]}`}
            />
            {linhas.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remover forma"
                onClick={() => removeLinha(index)}
              >
                <X />
              </Button>
            )}
          </div>
        ))}

        <p
          className={
            avisoDaDivisao.erro ? 'text-xs text-destructive' : 'text-xs text-foreground/70'
          }
        >
          {avisoDaDivisao.texto}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="justificativa">Justificativa</Label>
        <Textarea
          id="justificativa"
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder='Ex: "Cliente pagou metade em pix e metade em dinheiro."'
        />
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <DialogFooter>
        <Button onClick={handleConfirmar}>Confirmar</Button>
      </DialogFooter>
    </>
  )
}

function FaltaReceitaForm({
  entregaId,
  profile,
  onConcluido,
}: {
  entregaId: string
  profile: AuthProfile
  onConcluido: () => void
}) {
  const [justificativa, setJustificativa] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function handleConfirmar() {
    if (!justificativa.trim()) {
      setErro('Justificativa é obrigatória.')
      return
    }

    const payload: NotificarFaltaReceitaInput = {
      tenantId: profile.tenantId,
      entregaId,
      justificativa: normalizarParagrafo(justificativa),
      registradoPor: profile.id,
      autorNome: profile.nome,
      eventoIdempotencyKey: uuidv7(),
      ocorridoEmLocal: new Date().toISOString(),
    }

    void enfileirarOperacao('falta_receita', donoDaFila(profile), payload)
    onConcluido()
  }

  return (
    <>
      <DialogDescription>
        Registra que a receita dessa entrega não voltou com o motoboy.
      </DialogDescription>

      <div className="flex flex-col gap-2">
        <Label htmlFor="justificativa-receita">Justificativa</Label>
        <Textarea
          id="justificativa-receita"
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder='Ex: "Motoboy confirmou no retorno que esqueceu de pegar a receita com o cliente."'
        />
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <DialogFooter>
        <Button onClick={handleConfirmar}>Confirmar</Button>
      </DialogFooter>
    </>
  )
}
