import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { signInComUsuario } from '@/data/auth'
import { FalhaDeLoginError } from '@/lib/falhaDeLogin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LOGO_URL } from '@/lib/marca'
import { EmAndamento } from '@/components/EmAndamento'

export function Login() {
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')

  const mutation = useMutation({
    mutationFn: () => signInComUsuario(usuario, senha),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate()
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-primary p-4">
      <img src={LOGO_URL} alt="Drogaria Cidade" className="h-16 w-auto" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Tele-entrega</CardTitle>
          <CardDescription>Entre com seu usuário e senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="usuario">Usuário</Label>
              <Input
                id="usuario"
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
                autoComplete="username"
                value={usuario}
                onChange={(event) => setUsuario(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                required
                autoComplete="current-password"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
              />
            </div>
            {/* A MENSAGEM SAI DA CLASSIFICAÇÃO, não de `isError` — E5.
                Antes qualquer erro virava "senha inválida", inclusive não
                ter rede: o app afirmava que a senha estava errada sem ter
                tido a quem perguntar, e mandava a pessoa trocar uma senha
                que estava certa. É o defeito do E2 na décima tela, a que
                ele não cobriu por ser escrita e não consulta. */}
            {mutation.isError && (
              <p
                className={
                  mutation.error instanceof FalhaDeLoginError &&
                  mutation.error.falha === 'indisponivel'
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm text-destructive'
                }
              >
                {mutation.error instanceof FalhaDeLoginError
                  ? mutation.error.message
                  : 'Usuário ou senha inválidos.'}
              </p>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <EmAndamento>Entrando</EmAndamento> : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
