import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import {
  useUsuarios,
  useCriarUsuario,
  useEditarUsuario,
  useAlternarAtivoUsuario,
  PAPEL_USUARIO_LABEL,
  PAPEL_USUARIO_OPTIONS,
  type Usuario,
  type PapelUsuario,
} from '@/data/usuarios'
import { useLojas } from '@/data/lojas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30'

export function UsuariosCadastro({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useUsuarios()
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [dialogAberto, setDialogAberto] = useState(false)
  const alternarAtivo = useAlternarAtivoUsuario()
  const [erroToggle, setErroToggle] = useState<string | null>(null)

  function abrirNovo() {
    setEditando(null)
    setDialogAberto(true)
  }

  function abrirEditar(usuario: Usuario) {
    setEditando(usuario)
    setDialogAberto(true)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Trocar senha de alguém não é feito por aqui — isso é direto no Supabase.
        </p>
        <Button onClick={abrirNovo}>Novo usuário</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
      {erroToggle && <p className="text-sm text-destructive">{erroToggle}</p>}

      {!isLoading && !isError && data && data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Filial</TableHead>
              <TableHead>Acesso</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((usuario) => {
              const euMesmo = usuario.id === profile.id
              return (
                <TableRow key={usuario.id}>
                  <TableCell>
                    {usuario.nome}
                    {euMesmo && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}
                  </TableCell>
                  <TableCell>{usuario.email ?? '—'}</TableCell>
                  <TableCell>{PAPEL_USUARIO_LABEL[usuario.papel] ?? usuario.papel}</TableCell>
                  <TableCell>{usuario.lojaNome ?? '—'}</TableCell>
                  <TableCell>
                    {/* Bloquear a própria conta te deixa de fora do sistema
                        na hora, e só outro admin conseguiria devolver o
                        acesso — por isso o toggle não vale pra si mesmo. */}
                    <button
                      type="button"
                      disabled={euMesmo}
                      onClick={() => {
                        setErroToggle(null)
                        alternarAtivo.mutate(
                          { id: usuario.id, ativo: !usuario.ativo },
                          { onError: (e) => setErroToggle(e.message) }
                        )
                      }}
                      title={
                        euMesmo
                          ? 'Você não pode bloquear a própria conta'
                          : usuario.ativo
                            ? 'Clica pra bloquear o acesso'
                            : 'Clica pra liberar o acesso'
                      }
                      className={euMesmo ? 'cursor-not-allowed opacity-60' : undefined}
                    >
                      <Badge variant={usuario.ativo ? 'secondary' : 'destructive'}>
                        {usuario.ativo ? 'Ativo' : 'Bloqueado'}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => abrirEditar(usuario)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <UsuarioFormDialog
        key={editando?.id ?? 'novo'}
        usuario={editando}
        open={dialogAberto}
        onOpenChange={setDialogAberto}
      />
    </div>
  )
}

function UsuarioFormDialog({
  usuario,
  open,
  onOpenChange,
}: {
  usuario: Usuario | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const editando = usuario !== null

  const [nome, setNome] = useState(usuario?.nome ?? '')
  const [email, setEmail] = useState(usuario?.email ?? '')
  const [senha, setSenha] = useState('')
  const [papel, setPapel] = useState<PapelUsuario>(usuario?.papel ?? 'caixa')
  const [lojaId, setLojaId] = useState(usuario?.lojaId ?? '')
  const [erro, setErro] = useState<string | null>(null)

  const { data: lojas } = useLojas()
  const criar = useCriarUsuario()
  const editar = useEditarUsuario()
  const salvando = criar.isPending || editar.isPending

  function handleSalvar() {
    const nomeTrim = nome.trim()
    if (!nomeTrim) {
      setErro('Nome é obrigatório.')
      return
    }
    // Caixa sem loja não consegue nem lançar entrega (a tela exige
    // profile.lojaId), então barra aqui em vez de deixar descobrir depois.
    if (papel === 'caixa' && !lojaId) {
      setErro('Caixa precisa de uma filial — sem ela não consegue lançar entrega.')
      return
    }
    setErro(null)

    if (editando) {
      editar.mutate(
        { id: usuario.id, nome: nomeTrim, papel, lojaId: lojaId || null },
        { onSuccess: () => onOpenChange(false), onError: (e) => setErro(e.message) }
      )
      return
    }

    const emailTrim = email.trim()
    if (!emailTrim.includes('@')) {
      setErro('E-mail inválido.')
      return
    }
    if (senha.length < 6) {
      setErro('Senha precisa de pelo menos 6 caracteres.')
      return
    }

    criar.mutate(
      { email: emailTrim, senha, nome: nomeTrim, papel, lojaId: lojaId || null },
      { onSuccess: () => onOpenChange(false), onError: (e) => setErro(e.message) }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
          <DialogDescription>
            {editando
              ? 'E-mail e senha não mudam por aqui — isso é feito direto no Supabase.'
              : 'O e-mail é só pra entrar no sistema; pode ser curto e interno, não precisa existir de verdade.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="usuario-nome">Nome</Label>
            <Input
              id="usuario-nome"
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>

          {!editando && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="usuario-email">E-mail</Label>
                <Input
                  id="usuario-email"
                  type="email"
                  autoComplete="off"
                  placeholder="caixa2@drogariacidade.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="usuario-senha">Senha inicial</Label>
                <Input
                  id="usuario-senha"
                  type="password"
                  autoComplete="new-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </div>
            </>
          )}

          {editando && (
            <div className="flex flex-col gap-2">
              <Label>E-mail</Label>
              <p className="text-sm text-muted-foreground">{usuario.email ?? '—'}</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="usuario-papel">Papel</Label>
            <select
              id="usuario-papel"
              className={SELECT_CLASSNAME}
              value={papel}
              onChange={(e) => setPapel(e.target.value as PapelUsuario)}
            >
              {PAPEL_USUARIO_OPTIONS.map(([valor, label]) => (
                <option key={valor} value={valor}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="usuario-loja">Filial</Label>
            <select
              id="usuario-loja"
              className={SELECT_CLASSNAME}
              value={lojaId}
              onChange={(e) => setLojaId(e.target.value)}
            >
              <option value="">Sem filial</option>
              {lojas?.map((loja) => (
                <option key={loja.id} value={loja.id}>
                  {loja.nome}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Admin e gerente enxergam todas as filiais; caixa fica preso à que estiver aqui.
            </p>
          </div>

          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
