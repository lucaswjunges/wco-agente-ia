# Como prospectar (W&Co)

Prospecção ativa é ir atrás do cliente em vez de esperar ele chamar. O agente conversa e só passa ao dono quem tem interesse real.

## Quem procurar (em ordem de retorno esperado)
1. **Imobiliárias e corretores** da região: parceiros para vender as unidades dos empreendimentos e para indicar
   terrenos para permuta. Uma imobiliária parceira traz vários negócios.
2. **Donos de terreno / áreas para permuta** (incorporação): melhor chegar por imobiliárias, corretores e anúncios de
   terreno à venda (o anunciante publicou o telefone para ser contatado).
3. **Empresas que precisam construir**: galpão, sede, loja, ampliação (indústria, comércio, logística, clínicas, escolas).
   Sinais: empresa crescendo, vagas abertas, mudança de endereço, alvará/terreno recém-comprado.
4. **Arquitetos e escritórios de engenharia**: indicam construtora para os clientes deles.
5. **Compradores/investidores de apartamento**: só de entrada (quem chamou ou deixou contato), nunca lista fria.

## De onde tirar contatos
- Google Maps (busca "imobiliária", "arquiteto", "indústria" + cidade): telefone comercial publicado.
- Site e Instagram comercial da empresa.
- Anúncios de terreno (OLX, portais imobiliários, placas): telefone do anunciante.
- Contatos que o dono passar.
Não usar: lista comprada, dado pessoal de pessoa física sem relação comercial, grupo de WhatsApp de terceiros.

## Passo a passo de um lote
1. Montar `~/.wco_agente/alvos/NOME.json` (10 a 20 alvos por lote) no formato de `prospeccao/alvos_exemplo.json`.
   O campo `texto` é a 2ª mensagem, personalizada para cada alvo (nome da pessoa, por que a W&Co, um pedido simples).
2. Mostrar a lista e os textos ao dono. Só seguir com o "pode" dele.
3. `python3 prospeccao/lote.py etapa1 ~/.wco_agente/alvos/NOME.json --lote NOME` (manda só "Oi, bom dia!", espaçado).
4. Durante o dia: `python3 prospeccao/lote.py status NOME`.
   - `humano` → `python3 prospeccao/lote.py etapa2 NOME "Nome do alvo"` (manda o texto).
   - `robo` → escolher a opção comercial (`wa.py enviar "<jid>" --opcao N`).
   - `automatico` → "Obrigado! Fico no aguardo de quem cuida da parte comercial."
5. Quem responder com interesse: perguntar o melhor horário e avisar o dono (`[IA]`, nome + telefone + resumo).

## Modelos de 2ª mensagem (adaptar; máximo 4 linhas)
- Imobiliária: "<Nome>, aqui é o assistente da W&Co, construtora de <cidade>. Estamos com empreendimentos em andamento
  e buscando imobiliárias parceiras para venda e indicação de terrenos. Uma conversa de 15 min com o <dono> esta semana faz sentido?"
- Terreno anunciado: "<Nome>, vi o terreno no <bairro>. A W&Co é construtora e incorporadora de <cidade> e avalia
  compra ou permuta por unidades. Pode me passar metragem e valor pedido?"
- Empresa: "<Nome>, aqui é o assistente da W&Co, construtora de <cidade>. Fazemos galpões e sedes com prazo firme.
  Vocês têm alguma obra ou ampliação prevista para 2027? Posso agendar uma visita sem compromisso."
- Arquiteto: "<Nome>, aqui é o assistente da W&Co. Executamos obras com acompanhamento próximo do projeto. Podemos
  apresentar nosso trabalho para quando você precisar indicar construtora?"

## Limites (anti-bloqueio)
Seg a sex, 08:30–17:30, sem feriado. Até 12 novos por hora e 25 por dia. Uma retomada após 48 h. "Não quero" = encerrar.
