# Shared domain logic

Aqui ficará a parte que define o produto, sem dependência de Chrome, React, OpenAI ou rede:

- eventos de fala e silêncio;
- gate de turn-taking;
- contratos de sugestão, evidência e decisão;
- regras de vencimento, supressão e interrupção.

O gate precisa ser testável com sequências sintéticas de timestamps.
