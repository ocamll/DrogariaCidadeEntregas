import { useEffect, useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useMototaxistasCadastro, useAgenciasCadastro } from '@/data/cadastros'
import {
  useCredenciais,
  useEmitirCredencial,
  useEmitirCredencialDeGerente,
  useRevogarCredencial,
  useRedefinirPin,
  credencialBloqueada,
  type Credencial,
  type CredencialEmitida,
} from '@/data/credenciais'
import { useUsuarios } from '@/data/usuarios'
import {
  generateMotoboyCredential,
  formatTokenForDisplay,
  type MotoboyCredentialData,
  type GeneratedCredential,
} from '@/lib/credencialMotoboy'
import { baixarSvg, baixarArquivo } from '@/lib/credencialDownload'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CriarPinDoCartao } from '@/components/CriarPinDoCartao'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Carregando, EmAndamento } from '@/components/EmAndamento'
import { Consulta, AvisoDaConsulta } from '@/components/Consulta'
import { apresentar, derivarEstado } from '@/lib/estadoDeConsulta'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CredenciaisCadastro({ profile: _profile }: { profile: AuthProfile }) {
  // TRÊS CONSULTAS, TRÊS ESTADOS. Numa tela de segurança isso pesa mais
  // que nas outras: cada uma responde a uma pergunta diferente, e a
  // ignorância de qualquer uma delas não pode virar afirmação sobre as
  // outras duas.
  const consultaMotoboys = useMototaxistasCadastro()
  const consultaAgencias = useAgenciasCadastro()
  // O não-responder DESTA precisa aparecer na tela, e não é zelo: sem
  // isso, uma falha (permissão, tabela fora do ar, ou simplesmente sem
  // rede) renderiza "Sem cartão" em todas as linhas — idêntico a
  // "ninguém tem cartão". Os dois estados não podem se parecer.
  //
  // O comentário original dizia isso só do ERRO. O caso pausado tem
  // exatamente a mesma consequência e não estava coberto.
  const consultaCredenciais = useCredenciais()

  const estadoMotoboys = derivarEstado(consultaMotoboys)
  const estadoAgencias = derivarEstado(consultaAgencias)
  const estadoCredenciais = derivarEstado(consultaCredenciais)

  const agencias = estadoAgencias.estado === 'ready' ? estadoAgencias.dados : undefined
  const credenciais = estadoCredenciais.estado === 'ready' ? estadoCredenciais.dados : undefined

  // Os gerentes: mesma tabela de credenciais, outro titular. A consulta é
  // a de usuários, que o admin já enxerga inteira.
  const consultaUsuarios = useUsuarios()
  const estadoUsuarios = derivarEstado(consultaUsuarios)
  const gerentes =
    estadoUsuarios.estado === 'ready'
      ? estadoUsuarios.dados.filter((u) => u.papel === 'gerente' && u.ativo)
      : undefined

  const emitir = useEmitirCredencial()
  const emitirDeGerente = useEmitirCredencialDeGerente()
  const revogar = useRevogarCredencial()
  const redefinir = useRedefinirPin()

  const [emitida, setEmitida] = useState<{
    dados: CredencialEmitida
    titularNome: string
    vinculoNome: string
  } | null>(null)
  const [confirmando, setConfirmando] = useState<
    { acao: 'revogar' | 'redefinir'; credencial: Credencial; titularNome: string } | null
  >(null)
  const [ativando, setAtivando] = useState<{ titularNome: string } | null>(null)

  const credencialDe = (motoboyId: string) => credenciais?.find((c) => c.motoboyId === motoboyId)
  const credencialDoGerente = (profileId: string) =>
    credenciais?.find((c) => c.profileId === profileId)

  // "Não tem agência" e "não sei qual é" eram os dois o mesmo `—`.
  const nomeAgencia = (agenciaId: string | null) => {
    if (agenciaId === null) return '—'
    if (!agencias) return '…'
    return agencias.find((a) => a.id === agenciaId)?.nome ?? '—'
  }

  // A lista de credenciais respondeu? Só com isso "Sem cartão" é uma
  // afirmação, e não um chute.
  const sabeDasCredenciais = estadoCredenciais.estado === 'ready'

  // A agência entra aqui porque ela aparece IMPRESSA na credencial. Vem
  // do cadastro do motoboy, resolvida no mesmo lugar que a coluna da
  // tabela — uma fonte só.
  async function handleEmitir(motoboyId: string, motoboyNome: string, agenciaNome: string) {
    const dados = await emitir.mutateAsync(motoboyId)
    setEmitida({ dados, titularNome: motoboyNome, vinculoNome: agenciaNome })
  }

  // Mesmo cartão, mesmo desenho: no lugar da agência vai a FILIAL, que é
  // o vínculo que importa para um gerente — e é contra ela que o selo vai
  // conferir a autorização.
  async function handleEmitirGerente(profileId: string, nome: string, lojaNome: string) {
    const dados = await emitirDeGerente.mutateAsync(profileId)
    setEmitida({ dados, titularNome: nome, vinculoNome: lojaNome })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        O cartão identifica o motoboy; o PIN prova que é ele. O PIN é criado pelo próprio motoboy no
        primeiro uso do cartão — ninguém aqui escolhe nem consegue ver.
      </p>

      {/* A COLUNA "CARTÃO" DEPENDE DE OUTRA CONSULTA, e quando ela não
          responde a tela avisa — antes isso só acontecia no erro, e o
          caso pausado (offline) passava calado dizendo "Sem cartão". */}
      {!sabeDasCredenciais && estadoCredenciais.estado !== 'inactive' && (
        <div className="flex flex-col gap-1">
          <AvisoDaConsulta
            apresentacao={apresentar(estadoCredenciais)}
            aoRecarregar={() => void consultaCredenciais.refetch()}
          />
          <p className="text-xs text-foreground/70">
            A coluna “Cartão” abaixo não está confiável até isso resolver.
          </p>
        </div>
      )}

      <Consulta
        estado={estadoMotoboys}
        // Só motoboy ativo: emitir cartão pra quem está desativado seria
        // imprimir papel que o próprio banco recusa (emitir_credencial
        // barra). O filtro entrou no `estaVazio` junto com a lista, pra
        // "nenhum ativo" continuar sendo uma afirmação sobre o que o
        // servidor respondeu.
        estaVazio={(ms) => ms.filter((m) => m.ativo).length === 0}
        vazio={
          <p className="text-sm text-muted-foreground">
            Nenhum motoboy ativo. Cadastra um em Mototaxistas primeiro.
          </p>
        }
        aoRecarregar={() => void consultaMotoboys.refetch()}
      >
        {(motoboys) => {
          const ativos = motoboys.filter((m) => m.ativo)
          return (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Motoboy</TableHead>
              <TableHead>Agência</TableHead>
              <TableHead>Cartão</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>Emitido em</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ativos.map((motoboy) => {
              const credencial = credencialDe(motoboy.id)
              const bloqueada = credencial ? credencialBloqueada(credencial) : false

              return (
                <TableRow key={motoboy.id}>
                  <TableCell>{motoboy.nome}</TableCell>
                  <TableCell>{nomeAgencia(motoboy.agenciaId)}</TableCell>

                  <TableCell>
                    {credencial ? (
                      // Só os 4 últimos do public_id, nunca o token. É o
                      // suficiente pra casar o papel com a linha da tela.
                      <span className="font-mono text-xs">
                        ••••{credencial.publicId.slice(-4)}
                      </span>
                    ) : sabeDasCredenciais ? (
                      <span className="text-sm text-muted-foreground">Sem cartão</span>
                    ) : (
                      // A consulta das credenciais não respondeu. "Sem
                      // cartão" aqui seria a tela concluindo, a partir da
                      // própria ignorância, que o motoboy não tem
                      // credencial — numa tela onde isso decide se alguém
                      // vai imprimir um cartão que já existe.
                      <span className="text-sm text-muted-foreground">…</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {!credencial && <span className="text-sm text-muted-foreground">—</span>}
                    {credencial && bloqueada && (
                      <Badge variant="destructive">
                        Bloqueado até {new Date(credencial.bloqueadoAte!).toLocaleTimeString('pt-BR')}
                      </Badge>
                    )}
                    {/* "Aguardando ativação" e não "sem PIN": o cartão
                        existe e está impresso, o que falta é o motoboy
                        criar o dele no primeiro uso. É o estado normal de
                        um cartão recém-emitido, não um problema. */}
                    {credencial && !bloqueada && (
                      <Badge variant={credencial.temPin ? 'secondary' : 'outline'}>
                        {credencial.temPin ? 'Configurado' : 'Aguardando ativação'}
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-foreground/70">
                    {credencial ? new Date(credencial.emitidoEm).toLocaleDateString('pt-BR') : '—'}
                  </TableCell>

                  <TableCell className="text-xs text-foreground/70">
                    {credencial?.ultimoUsoEm
                      ? new Date(credencial.ultimoUsoEm).toLocaleString('pt-BR')
                      : credencial
                        ? 'nunca'
                        : '—'}
                  </TableCell>

                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {credencial && credencial.temPin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmando({
                              acao: 'redefinir',
                              credencial,
                              titularNome: motoboy.nome,
                            })
                          }
                        >
                          Redefinir PIN
                        </Button>
                      )}
                      {credencial && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmando({
                              acao: 'revogar',
                              credencial,
                              titularNome: motoboy.nome,
                            })
                          }
                        >
                          Revogar
                        </Button>
                      )}
                      <Button
                        variant={credencial ? 'ghost' : 'default'}
                        size="sm"
                        disabled={emitir.isPending}
                        onClick={() => void handleEmitir(motoboy.id, motoboy.nome, nomeAgencia(motoboy.agenciaId))}
                      >
                        {credencial ? 'Emitir novo' : 'Emitir cartão'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
          )
        }}
      </Consulta>

      {emitir.isError && (
        <p className="text-sm text-destructive">
          Não consegui emitir: {(emitir.error as Error).message}
        </p>
      )}

      {/* =================================================================
          O CARTÃO DO GERENTE — 4B.1

          Mesmo cartão, outro papel: ele não retira corrida nenhuma. Serve
          para AUTORIZAR a saída ou o retorno quando o motoboy perdeu o
          cartão ou esqueceu o PIN, e é conferido contra a filial do
          documento — por isso a coluna da filial fica ao lado do nome, e
          por isso o banco recusa emitir para gerente sem filial.

          A tela diz o que o cartão ainda NÃO faz. Enquanto a autorização
          excepcional não existir, anunciar "pronto para usar" seria a
          tela afirmando o que ela não sabe.
          ================================================================= */}
      <div className="mt-6 flex flex-col gap-2 border-t pt-4">
        <div>
          <h3 className="text-sm font-medium">Cartões de autorização — gerentes</h3>
          <p className="text-sm text-muted-foreground">
            O gerente usa o cartão e o PIN dele para autorizar uma saída ou um retorno quando o
            motoboy perdeu o cartão ou esqueceu o PIN. Ele nunca substitui o motoboy no documento:
            o vale continua sendo de quem faz a entrega.
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            A autorização pelo cartão do gerente <strong>ainda não está no fluxo da saída e do
            retorno</strong>. O que já funciona é emitir o cartão e o gerente criar o PIN dele —
            e é isso que precisa estar pronto antes, porque criar PIN exige internet.
          </p>
        </div>

        <Consulta
          estado={estadoUsuarios}
          estaVazio={(us) => us.filter((u) => u.papel === 'gerente' && u.ativo).length === 0}
          vazio={
            <p className="text-sm text-muted-foreground">
              Nenhum gerente ativo. Cadastra um em Usuários primeiro.
            </p>
          }
          aoRecarregar={() => void consultaUsuarios.refetch()}
        >
          {() => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gerente</TableHead>
                  <TableHead>Filial</TableHead>
                  <TableHead>Cartão</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Emitido em</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(gerentes ?? []).map((gerente) => {
                  const credencial = credencialDoGerente(gerente.id)
                  const bloqueada = credencial ? credencialBloqueada(credencial) : false

                  return (
                    <TableRow key={gerente.id}>
                      <TableCell>{gerente.nome}</TableCell>
                      {/* Gerente sem filial é o único que o banco recusa,
                          e a tela precisa dizer por quê ANTES do clique. */}
                      <TableCell>
                        {gerente.lojaNome ?? (
                          <span className="text-destructive">sem filial</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {credencial ? (
                          <span className="font-mono text-xs">
                            ••••{credencial.publicId.slice(-4)}
                          </span>
                        ) : sabeDasCredenciais ? (
                          <span className="text-sm text-muted-foreground">Sem cartão</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">…</span>
                        )}
                      </TableCell>

                      <TableCell>
                        {!credencial && <span className="text-sm text-muted-foreground">—</span>}
                        {credencial && bloqueada && (
                          <Badge variant="destructive">
                            Bloqueado até{' '}
                            {new Date(credencial.bloqueadoAte!).toLocaleTimeString('pt-BR')}
                          </Badge>
                        )}
                        {credencial && !bloqueada && (
                          <Badge variant={credencial.temPin ? 'secondary' : 'outline'}>
                            {credencial.temPin ? 'Configurado' : 'Aguardando ativação'}
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-xs text-foreground/70">
                        {credencial
                          ? new Date(credencial.emitidoEm).toLocaleDateString('pt-BR')
                          : '—'}
                      </TableCell>

                      <TableCell className="text-xs text-foreground/70">
                        {credencial?.ultimoUsoEm
                          ? new Date(credencial.ultimoUsoEm).toLocaleString('pt-BR')
                          : credencial
                            ? 'nunca'
                            : '—'}
                      </TableCell>

                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {/* ATIVAR O PIN AQUI, e não no balcão. O cartão
                              do motoboy é ativado na Nova corrida porque
                              é lá que ele aparece; o do gerente não passa
                              por aquela tela — ele autoriza, não retira.
                              Sem este botão, a credencial do gerente
                              ficaria impressa e inerte para sempre. */}
                          {credencial && !credencial.temPin && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setAtivando({ titularNome: gerente.nome })}
                            >
                              Ativar PIN
                            </Button>
                          )}
                          {credencial && credencial.temPin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setConfirmando({
                                  acao: 'redefinir',
                                  credencial,
                                  titularNome: gerente.nome,
                                })
                              }
                            >
                              Redefinir PIN
                            </Button>
                          )}
                          {credencial && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setConfirmando({
                                  acao: 'revogar',
                                  credencial,
                                  titularNome: gerente.nome,
                                })
                              }
                            >
                              Revogar
                            </Button>
                          )}
                          <Button
                            variant={credencial ? 'ghost' : 'default'}
                            size="sm"
                            disabled={emitirDeGerente.isPending || gerente.lojaId === null}
                            onClick={() =>
                              void handleEmitirGerente(
                                gerente.id,
                                gerente.nome,
                                gerente.lojaNome ?? '—'
                              )
                            }
                          >
                            {credencial ? 'Emitir novo' : 'Emitir cartão'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Consulta>

        {emitirDeGerente.isError && (
          <p className="text-sm text-destructive">
            Não consegui emitir: {(emitirDeGerente.error as Error).message}
          </p>
        )}
      </div>

      {emitida && (
        <CredencialEmitidaDialog
          emitida={emitida.dados}
          titularNome={emitida.titularNome}
          vinculoNome={emitida.vinculoNome}
          onFechar={() => setEmitida(null)}
        />
      )}

      {ativando && (
        <AtivarPinDialog
          titularNome={ativando.titularNome}
          onPronto={() => {
            setAtivando(null)
            void consultaCredenciais.refetch()
          }}
          onFechar={() => setAtivando(null)}
        />
      )}

      {confirmando && (
        <ConfirmarAcaoDialog
          acao={confirmando.acao}
          titularNome={confirmando.titularNome}
          pendente={revogar.isPending || redefinir.isPending}
          onConfirmar={async () => {
            if (confirmando.acao === 'revogar') {
              await revogar.mutateAsync(confirmando.credencial.id)
            } else {
              await redefinir.mutateAsync(confirmando.credencial.id)
            }
            setConfirmando(null)
          }}
          onFechar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}

// =====================================================================
// A credencial recém-emitida
//
// Esta tela é a ÚNICA vez que o token existe fora do papel. O banco
// guarda só o HMAC, então fechar sem salvar significa emitir outra —
// não há "ver de novo".
//
// O DESENHO NÃO MORA AQUI. Frente e verso vêm prontos de
// `src/lib/credencialMotoboy.ts`, que só substitui token, código de
// barras, nome e agência num modelo fixo. Este componente não desenha,
// não posiciona e não escolhe cor: ele mostra e entrega.
//
// A credencial substituiu o cartão de 75 × 20,2mm que só tinha código e
// token. Cartões daquele formato já impressos continuam válidos — o que
// autentica é o token, e ele não mudou.
// =====================================================================

// `titularNome` e `vinculoNome` porque o mesmo diálogo serve os dois
// cartões: o do motoboy, com a agência, e o do gerente, com a filial. O
// desenho é o mesmo — o que muda é o valor impresso naquela linha.
function CredencialEmitidaDialog({
  emitida,
  titularNome,
  vinculoNome,
  onFechar,
}: {
  emitida: CredencialEmitida
  titularNome: string
  vinculoNome: string
  onFechar: () => void
}) {
  const [gerada, setGerada] = useState<GeneratedCredential | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const dados: MotoboyCredentialData = {
    tokenDisplay: formatTokenForDisplay(emitida.token),
    // O valor EXATO que o leitor precisa devolver. Nunca o formatado —
    // os espaços são só pro olho humano.
    barcodeValue: emitida.token,
    fullName: titularNome,
    agency: vinculoNome,
  }

  useEffect(() => {
    let cancelado = false
    generateMotoboyCredential(dados)
      .then((r) => {
        if (!cancelado) setGerada(r)
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitida.token, titularNome, vinculoNome])

  async function baixarPdf() {
    if (!gerada) return
    setErro(null)
    setOcupado(true)
    try {
      // Só o PDF entra por import dinâmico: é ele que puxa os ~400 kB do
      // jspdf. O módulo de download é estático — misturar os dois estilos
      // no mesmo arquivo faz o Rolldown desistir de separar o chunk.
      const { montarCredencialPdf, carregarAssetsCredencial } = await import('@/lib/credencialPdf')
      const bytes = await montarCredencialPdf(dados, await carregarAssetsCredencial())
      baixarArquivo(
        new Blob([bytes], { type: 'application/pdf' }),
        `credencial-${emitida.publicId}.pdf`,
        'application/pdf'
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Credencial de {titularNome}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              <strong>Salva ou imprime agora.</strong> O sistema guarda só uma impressão digital do
              cartão — este código não aparece de novo em lugar nenhum. Se fechar sem salvar, o
              caminho é emitir outra credencial.
            </p>
          </div>

          {/* O que está na tela é byte a byte o que os arquivos contêm. */}
          {erro ? (
            <div className="text-xs text-red-700">
              <p>Não consegui gerar a credencial.</p>
              {erro.includes('dynamically imported module') ? (
                <p className="mt-1">
                  Recarrega a página (Ctrl+Shift+R) e emite de novo — o navegador está com uma
                  versão vencida de um arquivo.
                </p>
              ) : (
                <p className="mt-1">{erro}</p>
              )}
            </div>
          ) : gerada ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div
                className="w-full [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: gerada.frontSvg }}
              />
              <div
                className="w-full [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: gerada.backSvg }}
              />
            </div>
          ) : (
            <Carregando texto="Gerando" className="text-xs" />
          )}

          <div className="flex flex-col gap-1 text-sm">
            <p>
              Cartão <strong>85,6 × 54mm</strong> (CR80), com o código de barras em 75 × 15,767mm —
              0,426mm por módulo, mais que o dobro do que um leitor laser comum exige.
            </p>
            <p className="text-xs text-foreground/70">
              Pra gráfica, use o <strong>PDF</strong>: nele as fontes são as padrão do formato, não
              dependem de a máquina deles ter Consolas ou Arial, e o preto das barras vai como 100%
              K. Peça pra imprimir <strong>a 100%, sem redimensionar</strong>. Diga também qual
              vermelho vocês querem (Pantone ou CMYK) — o arquivo leva o da tela, em RGB.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Os arquivos contêm o código do cartão — quem tiver eles imprime uma cópia que
              funciona. Apaga depois de imprimir.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={onFechar}>
            Já salvei
          </Button>
          {/* Dois botões separados de propósito: alguns navegadores
              bloqueiam o segundo download disparado no mesmo gesto. */}
          <Button
            variant="outline"
            disabled={!gerada}
            onClick={() => gerada && baixarSvg(gerada.frontSvg, `credencial-${emitida.publicId}-frente.svg`)}
          >
            Baixar frente
          </Button>
          <Button
            variant="outline"
            disabled={!gerada}
            onClick={() => gerada && baixarSvg(gerada.backSvg, `credencial-${emitida.publicId}-verso.svg`)}
          >
            Baixar verso
          </Button>
          <Button onClick={() => void baixarPdf()} disabled={!gerada || ocupado}>
            {ocupado ? <EmAndamento>Gerando PDF</EmAndamento> : 'Baixar PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =====================================================================
// ATIVAR O PIN DO CARTÃO DO GERENTE
//
// Quem digita é o GERENTE, com o cartão dele na mão — o admin abre a
// tela e sai da frente. `definir_pin` exige o token completo justamente
// por isso, e só funciona enquanto a credencial não tem PIN: não existe
// "mostrar PIN" nem "escolher para o outro", e não pode passar a existir.
//
// ONLINE POR CONSTRUÇÃO, e isso não é uma checagem de tela: a função SQL
// depende da sessão e recusa sem ela. O aviso aqui existe pra a
// impossibilidade aparecer ANTES de alguém contar com a exceção offline
// no meio de uma queda de internet.
// =====================================================================

function AtivarPinDialog({
  titularNome,
  onPronto,
  onFechar,
}: {
  titularNome: string
  onPronto: () => void
  onFechar: () => void
}) {
  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ativar o PIN de {titularNome}</DialogTitle>
        </DialogHeader>

        <CriarPinDoCartao
          titularNome={titularNome}
          rotuloDoCartao="Bipa o cartão do gerente"
          onPronto={onPronto}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmarAcaoDialog({
  acao,
  titularNome,
  pendente,
  onConfirmar,
  onFechar,
}: {
  acao: 'revogar' | 'redefinir'
  titularNome: string
  pendente: boolean
  onConfirmar: () => Promise<void>
  onFechar: () => void
}) {
  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {acao === 'revogar' ? 'Revogar o cartão' : 'Redefinir o PIN'} de {titularNome}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm">
          {acao === 'revogar' ? (
            <>
              O cartão para de funcionar na hora e não volta — para usar de novo, é preciso emitir um
              novo. As saídas que ele já assinou continuam intactas e seguem mostrando qual cartão
              foi usado.
            </>
          ) : (
            <>
              O PIN atual deixa de valer. O motoboy cria um novo no próximo uso do cartão, e ninguém
              aqui vê o que ele escolher. As assinaturas antigas não mudam.
            </>
          )}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant={acao === 'revogar' ? 'destructive' : 'default'}
            disabled={pendente}
            onClick={() => void onConfirmar()}
          >
            {pendente ? <EmAndamento>Aplicando</EmAndamento> : acao === 'revogar' ? 'Revogar' : 'Redefinir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
