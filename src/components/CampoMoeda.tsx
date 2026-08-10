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
}: {
  id?: string
  digitos: string
  onDigitos: (digitos: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  ref?: Ref<HTMLInputElement>
  className?: string
  autoFocus?: boolean
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
        className={cn('pl-9 text-right tabular-nums', className)}
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
