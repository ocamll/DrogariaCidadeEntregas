import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { ListaEntregas } from '@/pages/ListaEntregas'
import { HistoricoEntregas } from '@/pages/HistoricoEntregas'
import { DocumentosPendentes } from '@/pages/DocumentosPendentes'
import { Fechamento } from '@/pages/Fechamento'
import { Ocorrencias } from '@/pages/Ocorrencias'
import { Relatorios } from '@/pages/Relatorios'
import { Cadastros } from '@/pages/Cadastros'
import { CadastroEntrega } from '@/pages/CadastroEntrega'
import { CadastroTransferencia } from '@/pages/CadastroTransferencia'
import { NovaCorrida } from '@/pages/NovaCorrida'
import { RetornoCorrida } from '@/pages/RetornoCorrida'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

type View = 'lista' | 'nova' | 'nova-transferencia' | 'nova-corrida' | 'retorno-corrida'

export function Painel({ profile }: { profile: AuthProfile }) {
  const [view, setView] = useState<View>('lista')

  if (view === 'nova') {
    return <CadastroEntrega profile={profile} onVoltar={() => setView('lista')} />
  }

  if (view === 'nova-transferencia') {
    return <CadastroTransferencia profile={profile} onVoltar={() => setView('lista')} />
  }

  if (view === 'nova-corrida') {
    return <NovaCorrida profile={profile} onVoltar={() => setView('lista')} />
  }

  if (view === 'retorno-corrida') {
    return <RetornoCorrida profile={profile} onVoltar={() => setView('lista')} />
  }

  // Dois gates diferentes, não um só. Gestão (fechamento, ocorrências,
  // relatórios) é do gerente também — a RLS é que limita o que ele vê
  // nelas à própria filial. Cadastros é só do admin, por decisão de
  // 2026-08-12, e a policy de escrita das três tabelas garante isso mesmo
  // que alguém volte a mostrar a aba aqui.
  const isGestao = profile.papel === 'admin' || profile.papel === 'gerente'
  const isAdmin = profile.papel === 'admin'

  return (
    <div className="mx-auto max-w-6xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Entregas</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setView('nova-transferencia')}>
              Transferência
            </Button>
            <Button variant="outline" onClick={() => setView('retorno-corrida')}>
              Retorno de corrida
            </Button>
            <Button variant="outline" onClick={() => setView('nova-corrida')}>
              Nova corrida
            </Button>
            <Button onClick={() => setView('nova')}>Nova entrega</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="hoje">
            <TabsList>
              <TabsTrigger value="hoje">Hoje</TabsTrigger>
              <TabsTrigger value="historico">Histórico</TabsTrigger>
              <TabsTrigger value="documentos">Documentos</TabsTrigger>
              {isGestao && <TabsTrigger value="fechamento">Fechamento</TabsTrigger>}
              {isGestao && <TabsTrigger value="ocorrencias">Ocorrências</TabsTrigger>}
              {isGestao && <TabsTrigger value="relatorios">Relatórios</TabsTrigger>}
              {isAdmin && <TabsTrigger value="cadastros">Cadastros</TabsTrigger>}
            </TabsList>
            <TabsContent value="hoje" className="pt-3">
              <ListaEntregas profile={profile} />
            </TabsContent>
            <TabsContent value="historico" className="pt-3">
              <HistoricoEntregas profile={profile} />
            </TabsContent>
            <TabsContent value="documentos" className="pt-3">
              <DocumentosPendentes profile={profile} />
            </TabsContent>
            {isGestao && (
              <TabsContent value="fechamento" className="pt-3">
                <Fechamento profile={profile} />
              </TabsContent>
            )}
            {isGestao && (
              <TabsContent value="ocorrencias" className="pt-3">
                <Ocorrencias />
              </TabsContent>
            )}
            {isGestao && (
              <TabsContent value="relatorios" className="pt-3">
                <Relatorios />
              </TabsContent>
            )}
            {isAdmin && (
              <TabsContent value="cadastros" className="pt-3">
                <Cadastros profile={profile} />
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
