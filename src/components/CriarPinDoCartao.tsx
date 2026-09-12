import { useState } from 'react'
import { definirPin, pinAceitavel, publicIdDoToken } from '@/data/credenciais'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmAndamento } from '@/components/EmAndamento'

// Criar o PIN de um cartão que ainda não tem — usado em DOIS lugares, e
// por isso mora aqui:
//
//   Cadastros › Credenciais   o admin abre a tela e o gerente digita
//   Meu cartão                o próprio gerente, depois de esquecer
//
// Duas cópias deste formulário seriam duas chances de uma delas deixar
// de validar o formato, ou de esquecer que isto é online por construção.
//
// QUEM DIGITA TEM QUE ESTAR COM O CARTÃO NA MÃO: `definir_pin` exige o
// token completo e só funciona enquanto `pin_hash` é nulo. É isso que
// torna "mostrar PIN" impossível de existir — ninguém escolhe pelo
// outro, nem o admin.
export function CriarPinDoCartao({
  titularNome,
  rotuloDoCartao = 'Bipa o cartão',
  onPronto,
}: {
  titularNome: string
  rotuloDoCartao?: string
  onPronto: () => void
}) {
  const [token, setToken] = useState('')
  const [pin, setPin] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function salvar() {
    setErro(null)
    const limpo = token.trim()
    // Recusa LOCAL: nós sabemos que isto não é um cartão nosso, e não
    // precisamos perguntar a ninguém pra dizer isso.
    if (!publicIdDoToken(limpo)) {
      return setErro('Isso não parece um cartão do sistema. Bipa de novo.')
    }
    const problema = pinAceitavel(pin)
    if (problema) return setErro(problema)
    if (pin !== confirmacao) return setErro('Os dois PINs não são iguais.')
    if (!navigator.onLine) return setErro('Criar PIN precisa de internet.')

    setOcupado(true)
    try {
      await definirPin(limpo, pin)
      onPronto()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <strong>{titularNome}</strong> bipa o próprio cartão e escolhe o PIN. Ninguém mais vê o que
        ele escolher, e não há como recuperá-lo depois — esquecendo, o caminho é redefinir e criar
        outro.
      </p>

      <Input
        autoFocus
        placeholder={rotuloDoCartao}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => {
          // O leitor age como teclado e termina com Enter. Sem isto, o
          // Enter dele submeteria com os PINs ainda vazios.
          if (e.key === 'Enter') e.preventDefault()
        }}
      />

      <div className="flex gap-2">
        <Input
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="Crie o PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <Input
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="Confirme"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value.replace(/\D/g, ''))}
        />
        <Button onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? <EmAndamento>Salvando</EmAndamento> : 'Salvar PIN'}
        </Button>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}
    </div>
  )
}
