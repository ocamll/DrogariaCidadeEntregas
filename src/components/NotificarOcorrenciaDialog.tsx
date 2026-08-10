import { useState } from 'react'
import { X } from 'lucide-react'
import type { AuthProfile } from '@/data/auth'
import {
  FORMA_PAGAMENTO_LABEL,
  FORMA_PAGAMENTO_OPTIONS,
  type FormaPagamento,
  type MarcarDivergenciaInput,
} from '@/data/pagamentos'
import type { NotificarFaltaReceitaInput } from '@/data/documentos'
import { enfileirarOperacao } from '@/data/filaOffline'
import { uuidv7 } from '@/lib/uuid'
import { centsFromDigits, formatBRL } from '@/lib/money'
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

const FORMA_PADRAO: FormaPagamento = 'dinheiro'
const MAX_LINHAS = 4

type Opcao = 'pagamento' | 'receita'

// `valor` são os dígitos crus da máscara de centavos, igual no cadastro
// de entrega — nunca texto livre com "," ou ".".
type Linha = { forma: FormaPagamento; valor: string }

function linhaInicial(valorCents: number): Linha {
  return { forma: FORMA_PADRAO, valor: String(valorCents) }
}

export function NotificarOcorrenciaDialog({
  entregaId,
  tipo,
  formaEsperadaAtual,
  valorCents,
  temReceita,
  profile,
  open,
  onOpenChange,
}: {
  entregaId: string
  tipo: 'cliente' | 'transferencia'
  formaEsperadaAtual: FormaPagamento | null
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
            formaEsperadaAtual={formaEsperadaAtual}
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
  formaEsperadaAtual,
  valorCents,
  profile,
  onConcluido,
}: {
  entregaId: string
  formaEsperadaAtual: FormaPagamento | null
  valorCents: number
  profile: AuthProfile
  onConcluido: () => void
}) {
  const [formaEsperada, setFormaEsperada] = useState<FormaPagamento>(formaEsperadaAtual ?? FORMA_PADRAO)
  const [linhas, setLinhas] = useState<Linha[]>([linhaInicial(valorCents)])
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

  const totalRealizadoCents = linhas.reduce((soma, linha) => soma + centsFromDigits(linha.valor), 0)
  const totalBate = totalRealizadoCents === valorCents

  function handleConfirmar() {
    if (linhas.some((linha) => centsFromDigits(linha.valor) <= 0)) {
      setErro('Toda linha precisa de um valor maior que zero.')
      return
    }
    if (!totalBate) {
      setErro(
        `A soma (${formatBRL(totalRealizadoCents)}) não bate com o valor da compra (${formatBRL(valorCents)}).`
      )
      return
    }
    const ehDivergente = linhas.length > 1 || linhas[0].forma !== formaEsperada
    if (!ehDivergente) {
      setErro('Isso bate com o que já era esperado — não é divergência.')
      return
    }
    if (!justificativa.trim()) {
      setErro('Justificativa é obrigatória.')
      return
    }

    const operacaoId = uuidv7()
    const payload: MarcarDivergenciaInput = {
      tenantId: profile.tenantId,
      entregaId,
      formaAnterior: formaEsperada,
      pagamentosRealizados: linhas.map((linha) => ({
        id: uuidv7(),
        forma: linha.forma,
        valorCents: centsFromDigits(linha.valor),
      })),
      valorCentsPrevisto: valorCents,
      justificativa: justificativa.trim(),
      registradoPor: profile.id,
      autorNome: profile.nome,
      criarPrevisto: formaEsperadaAtual === null,
      eventoIdempotencyKey: uuidv7(),
      registradoEmLocal: new Date().toISOString(),
    }

    // grava local e fecha o dialog na hora (mesmo padrão do cadastro de
    // entrega) — sincroniza em segundo plano.
    void enfileirarOperacao('divergencia', operacaoId, payload)
    onConcluido()
  }

  return (
    <>
      <DialogDescription>
        {formaEsperadaAtual
          ? `Era: ${FORMA_PAGAMENTO_LABEL[formaEsperadaAtual]}. Registra como foi pago de verdade — pode ser em mais de uma forma.`
          : 'Essa entrega não tem forma de pagamento registrada ainda — informa a esperada e como foi pago de verdade.'}
      </DialogDescription>

      {formaEsperadaAtual === null && (
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
              digitos={linha.valor}
              onDigitos={(valor) => updateLinha(index, { valor })}
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

        <p className={totalBate ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
          Total: {formatBRL(totalRealizadoCents)} de {formatBRL(valorCents)} esperado
          {!totalBate && ' — não bate'}
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

    const operacaoId = uuidv7()
    const payload: NotificarFaltaReceitaInput = {
      tenantId: profile.tenantId,
      entregaId,
      justificativa: justificativa.trim(),
      registradoPor: profile.id,
      autorNome: profile.nome,
      eventoIdempotencyKey: uuidv7(),
      ocorridoEmLocal: new Date().toISOString(),
    }

    void enfileirarOperacao('falta_receita', operacaoId, payload)
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
