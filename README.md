# Counterpoint

O Counterpoint é um agente de IA projetado para apoiar reuniões de brainstorming de produtos rápidas e dinâmicas, sem interromper o fluxo da conversa. 

## O problema

O projeto vem para agregar nos brainstormings. As dificuldades comuns como a perda de sugestões, o registro impreciso de decisões e a lentidão causada por tarefas de validação (pesquisa, consulta a documentos internos, busca de precedentes), obrigam a aprovação e tomadas de decisão inadequadas ou estendem prazos de tarefas que poderiam estar finalizadas. 

## O MVP

1. Uma extensão Chrome é aberta em uma aba do Google Meet, mediante ação e consentimento explícitos da pessoa usuária.
2. Ela captura o áudio da aba e detecta localmente fala e silêncio.
3. Um gate de turn-taking permite uma intervenção apenas em uma abertura real de conversa; sugestões vencidas são descartadas.
4. A sidebar mostra uma crítica curta, uma alternativa ou uma pergunta socrática.
5. A extensão envia uma oferta WebRTC ao servidor; ele cria a chamada Realtime sem expor a chave da OpenAI ao navegador.
6. Quando a equipe pede evidência, a sidebar chama o endpoint Exa sob demanda; ele só retornará fontes reais depois que o adapter gerado no onboarding for configurado.
7. Um cenário demo reproduz a abertura, o cartão de decisão e a superfície de evidência sem Meet, chave, rede ou alegação de pesquisa real.

## Estrutura

```text
extension/  Superfície Chrome/Google Meet: captura, painel e interação humana.
server/     Relay WebRTC Realtime e contrato de evidência Exa; todos os segredos ficam aqui.
shared/     Gate de turn-taking, contratos e regras de produto testáveis.
docs/       Arquitetura, pipeline e registro de código herdado.
```

Leia [a arquitetura](docs/architecture.md), o [pipeline](docs/pipeline.md) e a [referência do starter](docs/cloud9-reference.md) antes de implementar.

## Limites deliberados do MVP

- Não há login, banco de dados ou histórico persistente entre reuniões.
- MCPs internos são uma evolução posterior, somente leitura; não fazem parte do fluxo demonstrável desta spike.
- O agente não envia mensagens, cria tickets ou altera documentos sem aprovação explícita.
- Exa é usado sob demanda para evidência externa; não para cada fala.
- Não começaremos com um add-on oficial do Google Meet. A extensão Chrome é a spike mais rápida para validar captura e timing.

## Estado atual da spike

- A captura local da aba Meet, o indicador de fala e a sidebar já existem na extensão.
- O gate de turn-taking é uma biblioteca pura, com testes para abertura, expiração e interrupção humana.
- O servidor possui um relay testado para `POST /v1/realtime/calls`; ele retorna a resposta SDP sem revelar `OPENAI_API_KEY`.
- A extensão abre WebRTC no `offscreen document` somente após um segundo gesto explícito. Ela envia o áudio da aba ao Realtime, rascunha uma intervenção em texto e deixa o gate decidir se ela fica elegível para revisão.
- Quando o gate encontra uma abertura, a pessoa facilitadora escolhe **falar localmente**, **pesquisar evidência** ou **descartar**. A fala nunca começa automaticamente.
- O modo demo exercita essa decisão com dados declaradamente sintéticos, para uma gravação confiável mesmo sem Meet ou rede.
- A rota `POST /api/research` já tem contrato, mas a implementação Exa aguarda o snippet gerado pelo [onboarding da Exa](https://dashboard.exa.ai/onboarding), conforme recomendado pela própria documentação.

## Código herdado

O diretório vizinho `../cloud9` permanece intacto como material de referência do hackathon. Nenhum de seus apps é parte deste projeto até que um trecho seja deliberadamente portado e documentado em `docs/cloud9-reference.md`.
