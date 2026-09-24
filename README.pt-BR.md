# Jev Flow

**Leia em:** [English](README.md) · **Português (Brasil)**. O [guia público](https://jevflow.cloud/) também está disponível em [português](https://jevflow.cloud/pt-BR/), [espanhol](https://jevflow.cloud/es/), [francês](https://jevflow.cloud/fr/) e [alemão](https://jevflow.cloud/de/).

Jev Flow é um aplicativo Node.js independente para criar e testar fluxos com julgamentos tipados do Jev e decisões controladas por código. O Studio, Compendium, Battle Arena, Carrinho e Labs rodam localmente ou em uma instalação protegida. O guia público é apenas uma apresentação estática; não executa fluxos, modelos ou APIs.

[![Prévia animada do aplicativo Jev Flow real](media/jev-flow-walkthrough-teaser.gif)](media/jev-flow-walkthrough.webm)

O GIF mostra uma prévia. [Abra o WebM completo](media/jev-flow-walkthrough.webm), [leia as legendas em inglês](media/jev-flow-walkthrough.vtt) e [consulte a transcrição e a origem da demonstração](media/jev-flow-walkthrough-transcript.md). O vídeo usa fixtures sintéticas e regras locais; não demonstra uma chamada remota real ao Jev ou a um LLM. O README do GitHub mostra o GIF e links para o vídeo; o player completo está no guia estático após a publicação.

## Instalação local

É necessário Node.js 20 ou mais recente. Python é opcional e só serve ao adaptador Laya instalado separadamente.

~~~sh
git clone https://github.com/daltonrpj/jev-flow.git
cd jev-flow
npm ci
npm start
~~~

Abra `http://127.0.0.1:8723/`; a raiz leva ao Studio. Importe um dos [fluxos de exemplo](examples/), edite a entrada e execute sua fixture sintética para inspecionar o caminho sem credencial nem chamada de modelo. Para um julgamento real, configure o provedor desejado e escolha explicitamente a execução ao vivo. O [guia rápido](docs/quickstart.md) descreve as rotas e os primeiros passos.

| Área | Rota local | O que permite inspecionar | Limite |
| --- | --- | --- | --- |
| Studio | `/jev/flows` | Fluxos editáveis, entrada tipada, preview determinístico e trace | A fixture mostra uma rota para respostas fornecidas, não mede precisão de modelo. |
| Compendium | `/jev/flows/compendium` | Configurações geradas sob demanda, filtros, teste e instalação | **388.080** é o total certificado de configurações válidas e únicas; não são execuções. |
| Battle Arena | `/jev/battle` | Perguntas, respostas, origem, latência e uso informado | Comparações exigem respostas observadas, válidas e comparáveis. |
| Carrinho | `/jev/carrinho` | Duas pistas simuladas, decisões, reflexo local e telemetria | Uma simulação não comprova segurança de veículos reais. |
| Labs | `/jev/labs` | Exercícios de spam, evidência, resgate, xadrez e Blast Garden | O código valida regras e movimentos; propostas de modelo têm origem identificada. |
| Ship Pack | `/jev/ship` | Dez jevlets empacotados, onze gates, entradas sintéticas e relatório local | Pacote disponível não significa certificação ao vivo nesta instalação. |
| Suíte | `/jev/suite` | Doze cenários e 52 casos, com histórico e baseline de execuções completas | Precisão e custo aparecem somente após execução real. |
| Jogos | `/jev/games` | Velha, combate fictício e cidade com simulação local ou Jev explícito | O modo local não é resultado do Jev. |

O Studio também oferece chat para criar fluxos, nós de webhook, subflow, loop e tratamento de erro. O [guia das integrações](docs/ship-suite-and-integrations.md) explica autenticação, orçamento e os comandos `jev-flow ship` e `jev-flow suite`. O compositor de prompts e os julgamentos de cache/compactação só chamam o provedor quando ele está configurado e a ação é solicitada.

## Capturas reais

As seis imagens em [`media/`](media/README.md) são capturas independentes do aplicativo local em inglês, com dados sintéticos ou regras locais e sem legendas do vídeo: [Studio](media/studio-screenshot.png), [Compendium](media/compendium-screenshot.png), [Arena antes da execução](media/arena-screenshot.png), [Carrinho](media/carrinho-screenshot.png), [Labs](media/labs-screenshot.png) e [Xadrez](media/chess-screenshot.png). A Arena não mostra vencedor ou custo medido antes de executar provedores. Rotas, estados, dimensões e hashes constam no [manifesto das capturas](media/screenshots-manifest.json).

## Origem, custo e segurança

Uma resposta do Jev é evidência estruturada; a validação e o código controlam cada desvio e efeito externo. Respostas de fixture, inferência local e provedor remoto aparecem com origens distintas. Latência é medida; tokens e custo aparecem apenas quando há dados do provedor ou metadados explícitos de preço. Valores desconhecidos continuam desconhecidos. Sem chave, o provedor aparece indisponível, sem troca silenciosa.

`TYPESAFE_API_KEY` permite chamadas reais à API TypeSafe. O adaptador LLM usa `JEVFLOW_LLM_API_KEY` ou `OPENAI_API_KEY` com endpoint e modelo escolhidos explicitamente. Laya requer instalação Python e pesos locais separados. Chaves inseridas pelo Studio ficam na memória do processo e são apagadas ao reiniciar. Dados de execução e fluxos do usuário ficam fora deste checkout. Leia [arquitetura](docs/architecture.md) e [segurança](docs/security.md) antes de habilitar webhooks.

## Verificação e publicação

~~~sh
npm test
npm run catalog:certify -- --check
npm run site:build
~~~

O certificado em [`catalog-certification.json`](catalog-certification.json) comprova a contagem de configurações geradas para o fingerprint do catálogo atual; não é uma métrica de qualidade do modelo. `site:build` gera a apresentação estática em `site/dist` com uma lista restrita de arquivos públicos. A CI testa o aplicativo e gera o site, sem publicá-lo. Em `jevflow.cloud`, o guia é servido na VPS e o aplicativo Node permanece no loopback; o [runbook](docs/deploy-hostinger.md) detalha essa fronteira.
