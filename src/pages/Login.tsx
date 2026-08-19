import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { signInWithPassword } from '@/data/auth'
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

export function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')

  const mutation = useMutation({
    mutationFn: () => signInWithPassword(email, senha),
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
          <CardDescription>Entre com seu e-mail e senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoFocus
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
            {mutation.isError && (
              <p className="text-sm text-destructive">E-mail ou senha inválidos.</p>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
