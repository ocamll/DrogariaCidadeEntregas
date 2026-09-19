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
import { validarUsername, normalizarUsername, usernameDoEmail } from '@/lib/username'
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
import { EmAndamento } from '@/components/EmAndamento'
import { Consulta } from '@/components/Consulta'
import { derivarEstado } from '@/lib/estadoDeConsulta'
import { normalizarNome } from '@/lib/texto'

const SELECT_CLASSNAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring md:text-sm dark:bg-input/30'

// Estava no grupo "mudo", e era o mais silencioso de todos: nem sequer
// tinha frase de vazio — sem resposta, a tabela simplesmente não
// aparecia. Numa tela onde o admin gerencia quem tem acesso ao sistema,
// "não há usuários" e "não consegui perguntar" precisam se distinguir.
export function UsuariosCadastro({ profile }: { profile: AuthProfile }) {
  const consulta = useUsuarios()
  const estado = derivarEstado(consulta)
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
          A troca de senha é feita pelo suporte do sistema.
        </p>
        <Button onClick={abrirNovo}>Novo usuário</Button>
      </div>

      {erroToggle && <p className="text-sm text-destructive">{erroToggle}</p>}

      <Consulta
        estado={estado}
        vazio={<p className="text-sm text-muted-foreground">Nenhum usuário cadastrado ainda.</p>}
        aoRecarregar={() => void consulta.refetch()}
      >
        {(usuarios) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Filial</TableHead>
              <TableHead>Acesso</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {usuarios.map((usuario) => {
              const euMesmo = usuario.id === profile.id
              return (
                <TableRow key={usuario.id}>
                  <TableCell>
                    {usuario.nome}
                    {euMesmo && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}
                  </TableCell>
                  <TableCell>{usernameDoEmail(usuario.email)}</TableCell>
                  <TableCell>{PAPEL_USUARIO_LABEL[usuario.papel] ?? usuario.papel}</TableCell>
                  {/* Decide o CARGO, não `lojaId`: um admin antigo ainda
                      pode ter Matriz no perfil, e o alcance dele continua
                      sendo a rede inteira. */}
                  <TableCell>
                    {usuario.papel === 'admin' ? 'Todas as filiais' : (usuario.lojaNome ?? '—')}
                  </TableCell>
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
      </Consulta>

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
  const [username, setUsername] = useState('')
  const [senha, setSenha] = useState('')
  const [papel, setPapel] = useState<PapelUsuario>(usuario?.papel ?? 'caixa')
  // A filial de um admin antigo NÃO entra no estado. Escondida no
  // formulário, ela iria junto no salvar; e reapareceria preenchida ao
  // trocar o cargo para caixa, sem ninguém tê-la escolhido.
  const [lojaId, setLojaId] = useState(
    usuario && usuario.papel !== 'admin' ? (usuario.lojaId ?? '') : ''
  )
  const [erro, setErro] = useState<string | null>(null)

  const { data: lojas } = useLojas()
  const criar = useCriarUsuario()
  const editar = useEditarUsuario()
  const salvando = criar.isPending || editar.isPending

  const exigeFilial = papel === 'caixa' || papel === 'gerente'

  function trocarPapel(novo: PapelUsuario) {
    setPapel(novo)
    // Limpa, e não guarda para depois: voltar para caixa ou gerente tem
    // que ser uma escolha nova, feita olhando para o campo.
    if (novo === 'admin') setLojaId('')
  }

  function handleSalvar() {
    const nomeTrim = normalizarNome(nome)
    if (!nomeTrim) {
      setErro('Nome é obrigatório.')
      return
    }
    // SEM FILIAL, CAIXA E GERENTE NÃO ENXERGAM NADA.
    //
    // O caixa nem consegue lançar entrega (a tela exige `profile.lojaId`).
    // O gerente é pior, porque falha em silêncio: desde 2026-08-12 ele é
    // escopado por filial igual ao caixa, e a policy compara
    // `loja_id = current_loja_id()` — com loja nula isso nunca casa, e
    // ele abre o sistema e vê zero vale, sem erro nenhum.
    //
    // O gerente entrou aqui junto com a correção do texto de ajuda logo
    // abaixo, que dizia o CONTRÁRIO ("admin e gerente enxergam todas as
    // filiais") e por isso induzia exatamente essa configuração.
    //
    // Desde o passo 2 (2026-09-11) o BANCO também recusa, com o CHECK
    // `profiles_filial_obrigatoria`. Validar aqui é só pra o admin ver o
    // problema antes do round-trip.
    if (exigeFilial && !lojaId) {
      setErro(
        papel === 'caixa'
          ? 'Caixa precisa de uma filial.'
          : 'Gerente precisa de uma filial.'
      )
      return
    }
    setErro(null)

    // Admin sai com filial NULA, inclusive na edição de um admin antigo
    // que tinha Matriz: salvar pelo formulário aplica a regra de hoje.
    const lojaDoCadastro = exigeFilial ? lojaId : null

    if (editando) {
      editar.mutate(
        { id: usuario.id, nome: nomeTrim, papel, lojaId: lojaDoCadastro },
        { onSuccess: () => onOpenChange(false), onError: (e) => setErro(e.message) }
      )
      return
    }

    // Valida com a MESMA regra que a Edge Function aplica — as duas
    // são cópias uma da outra, conferidas por spec. Validar aqui é só
    // pra o admin ver o problema antes do round-trip.
    const erroUsername = validarUsername(username)
    if (erroUsername) {
      setErro(erroUsername)
      return
    }
    if (senha.length < 6) {
      setErro('Senha precisa de pelo menos 6 caracteres.')
      return
    }

    criar.mutate(
      { username, senha, nome: nomeTrim, papel, lojaId: lojaDoCadastro },
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
              ? 'Usuário e senha não são alterados aqui. Peça ao suporte do sistema.'
              : 'O usuário é o nome que a pessoa digita para entrar.'}
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
                <Label htmlFor="usuario-username">Usuário</Label>
                <Input
                  id="usuario-username"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="caixa2"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
                {/* O endereço técnico é DERIVADO, nunca digitado — a
                    Edge Function o compõe, e recusa qualquer e-mail que
                    venha no corpo do request. Mostrar aqui o que vai
                    de fato ser gravado evita a surpresa de "José" virar
                    "jose" sem ninguém avisar. */}
                {username.trim() !== '' && (
                  <p className="text-xs text-muted-foreground">
                    Vai entrar como <strong>{normalizarUsername(username)}</strong>
                  </p>
                )}
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
              <Label>Usuário</Label>
              <p className="text-sm text-muted-foreground">{usernameDoEmail(usuario.email)}</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="usuario-papel">Cargo</Label>
            <select
              id="usuario-papel"
              className={SELECT_CLASSNAME}
              value={papel}
              onChange={(e) => trocarPapel(e.target.value as PapelUsuario)}
            >
              {PAPEL_USUARIO_OPTIONS.map(([valor, label]) => (
                <option key={valor} value={valor}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* FILIAL É DO CARGO — passo 2, 2026-09-11.

                caixa, gerente   filial obrigatória: é de onde operam e o
                                 limite do que enxergam
                admin            sem filial fixa: acompanha a rede inteira
                                 e não lança vale

              Para admin o campo nem existe, e por isso nada escondido vai
              no salvar. */}
          {exigeFilial ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="usuario-loja">Filial</Label>
              <select
                id="usuario-loja"
                className={SELECT_CLASSNAME}
                value={lojaId}
                onChange={(e) => setLojaId(e.target.value)}
              >
                {/* Marcador, não opção: `disabled hidden` deixa o campo
                    começar em branco e some da lista aberta, que oferece
                    só filiais. "Sem filial" não é escolha — o banco
                    recusa. */}
                <option value="" disabled hidden>
                  Selecione a filial
                </option>
                {lojas?.map((loja) => (
                  <option key={loja.id} value={loja.id}>
                    {loja.nome}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Caixa e gerente enxergam e lançam só na própria filial.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label>Filial</Label>
              <p className="text-sm text-muted-foreground">
                Todas as filiais.
              </p>
            </div>
          )}

          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? <EmAndamento>Salvando</EmAndamento> : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
