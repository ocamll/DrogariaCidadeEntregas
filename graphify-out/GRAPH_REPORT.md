# Graph Report - Drogaria Cidade Tele Entregas  (2026-09-08)

## Corpus Check
- 231 files · ~279,424 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1759 nodes · 3882 edges · 183 communities (102 shown, 36 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Acerto, Drive e Fechamento
- Diálogos e ações do vale
- Componentes de UI base
- Specs e fixtures de teste
- Spec do canônico em jsonb
- Fila offline e sincronização
- Credencial, PIN e selagem
- Canônico do retorno (DCRR1)
- Shell do app e layout
- Custódia de convênio e receita
- Schema inicial e RLS
- Divergência de pagamento
- Contexto do Romaneio de Retorno
- Tabela de vales e cadastros
- Patch do E10 — admin por filial
- Specs de diálogo e entregas
- Arquivos-fonte por extensão
- Specs de assinatura e custódia
- Spec de estado de consulta
- Patch do selo de retorno (E3.B)
- Aliases de componentes
- Exportação .xlsx do acerto
- Dependências do package.json
- Code 128 e credencial
- Acesso a dados de entregas
- Marca, datas e custódia visual
- Acesso a dados de romaneios
- Migration do Romaneio de Saída
- Exportação PDF do acerto
- Envelope RSA offline
- Scripts de exemplo e fixtures
- Configuração do TypeScript
- Componentes de progresso e sangria
- Normalização de texto
- Grupo menor 34
- Grupo menor 35
- Grupo menor 36
- Grupo menor 37
- Grupo menor 38
- Grupo menor 39
- Grupo menor 40
- Grupo menor 41
- Grupo menor 42
- Grupo menor 43
- Grupo menor 44
- Grupo menor 45
- Grupo menor 46
- Grupo menor 47
- Grupo menor 48
- Grupo menor 49
- Grupo menor 50
- Grupo menor 51
- Grupo menor 52
- Grupo menor 53
- Grupo menor 54
- Grupo menor 55
- Grupo menor 56
- Grupo menor 57
- Grupo menor 58
- Grupo menor 59
- Grupo menor 60
- Grupo menor 61
- Grupo menor 62
- Grupo menor 63
- Grupo menor 64
- Grupo menor 65
- Grupo menor 66
- Grupo menor 67
- Grupo menor 68
- Grupo menor 69
- Grupo menor 70
- Grupo menor 71
- Grupo menor 72
- Grupo menor 73
- Grupo menor 74
- Grupo menor 75
- Grupo menor 76
- Grupo menor 77
- Grupo menor 78
- Grupo menor 79
- Grupo menor 80
- Grupo menor 81
- Grupo menor 82
- Grupo menor 83
- Grupo menor 84
- Grupo menor 85
- Grupo menor 86
- Grupo menor 87
- Grupo menor 88
- Grupo menor 89
- Grupo menor 90
- Grupo menor 91
- Grupo menor 92
- Grupo menor 93
- Grupo menor 94
- Grupo menor 95
- Grupo menor 96
- Grupo menor 97
- Grupo menor 98
- Grupo menor 99
- Grupo menor 100
- Grupo menor 101
- Grupo menor 102
- Grupo menor 103
- Grupo menor 104
- Grupo menor 105
- Grupo menor 107
- Grupo menor 108
- Grupo menor 109
- Grupo menor 111
- Grupo menor 112
- Grupo menor 116
- Grupo menor 117
- Grupo menor 119
- Grupo menor 131
- Grupo menor 132
- Grupo menor 146
- Grupo menor 148
- Grupo menor 150
- Grupo menor 152
- Grupo menor 154
- Grupo menor 156
- Grupo menor 158
- Grupo menor 160
- Grupo menor 163
- Grupo menor 164
- Grupo menor 165
- Grupo menor 166
- Grupo menor 168
- Grupo menor 169
- Grupo menor 170
- Grupo menor 174
- Grupo menor 175
- Grupo menor 176
- Grupo menor 177
- Grupo menor 180
- Grupo menor 181
- Grupo menor 182

## God Nodes (most connected - your core abstractions)
1. `cn()` - 66 edges
2. `react` - 50 edges
3. `derivarEstado()` - 42 edges
4. `formatBRL()` - 38 edges
5. `NovaCorridaFluxo()` - 37 edges
6. `FluxoDeRetorno()` - 36 edges
7. `Button()` - 33 edges
8. `uuidv7()` - 26 edges
9. `AuthProfile` - 25 edges
10. `CadastroEntregaForm()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `normalizarParaBusca()` --semantically_similar_to--> `public.sem_acento(text) (função SQL)`  [EXTRACTED] [semantically similar]
  src/lib/texto.ts → CLAUDE.md
- `publicIdDoToken()` --semantically_similar_to--> `public_id_do_token (função SQL)`  [EXTRACTED] [semantically similar]
  src/lib/tokenCartao.ts → CLAUDE.md
- `Edge Function criar-usuario` --semantically_similar_to--> `normalizarUsername()`  [EXTRACTED] [semantically similar]
  CLAUDE.md → src/lib/username.ts
- `html lang=pt-BR e translate=no` --rationale_for--> `EntregasTable()`  [INFERRED]
  CLAUDE.md → src/components/EntregasTable.tsx
- `Cancelamento de vale` --rationale_for--> `entraNoDinheiro()`  [EXTRACTED]
  CLAUDE.md → src/data/relatorios.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Fluxo da cadeia de custódia da saída** — claude_cartao_v3, claude_autenticar_credencial, claude_selar_romaneio_interno, src_lib_canonico_montarcanonico, claude_romaneio_canonico_sql, claude_envelope_rsa_aes, claude_edge_function_sync_romaneio [EXTRACTED 1.00]
- **Pares de implementações gêmeas TS × SQL/Deno** — src_lib_canonico_montarcanonico, claude_romaneio_canonico_sql, src_lib_canonicoretorno_montarcanonicoretorno, src_lib_envelope_calcularofflineeventhash, claude_edge_function_sync_romaneio, src_lib_tokencartao_publiciddotoken, claude_public_id_do_token_sql, src_lib_username_normalizarusername [EXTRACTED 1.00]
- **As nove regras invioláveis** — claude_regra_dinheiro_em_centavos, claude_regra_tenant_id, claude_regra_rls_toda_tabela, claude_regra_nunca_deletar_entrega, claude_regra_uuid_v7_no_cliente, claude_regra_eventos_append_only, claude_regra_vale_selado_imutavel, claude_regra_dois_relogios, claude_regra_sem_dado_de_saude [EXTRACTED 1.00]
- **As duas travas contra tradução do navegador** — index_lang_pt_br, index_translate_no, index_bug_aba_transferencias [EXTRACTED 1.00]
- **Assets da marca por destino (tela, documento, cruz)** — public_marca_logo_drogaria_cidade_logo_tela, public_marca_logo_drogaria_cidade_documento_logo_documento, public_marca_cruz_drogaria_cidade_cruz, public_marca_logo_drogaria_cidade_letreiro_branco [EXTRACTED 1.00]
- **Cadeia do achado de acessibilidade do anel de foco** — anti_slop_audit_001_2026_09_08_zero_mouse, anti_slop_audit_001_2026_09_08_anel_de_foco, anti_slop_audit_001_2026_09_08_ring_token, anti_slop_audit_001_2026_09_08_opacidade_mata_contraste, scripts_contraste_contraste [EXTRACTED 1.00]

## Communities (183 total, 36 thin omitted)

### Community 0 - "Acerto, Drive e Fechamento"
Cohesion: 0.05
Nodes (59): Cidade, filial e agência, Exportação do acerto (xlsx, PDF, Drive), Integração Google Drive (escopo drive.file), Regra 8 — Dois relógios (ocorrido_em_local e registrado_em), Sangria do fim do dia (aba Fechamento), daAgencia, daFarmacia, destino (+51 more)

### Community 1 - "Diálogos e ações do vale"
Cohesion: 0.08
Nodes (32): CancelarValeDialog(), Reticencias(), EntregaAcoesMenu(), CardAction(), CardFooter(), DialogOverlay(), DropdownMenu(), DropdownMenuCheckboxItem() (+24 more)

### Community 2 - "Componentes de UI base"
Cohesion: 0.20
Nodes (21): class-variance-authority, radix-ui, AvisoDaConsulta(), CampoDependente(), Consulta(), MOTIVO_CONFLITO, ROTULO_POR_TIPO, Badge() (+13 more)

### Community 3 - "Specs e fixtures de teste"
Cohesion: 0.10
Nodes (32): dados, base, esperadas, fim, nomes, perigoso, rects, recusa() (+24 more)

### Community 4 - "Spec do canônico em jsonb"
Cohesion: 0.07
Nodes (30): ASPA, chamada(), comoJsonb(), linhas, literal(), ramos, BASE, CABECALHO (+22 more)

### Community 5 - "Fila offline e sincronização"
Cohesion: 0.11
Nodes (26): FilaOfflineIndicador(), criarEntrega(), criarTransferencia(), agendarProximaRodada(), calcularProximaTentativa(), descartarItemTerminal(), ESPERAS_MS, executarOperacao() (+18 more)

### Community 6 - "Credencial, PIN e selagem"
Cohesion: 0.13
Nodes (28): CampoAssinatura(), autenticarCredencial(), definirPin(), pinAceitavel(), autorizarSaida(), documentHashLocal(), prepararRomaneio(), envelopeDisponivel() (+20 more)

### Community 7 - "Canônico do retorno (DCRR1)"
Cohesion: 0.10
Nodes (25): DCRR1 — canônico do retorno, As duas implementações gêmeas (TS × SQL), Golden vectors do DCRR1, VETORES_INVALIDOS, DocumentoFisicoCanonico, FormaPagamento, FORMAS_PAGAMENTO, idCanonico() (+17 more)

### Community 8 - "Shell do app e layout"
Cohesion: 0.12
Nodes (23): App(), AppContent(), ProfileErrorScreen(), AppLayout(), BotaoSair(), handleSair(), PAPEL_LABEL, Carregando() (+15 more)

### Community 9 - "Custódia de convênio e receita"
Cohesion: 0.12
Nodes (25): buscarDocumentosConvenioPendentes(), buscarReceitasPendentes(), DocumentoConvenioPendente, DocumentoConvenioPendenteRow, marcarDocumentoConvenioRecebido(), marcarReceitaRecebida(), notificarDocumentoConvenioNaoRetornou(), NotificarDocumentoInput (+17 more)

### Community 10 - "Schema inicial e RLS"
Cohesion: 0.17
Nodes (22): auth.users, public.fn_entrega_imutavel, public.fn_log_entrega, public.fn_touch_atualizado_em, public.agencias, public.assinaturas, public.convenios, public.corridas (+14 more)

### Community 11 - "Divergência de pagamento"
Cohesion: 0.16
Nodes (21): RFC-9562, handleConfirmar(), DivergenciaPagamentoForm(), handleConfirmar(), FaltaReceitaForm(), handleConfirmar(), Linha, linhaInicial() (+13 more)

### Community 12 - "Contexto do Romaneio de Retorno"
Cohesion: 0.12
Nodes (22): aquecerContextosDeRetorno(), buscarDoServidor(), ContextoRetorno, ContextoRow, converter(), guardarContextoLocal(), lerContextoLocal(), PagamentoPrevistoDoContexto (+14 more)

### Community 13 - "Tabela de vales e cadastros"
Cohesion: 0.17
Nodes (17): lucide-react, STATUS_CLASSE, STATUS_LABEL, Table(), TableBody(), TableCell(), TableHead(), TableHeader() (+9 more)

### Community 14 - "Patch do E10 — admin por filial"
Cohesion: 0.08
Nodes (21): acrescentadas, blocosIntactos, checa(), conjuntoAntes, conjuntoDepois, digestsAntes, digestsDepois, fim (+13 more)

### Community 15 - "Specs de diálogo e entregas"
Cohesion: 0.15
Nodes (19): checa(), dialog, entregas, igual(), pagamentos, resumoEJustificativa(), PagamentoRealizado, digitosDoValor() (+11 more)

### Community 16 - "Arquivos-fonte por extensão"
Cohesion: 0.11
Nodes (3): entrada, entregaIds, r

### Community 17 - "Specs de assinatura e custódia"
Cohesion: 0.14
Nodes (20): ASSINATURAS, ATE_AUTORIZADO, ATE_CAPTURADO, correr(), DOC, OUTRO, Carimbada, carimbar() (+12 more)

### Community 18 - "Spec de estado de consulta"
Cohesion: 0.12
Nodes (20): checa(), Credencial, igual(), MotivoDoCartao, Apresentacao, apresentar(), ConsultaComVeredito, LeituraDeConsulta (+12 more)

### Community 19 - "Patch do selo de retorno (E3.B)"
Cohesion: 0.09
Nodes (15): acrescentadas, anterior, conjuntoAntes, conjuntoDepois, dAntes, dDepois, diferentes, fonte (+7 more)

### Community 20 - "Aliases de componentes"
Cohesion: 0.09
Nodes (21): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+13 more)

### Community 21 - "Exportação .xlsx do acerto"
Cohesion: 0.16
Nodes (20): exceljs, achatarVales(), baixar(), COR, estilizarCabecalho(), estilizarTotal(), exportarAcertoXlsx(), faixaDeTitulo() (+12 more)

### Community 22 - "Dependências do package.json"
Cohesion: 0.09
Nodes (22): dependencies, bwip-js, class-variance-authority, clsx, dexie, dexie-react-hooks, exceljs, @fontsource-variable/geist (+14 more)

### Community 23 - "Code 128 e credencial"
Cohesion: 0.13
Nodes (18): bwip-js, { barras }, casosNumericos, codes, dados, fim, inicio, svg (+10 more)

### Community 24 - "Acesso a dados de entregas"
Cohesion: 0.13
Nodes (19): @supabase/supabase-js, buscarEntregasDeHoje(), buscarHistoricoEntregas(), buscarTransferencias(), cancelarEntrega(), CancelarEntregaInput, EntregaRecente, EntregaRecenteRow (+11 more)

### Community 25 - "Marca, datas e custódia visual"
Cohesion: 0.15
Nodes (19): BlocoAssinatura(), duracaoDaCorrida(), cache, carregarAssetsDaMarca(), carregarImagemDaMarca(), COR_MARCA, LOGO_DOCUMENTO_URL, LOGO_PROPORCAO (+11 more)

### Community 26 - "Acesso a dados de romaneios"
Cohesion: 0.14
Nodes (20): buscarCustodias(), buscarRomaneio(), buscarRomaneiosRecebidosEm(), buscarValesParaSaida(), ehRecusaDoServidor(), ErroDoServidor, LinhaAssinatura, LinhaVale (+12 more)

### Community 27 - "Migration do Romaneio de Saída"
Cohesion: 0.12
Nodes (14): public.motoboy_autorizacoes, public.pode_ver_romaneio(), public.registrar_conflito_romaneio(), public.romaneio_canonico(), public.romaneio_entregas, public.romaneios, public.corridas, public.entregas (+6 more)

### Community 28 - "Exportação PDF do acerto"
Cohesion: 0.13
Nodes (18): jspdf, jspdf-autotable, achatarVales(), carregarLogo(), ContextoAcerto, COR_ALERTA, COR_CABECALHO, COR_SUAVE (+10 more)

### Community 29 - "Envelope RSA offline"
Cohesion: 0.13
Nodes (16): arquivo, config, dir, fonte, inicio, segredosBase, spki, ALGORITMO_RSA (+8 more)

### Community 30 - "Scripts de exemplo e fixtures"
Cohesion: 0.11
Nodes (12): instalarFetchDePublic(), romaneio, comCorrecao, daAgencia, daFarmacia, romaneio, semAssinaturas, semLogo (+4 more)

### Community 31 - "Configuração do TypeScript"
Cohesion: 0.10
Nodes (20): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+12 more)

### Community 32 - "Componentes de progresso e sangria"
Cohesion: 0.26
Nodes (11): react, EmAndamento(), Card(), CardContent(), CardDescription(), CardHeader(), CardTitle(), useRomaneio() (+3 more)

### Community 33 - "Normalização de texto"
Cohesion: 0.17
Nodes (18): checa(), igual(), AgenciaFormDialog(), handleSalvar(), ConvenioFormDialog(), handleSalvar(), MototaxistaFormDialog(), handleSalvar() (+10 more)

### Community 34 - "Grupo menor 34"
Cohesion: 0.11
Nodes (18): name, private, type, version, clsx, dexie-react-hooks, @fontsource-variable/geist, oxlint (+10 more)

### Community 35 - "Grupo menor 35"
Cohesion: 0.13
Nodes (17): CredenciaisCadastro(), buscarCredenciais(), Credencial, credencialBloqueada(), CredencialEmitida, CredencialIdentificada, CredencialRow, LinhaCache (+9 more)

### Community 36 - "Grupo menor 36"
Cohesion: 0.15
Nodes (15): DCR1 — canônico da saída, romaneio_canonico (função SQL), base, embaralhado, linhas, maiusculo, saida, conferirCanonico() (+7 more)

### Community 37 - "Grupo menor 37"
Cohesion: 0.20
Nodes (14): Login por usuário e senha (E5), RFC-2606, checa(), igual(), UsuarioFormDialog(), handleSalvar(), UsuariosCadastro(), DOMINIO_TECNICO (+6 more)

### Community 38 - "Grupo menor 38"
Cohesion: 0.14
Nodes (17): AgenciaCadastro, AgenciaCadastroRow, alternarAtivoMototaxista(), ConvenioCadastro, ConvenioCadastroRow, MototaxistaCadastro, MototaxistaCadastroRow, salvarAgencia() (+9 more)

### Community 39 - "Grupo menor 39"
Cohesion: 0.14
Nodes (17): alternarAtivoUsuario(), buscarUsuarios(), criarUsuario(), EdicaoUsuario, editarUsuario(), lerMensagemDeErro(), NovoUsuario, PAPEL_USUARIO_LABEL (+9 more)

### Community 40 - "Grupo menor 40"
Cohesion: 0.16
Nodes (12): public.autenticar_credencial(), public.definir_pin(), public.emitir_credencial(), public.identificar_credencial(), public.log_credencial(), public.motoboy_credenciais, public.segredo_credencial(), public.agencias (+4 more)

### Community 41 - "Grupo menor 41"
Cohesion: 0.26
Nodes (13): html lang=pt-BR e translate=no, EntregasTable(), Paginacao(), paginasVisiveis(), ResumoPagina(), TAMANHO_PAGINA_HOJE, useEntregasDeHoje(), useEntregasRealtime() (+5 more)

### Community 42 - "Grupo menor 42"
Cohesion: 0.15
Nodes (11): brl(), checa(), igual(), brl(), checa(), igual(), formatBRL(), Fechamento() (+3 more)

### Community 43 - "Grupo menor 43"
Cohesion: 0.21
Nodes (13): identificarCredencial(), identificarNoCache(), selarRomaneioRetorno(), publicIdDoToken(), handleBipar(), FluxoDeRetorno(), despachar(), handleAssinarMotoboy() (+5 more)

### Community 44 - "Grupo menor 44"
Cohesion: 0.22
Nodes (14): StatusDeGravacao(), Gravacao, gravacaoEnfileirada(), useSituacaoDaOperacao(), buscarLojas(), Loja, LojaRow, useCidadeDaLoja() (+6 more)

### Community 45 - "Grupo menor 45"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 46 - "Grupo menor 46"
Cohesion: 0.19
Nodes (13): NotificacaoCard(), buscarNotificacoesHoje(), buscarTodasNotificacoes(), EventoNotificacaoRow, mapNotificacao(), Notificacao, PayloadFaltaPapel, PayloadInsucessoDetalhado (+5 more)

### Community 47 - "Grupo menor 47"
Cohesion: 0.16
Nodes (15): Agencia, AgenciaRow, buscarAgencias(), buscarEntregasPendentesSemCorrida(), buscarMototaxistas(), CorridaAberta, EntregaPendente, INSUCESSO_MOTIVO_LABEL (+7 more)

### Community 48 - "Grupo menor 48"
Cohesion: 0.22
Nodes (9): PREVISTOS, EntradaRetorno, paraJsonbRetorno(), ColisaoDePagamento, conferirIdsDePagamento(), congelarRetorno(), RetornoCongelado, RetornoNaoCongelavel (+1 more)

### Community 49 - "Grupo menor 49"
Cohesion: 0.18
Nodes (14): buscarEventosAuditoria(), EventoAuditoria, EventoAuditoriaRow, mapEvento(), resumoCredencial(), resumoEDetalhe(), resumoStatusAlterado(), STATUS_DOCUMENTAL_LABEL (+6 more)

### Community 50 - "Grupo menor 50"
Cohesion: 0.19
Nodes (14): acumularAgencia(), acumularGrupo(), AgenciaAcumulador, buscarRelatorio(), entraNoDinheiro(), EntregaRelatorioRow, FILTRO_RELATORIO_VAZIO, FiltroPeriodo (+6 more)

### Community 51 - "Grupo menor 51"
Cohesion: 0.14
Nodes (8): public.fn_corrida_autoria, public.fn_entrega_autoria, public.fn_evento_autoria, public.fn_pagamento_autoria, trg_corridas_autoria, trg_entregas_autoria, trg_eventos_autoria, trg_pagamentos_autoria

### Community 52 - "Grupo menor 52"
Cohesion: 0.14
Nodes (13): dexie, NotificarFaltaReceitaInput, NovaEntrega, NovaTransferencia, RetornoOfflineInput, SaidaOfflineInput, CredencialEmCache, ItemFilaEntregaV1 (+5 more)

### Community 53 - "Grupo menor 53"
Cohesion: 0.14
Nodes (12): entrada(), arquivo, base, casos, corpo, dir, distintos, Entrada (+4 more)

### Community 54 - "Grupo menor 54"
Cohesion: 0.20
Nodes (10): checa(), igual(), signInComUsuario(), classificarFalhaDeLogin(), FalhaDeLogin, FalhaDeLoginError, NOMES_DE_REDE, SintomaDeLogin (+2 more)

### Community 55 - "Grupo menor 55"
Cohesion: 0.15
Nodes (11): { barras }, base, caixas, conteudo, corpos, l1, l2, largAgencia (+3 more)

### Community 56 - "Grupo menor 56"
Cohesion: 0.15
Nodes (9): arquivo, dir, fim, fonte, fonteCodigo, inicio, matriz, mod (+1 more)

### Community 57 - "Grupo menor 57"
Cohesion: 0.21
Nodes (9): Alvo, codigo(), FAMILIA_A, FAMILIA_B, ler(), lerBruto(), Operacao, Situacao (+1 more)

### Community 58 - "Grupo menor 58"
Cohesion: 0.33
Nodes (9): Tabs(), TabsContent(), TabsList(), tabsListVariants, TabsTrigger(), CadastroEntrega(), Cadastros(), CadastroTransferencia() (+1 more)

### Community 59 - "Grupo menor 59"
Cohesion: 0.27
Nodes (9): validarFormasPrevistas(), normalizarEndereco(), CadastroEntregaForm(), addForma(), handleConvenioKeyDown(), handleFormaKeyDown(), handleSalvar(), resetForm() (+1 more)

### Community 60 - "Grupo menor 60"
Cohesion: 0.18
Nodes (10): Cancelamento de vale, Conflito de sincronização (romaneio em conflito), Corte limpo pré-V1 (2D.6), E12 — reserva antecipada de numeração (talonão), Fila offline (Dexie / IndexedDB), query key vales-para-saida, Regra 4 — Nunca deletar entrega, Regra 5 — UUID v7 gerado no cliente (+2 more)

### Community 61 - "Grupo menor 61"
Cohesion: 0.18
Nodes (11): Edge Function criar-usuario, Fechamento de caixa e o eixo financeiro, fn_entrega_protege_conferencia (trigger), fn_profiles_protege_campos (trigger), Gestão de usuários (painel de admin), GRANT restringe coluna; RLS não, is_admin() — escopo de filial, is_gerente() — capacidade de gestão (+3 more)

### Community 62 - "Grupo menor 62"
Cohesion: 0.24
Nodes (11): Papel que não volta — convênio e receita, Regra 6 — eventos é append-only, Regra 9 — Não armazenar medicamento (LGPD art. 11), tabela eventos, localDateStr(), RegistroAuditoria(), aplicarEsteMes(), aplicarHoje() (+3 more)

### Community 63 - "Grupo menor 63"
Cohesion: 0.27
Nodes (10): args, lerHex(), linearizar(), luminancia(), NOMEADAS, razaoDeContraste(), REFERENCIA, RGB (+2 more)

### Community 64 - "Grupo menor 64"
Cohesion: 0.24
Nodes (10): buscarFechamento(), Fechamento, FiltroFechamento, mapVale(), marcarDiaConferido(), PagamentoRow, useFechamento(), useMarcarDiaConferido() (+2 more)

### Community 65 - "Grupo menor 65"
Cohesion: 0.20
Nodes (5): abrirEnvelope(), cors, deBase64(), Envelope, Segredos

### Community 66 - "Grupo menor 66"
Cohesion: 0.20
Nodes (10): Anel de foco com contraste medido, divergiuDoPrevisto — gêmeo cliente/servidor, Duas formas de pagamento no cadastro (E4), ERP Trier, O pré-preenchimento não leva o pagamento_id, resolverValoresDasFormas — a linha não digitada absorve o resto, selar_romaneio_retorno_interno (RPC), Sistema de Tele-entrega — Farmácia (+2 more)

### Community 67 - "Grupo menor 67"
Cohesion: 0.22
Nodes (5): arquivos, cache, dia18, enviarRomaneio(), pdf()

### Community 68 - "Grupo menor 68"
Cohesion: 0.31
Nodes (5): corridas, aindaPodeEscrever(), corridasComRetornoPendente(), filtrarCorridasRetornaveis(), ItemDeFilaObservado

### Community 69 - "Grupo menor 69"
Cohesion: 0.29
Nodes (7): public.autenticar_credencial_interno(), public.definir_pin(), public.emitir_credencial(), public.identificar_credencial(), public.agencias, public.motoboy_credenciais, public.mototaxistas

### Community 70 - "Grupo menor 70"
Cohesion: 0.31
Nodes (8): autenticar_credencial (RPC), Cadeia de custódia da saída, Cartão v3 — token numérico de 22 dígitos, public_id_do_token (função SQL), assinar(), ler(), lerNoServidor(), useOnline()

### Community 71 - "Grupo menor 71"
Cohesion: 0.31
Nodes (6): @tanstack/react-query, buscarCidades(), Cidade, CidadeRow, useCidades(), queryClient

### Community 72 - "Grupo menor 72"
Cohesion: 0.53
Nodes (6): CampoMoeda(), resolverValoresDasFormas(), apenasDigitos(), centsFromDigits(), formatCentsInput(), LinhaForma

### Community 73 - "Grupo menor 73"
Cohesion: 0.22
Nodes (6): CustodiaDoValeDetalhe(), Ponto, Traco, AssinaturaDoRomaneio, AUTH_METHOD_LABEL, CustodiaDoVale

### Community 74 - "Grupo menor 74"
Cohesion: 0.25
Nodes (8): Correção posterior em três categorias, fn_entrega_imutavel (trigger de imutabilidade), Geolocalização removida em 2026-09-04, Regra 7 — Vale em romaneio selado é imutável, code128 (src/lib/code128.ts), credencialMotoboy (src/lib/credencialMotoboy.ts), marca (src/lib/marca.ts), romaneioPdf (src/lib/romaneioPdf.ts)

### Community 75 - "Grupo menor 75"
Cohesion: 0.25
Nodes (8): devDependencies, oxlint, @types/node, @types/react, @types/react-dom, typescript, vite, @vitejs/plugin-react

### Community 76 - "Grupo menor 76"
Cohesion: 0.25
Nodes (5): public.registrar_conflito_retorno(), public.romaneio_retorno_payload(), public.entregas, public.pagamentos, public.romaneios

### Community 77 - "Grupo menor 77"
Cohesion: 0.29
Nodes (7): Achado 2 — branco sobre o vermelho da marca a 4,37:1, Ponto de montagem do app (#root → src/main.tsx), favicon.svg — ícone genérico do template Vite, Cruz da marca — usada na credencial CR80, Logo de DOCUMENTO (502x80) — PDFs do acerto e do romaneio, Letreiro da logo é BRANCO — exige faixa de COR_MARCA atrás, Logo de TELA (2008x320) — cabeçalho, login, credencial

### Community 78 - "Grupo menor 78"
Cohesion: 0.38
Nodes (7): O congelamento (regra de UI da 2D), Edge Function sync-romaneio, Envelope híbrido RSA-OAEP + AES-GCM do PIN offline, Romaneio de Retorno, Romaneio de Saída, verificar_romaneio (verificador de hash), calcularOfflineEventHash()

### Community 79 - "Grupo menor 79"
Cohesion: 0.29
Nodes (7): Direção da transferência entre filiais, public.sem_acento(text) (função SQL), tabela assinaturas, tabela corridas, tabela entregas, tabela romaneios, Tarifa de entrega e vales

### Community 80 - "Grupo menor 80"
Cohesion: 0.29
Nodes (3): Pagina, Props, EstadoDeConsulta

### Community 81 - "Grupo menor 81"
Cohesion: 0.29
Nodes (5): AgenciasCadastro(), alternarAtivoAgencia(), buscarAgenciasCadastro(), useAgenciasCadastro(), useAlternarAtivoAgencia()

### Community 82 - "Grupo menor 82"
Cohesion: 0.29
Nodes (5): ConveniosCadastro(), alternarAtivoConvenio(), buscarConveniosCadastro(), useAlternarAtivoConvenio(), useConveniosCadastro()

### Community 83 - "Grupo menor 83"
Cohesion: 0.33
Nodes (6): public.documentos_esperados_do_retorno(), public.obter_contexto_retorno(), public.agencias, public.corridas, public.mototaxistas, public.romaneios

### Community 84 - "Grupo menor 84"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 85 - "Grupo menor 85"
Cohesion: 0.47
Nodes (3): ler(), lerBruto(), semComentarios()

### Community 86 - "Grupo menor 86"
Cohesion: 0.33
Nodes (4): MototaxistasCadastro(), buscarMototaxistasCadastro(), useMototaxistasCadastro(), vazioConfirmado()

### Community 87 - "Grupo menor 87"
Cohesion: 0.40
Nodes (4): cors, normalizarUsername(), PAPEIS_PERMITIDOS, validarUsername()

### Community 88 - "Grupo menor 88"
Cohesion: 0.33
Nodes (4): public.autenticar_credencial_interno(), public.selar_romaneio_sincronizado(), public.motoboy_credenciais, public.profiles

### Community 89 - "Grupo menor 89"
Cohesion: 0.33
Nodes (5): public.obter_contexto_retorno(), public.agencias, public.corridas, public.mototaxistas, public.romaneios

### Community 90 - "Grupo menor 90"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 91 - "Grupo menor 91"
Cohesion: 0.40
Nodes (3): agora, privada, publica

### Community 92 - "Grupo menor 92"
Cohesion: 0.40
Nodes (4): public.pode_ver_corrida(), public.pode_ver_entrega(), public.corridas, public.entregas

### Community 93 - "Grupo menor 93"
Cohesion: 0.40
Nodes (4): public.pode_ver_corrida(), public.pode_ver_entrega(), public.corridas, public.entregas

### Community 94 - "Grupo menor 94"
Cohesion: 0.50
Nodes (3): public.documentos_esperados_do_retorno(), public.romaneio_documentos_esperados(), public.romaneios

### Community 95 - "Grupo menor 95"
Cohesion: 0.40
Nodes (4): compilerOptions, paths, files, references

### Community 96 - "Grupo menor 96"
Cohesion: 0.50
Nodes (4): Achado 1 — anel de foco a 1,54:1 (resolvido), Compor opacidade com o fundo destrói contraste, --ring: oklch(0.6) — contraste medido nos dois temas, Zero mouse torna o foco requisito funcional

### Community 97 - "Grupo menor 97"
Cohesion: 0.67
Nodes (4): Auditoria antislop 001 — acessibilidade, Quatro erros de medição registrados na auditoria, WCAG 2.x — 4,5:1 texto normal, 3:1 não-texto, scripts/contraste.mts — checador WCAG portado para Node

### Community 103 - "Grupo menor 103"
Cohesion: 0.50
Nodes (3): @tailwindcss/vite, vite, @vitejs/plugin-react

### Community 104 - "Grupo menor 104"
Cohesion: 0.67
Nodes (3): HistoricoEntregas(), aplicarFiltros(), onEnter()

### Community 107 - "Grupo menor 107"
Cohesion: 0.67
Nodes (3): Bug da aba "Transferências" virando "s", lang="pt-BR" — trava contra tradução automática, translate="no" + meta notranslate — trava contra tradução manual

### Community 108 - "Grupo menor 108"
Cohesion: 0.67
Nodes (3): Configuração do Oxlint, React Compiler desativado por custo de build, Template Vite + React + TypeScript

## Ambiguous Edges - Review These
- `favicon.svg — ícone genérico do template Vite` → `Logo de TELA (2008x320) — cabeçalho, login, credencial`  [AMBIGUOUS]
  public/favicon.svg · relation: conceptually_related_to

## Knowledge Gaps
- **452 isolated node(s):** `$schema`, `plugins`, `react/rules-of-hooks`, `react/only-export-components`, `$schema` (+447 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 766 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `favicon.svg — ícone genérico do template Vite` and `Logo de TELA (2008x320) — cabeçalho, login, credencial`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `react` connect `Componentes de progresso e sangria` to `Diálogos e ações do vale`, `Grupo menor 34`, `Componentes de UI base`, `Fila offline e sincronização`, `Grupo menor 70`, `Grupo menor 71`, `Shell do app e layout`, `Grupo menor 72`, `Grupo menor 73`, `Divergência de pagamento`, `Grupo menor 44`, `Tabela de vales e cadastros`, `Grupo menor 41`, `Credencial, PIN e selagem`, `Grupo menor 80`, `Contexto do Romaneio de Retorno`, `Acesso a dados de entregas`, `Grupo menor 58`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `@tanstack/react-query` connect `Grupo menor 71` to `Grupo menor 64`, `Componentes de progresso e sangria`, `Grupo menor 34`, `Componentes de UI base`, `Grupo menor 35`, `Grupo menor 38`, `Grupo menor 39`, `Shell do app e layout`, `Custódia de convênio e receita`, `Credencial, PIN e selagem`, `Contexto do Romaneio de Retorno`, `Grupo menor 44`, `Grupo menor 46`, `Grupo menor 47`, `Grupo menor 49`, `Grupo menor 50`, `Acesso a dados de entregas`, `Acesso a dados de romaneios`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `formatBRL()` connect `Grupo menor 42` to `Componentes de progresso e sangria`, `Acerto, Drive e Fechamento`, `Credencial, PIN e selagem`, `Grupo menor 72`, `Grupo menor 41`, `Divergência de pagamento`, `Grupo menor 44`, `Tabela de vales e cadastros`, `Contexto do Romaneio de Retorno`, `Specs de diálogo e entregas`, `Grupo menor 49`, `Marca, datas e custódia visual`, `Grupo menor 59`, `Exportação PDF do acerto`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `$schema`, `plugins`, `react/rules-of-hooks` to the rest of the system?**
  _452 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Acerto, Drive e Fechamento` be split into smaller, more focused modules?**
  _Cohesion score 0.053555750658472345 - nodes in this community are weakly interconnected._
- **Should `Diálogos e ações do vale` be split into smaller, more focused modules?**
  _Cohesion score 0.07926829268292683 - nodes in this community are weakly interconnected._