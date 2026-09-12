# Pipeline do produto

## 1. Captura e consentimento

A pessoa usuária clica na extensão na aba ativa do Meet e vê um indicador de captura. A extensão não inicia captura automática.

## 2. Timing social

O detector local transforma o áudio em eventos de `speech_started` e `speech_ended` com timestamps. O gate classifica cada silêncio como pausa curta, abertura ou tempo insuficiente.

## 3. Compreensão da discussão

Após o segundo consentimento da pessoa usuária, o `offscreen document` abre WebRTC somente de áudio e encaminha a aba ao Realtime pelo relay local. O servidor cria o `RealtimeAgent` e o `RealtimeSession` do Agents SDK em um WebSocket sideband; o navegador não recebe eventos do provedor. O harness cria uma sugestão candidata em texto, não uma interrupção automática. `PASS`, texto vazio e sugestões fora do envelope curto são silêncio.

## 4. Evidência

- Contexto imediato: o que acabou de ser dito.
- Evidência externa: Exa apenas sob pedido ou quando o grupo pede validação factual.
- Contexto interno via MCP está fora desta spike e será adicionado somente como conector de leitura, depois da validação do fluxo principal.

## 5. Controle humano

Na sidebar, a pessoa facilitadora pode ver a intervenção, descartá-la, pesquisar evidência ou convidar o agente a falar localmente. Pesquisa e fala requerem simultaneamente candidato atual, abertura do gate e clique explícito; a intervenção proativa expira rapidamente; a fala não começa automaticamente. Nesta spike, a saída de voz é local à pessoa que instalou a extensão.

## 6. Resultado demonstrável

O painel mostra `listening`, `holding`, `ready` ou `speaking`, a sugestão sob revisão e o estado da evidência. O modo demo reproduz esse fluxo sem dependências externas; a demonstração ao vivo mede a passagem entre abertura detectada e ação humana.
