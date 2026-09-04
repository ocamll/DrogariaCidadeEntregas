import type { KeyboardEvent, Ref } from 'react'
import { apenasDigitos, centsFromDigits, formatCentsInput } from '@/lib/money'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Campo de dinheiro com máscara de centavos. O estado do pai é a string
// de dígitos crua ('' quando vazio, '12345' pra R$ 123,45) — não o texto
// formatado — pra não existir "fonte de verdade" duplicada nem precisar
// desformatar na hora de salvar. Converte com `centsFromDigits(digitos)`.
//
// Campo vazio mostra vazio, não "0,00": o caixa precisa distinguir "ainda
// não preenchi" de "é de graça" (transferência tem valor 0 legítimo).
export function CampoMoeda({
  id,
  digitos,
  onDigitos,
  onKeyDown,
  ref,
  className,
  autoFocus,
  selecionaAoFocar,
  'aria-label': ariaLabel,
}: {
  id?: string
  digitos: string
  onDigitos: (digitos: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  ref?: Ref<HTMLInputElement>
  className?: string
  autoFocus?: boolean
  // Para o campo cujo valor a TELA calculou (a linha que absorve o resto
  // da divisão de pagamento). Sem isso a máscara continuaria a partir do
  // que já está lá — clicar num campo que mostra "37,43" e digitar "5"
  // daria "374,35", que é o oposto de sobrescrever. Digitar num valor
  // que o caixa não escolheu é sempre intenção de trocá-lo.
  selecionaAoFocar?: boolean
  'aria-label'?: string
}) {
  const texto = digitos ? formatCentsInput(centsFromDigits(digitos)) : ''

  return (
    <div className="relative flex items-center">
      <span className="pointer-events-none absolute left-2.5 text-sm text-muted-foreground">R$</span>
      <Input
        id={id}
        ref={ref}
        // `inputMode="numeric"` (não "decimal"): no tablet abre o teclado
        // sem vírgula/ponto, que aqui não têm uso nenhum.
        inputMode="numeric"
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onFocus={selecionaAoFocar ? (e) => e.target.select() : undefined}
        // alinhado à esquerda, logo depois do "R$" — o número cresce no
        // sentido da leitura, e o cursor fica onde o caixa está olhando.
        className={cn('pl-9 tabular-nums', className)}
        value={texto}
        // Só os dígitos do que veio importam. Backspace funciona sozinho:
        // apagar um caractere de "1.234,56" deixa "1.234,5", cujos dígitos
        // são "12345" → volta a exibir "123,45". Apagar separador não
        // trava porque separador não conta como dígito.
        onChange={(e) => onDigitos(apenasDigitos(e.target.value))}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
