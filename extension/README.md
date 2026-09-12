# Chrome extension

Esta é a superfície do usuário no MVP: uma sidebar de uma aba Google Meet. Ela usa um gesto explícito para capturar o áudio da aba e um segundo gesto explícito para iniciar o cofacilitador de voz.

## O que está implementado

- Captura de áudio da aba, sem iniciar automaticamente e sem silenciar a chamada local.
- Detector local de fala/silêncio.
- Conexão WebRTC somente de áudio do `offscreen document` ao backend local. O servidor mantém o `RealtimeAgent`/`RealtimeSession` sideband; a extensão não cria data channel nem recebe eventos brutos do provedor.
- Gate determinístico compartilhado: uma sugestão é rascunhada em texto, expira se ficar velha e só fica **elegível para revisão** após uma abertura; uma fala humana cancela imediatamente o áudio já iniciado.
- Controles explícitos para falar localmente, pesquisar evidência ou descartar uma sugestão. Não há fala automática.
- Sidebar com estados de captura, agente, gate, intervenção, evidência e transcrição da fala do agente.
- Cenário demo que não usa Meet, chave OpenAI, rede ou resultado de pesquisa real.

O áudio de saída é local à pessoa que instalou a extensão; ele **não** é injetado automaticamente no áudio compartilhado do Google Meet. A extensão não grava a reunião. O botão de evidência chama somente a rota Exa do servidor; ela retorna um estado explícito de configuração pendente até que o snippet do onboarding da Exa seja conectado.

## Teste inicial sem chave, Meet ou rede

1. Na raiz do repositório, rode `npm run build:extension`.
2. Abra `chrome://extensions`, ative *Developer mode* e escolha **Load unpacked**. Selecione esta pasta `extension/`.
3. Em qualquer aba do Chrome, clique no ícone Counterpoint. A captura acusará que a aba não é Meet, mas a sidebar abrirá normalmente.
4. Clique em **Run demo scenario**. Espere `Agent: Ready`, `Mode: Demo` e `Turn gate: Opening`.
5. Clique em **Research evidence** e confirme dois cartões com o rótulo “Demo … not a live source”. Eles são sintéticos por design.
6. Clique em **Discard suggestion** e confirme que o cartão some. Rode o cenário novamente e clique em **Speak locally**; ele simula a transição para `Speaking` e, cerca de 1,6 s depois, volta a `Listening` sem tocar áudio.

## Teste manual com Meet e OpenAI Realtime

1. Na raiz do repositório, copie `.env.example` para `.env` e preencha `OPENAI_API_KEY`.
2. Rode `npm run build:extension`, recarregue a extensão em `chrome://extensions` e copie o ID exibido para `COUNTERPOINT_ALLOWED_ORIGINS=chrome-extension://SEU_ID` em `.env`.
3. Em outra aba de terminal, na raiz do repositório, rode `npm run dev:server`.
4. Abra uma chamada do Google Meet em uma aba ativa e clique no ícone Counterpoint. A sidebar deve mostrar `Capturing` e o nível de áudio.
5. Clique em **Start voice cofacilitator**. A sidebar deve passar por `Connecting` e `Listening`.
6. Discuta uma ideia e faça uma pausa real. Se o modelo considerar que há uma crítica útil, a sidebar vai para `Holding` e depois `Ready`; ele também pode retornar `PASS`, o que é um resultado esperado.
7. Em `Ready`, escolha **Speak locally**, **Research evidence** ou **Discard suggestion**. Uma fala humana interrompe a saída local já iniciada.
8. Sem o adapter Exa configurado, **Research evidence** deve mostrar uma mensagem de configuração pendente — não fontes fictícias.
9. Use **Stop agent** ou **Stop capture** ao terminar.

Após qualquer novo `npm run build:extension`, clique em **Reload** na página `chrome://extensions` antes de testar novamente.

## Configuração de desenvolvimento

O endpoint local está em `http://127.0.0.1:8787` em `src/config.ts`. Se `COUNTERPOINT_DEMO_TOKEN` estiver definido no servidor, preencha a mesma constante apenas para uma demonstração local; ela não substitui autenticação real.

Para isolar um problema, abra `http://127.0.0.1:8787/health`: ele deve responder `{ "ok": true }`. Um erro de origem significa que o ID da extensão em `.env` não corresponde ao ID carregado pelo Chrome.

## Limitação de validação

O TypeScript, os testes do gate e os testes HTTP do relay são automatizados. A captura de uma aba Meet, a permissão do Chrome e o áudio Realtime exigem este teste manual em Chrome com uma chave OpenAI válida. O cenário demo existe para validar a superfície e os controles antes dessa etapa.
