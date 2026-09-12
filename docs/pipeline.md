# Pipeline do produto

## 1. Captura e consentimento

A pessoa usuária clica na extensão na aba ativa do Meet e vê um indicador de captura. A extensão não inicia captura automática.

## 2. Timing social

O detector local transforma o áudio em eventos de `speech_started` e `speech_ended` com timestamps. O gate classifica cada silêncio como pausa curta, abertura ou tempo insuficiente.

## 3. Compreensão da discussão

O agente mantém um resumo curto da discussão e identifica hipóteses, premissas, consenso, risco e alternativas. Ele cria uma sugestão candidata, não uma interrupção automática.

## 4. Evidência

- Contexto imediato: o que acabou de ser dito.
- Contexto interno: consulta MCP somente leitura, quando configurada e pertinente.
- Evidência externa: Exa apenas sob pedido ou quando o grupo pede validação factual.

## 5. Controle humano

Na sidebar, a equipe pode ignorar, pesquisar, pedir uma alternativa ou convidar o agente a falar. A intervenção proativa é limitada por cooldown e expira rapidamente.

## 6. Resultado demonstrável

O painel mostra `listening`, `holding`, `opening`, `speaking` ou `suppressed`, o motivo da última decisão e a latência entre abertura detectada e primeira saída de áudio.
