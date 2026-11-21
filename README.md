# Agente de IA da W&Co: atendimento e prospecção no WhatsApp

Feito pela **Blumenau TI** para a **W&Co** (construtora → incorporadora).

O agente fica ligado no WhatsApp da empresa e faz duas coisas:

1. **Atendimento:** responde na hora quem chama, tira dúvidas com base no perfil da empresa, marca visita e avisa o dono
   quando aparece cliente quente.
2. **Prospecção ativa:** monta listas de imobiliárias, corretores, terrenos, empresas e arquitetos da região. Puxa conversa
   em duas etapas, para não ser bloqueado, e só passa ao dono quem demonstrou interesse.

Quem "pensa" é o **Claude Code**, com a assinatura do próprio Lima. O WhatsApp é ligado por uma ponte que roda no mesmo computador.

---

## Guia do Hugo (instalação)

### O que precisa antes
| Item | Observação |
|---|---|
| **Número de WhatsApp da empresa** | O ideal é um chip só da W&Co, com WhatsApp Business num celular. Se for usar o número atual ("W&Co. Sistema Construtivo", que também é o do Lima), funciona: o agente só atende contato comercial e ignora o que for pessoal. Mas no começo o Lima precisa marcar as conversas pessoais, e os avisos [IA] chegam no "Mensagem para você" dele. |
| **Assinatura do Claude** (claude.ai) | No nome do Lima. Começar no **Pro** (~US$ 20/mês); se aparecer aviso de limite com frequência, passar para o **Max** (~US$ 100/mês). Confira os preços atuais no site. |
| **Onde roda** | **Opção A:** notebook Windows do Lima, ligado na tomada no horário comercial. **Opção B:** servidor na nuvem, que fica 24 h e não depende do notebook. |

### Opção A: notebook Windows (≈ 30 min)
1. Abrir o **PowerShell** (Iniciar → digitar `PowerShell` → Enter) e colar:
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
   irm https://raw.githubusercontent.com/lucaswjunges/wco-agente-ia/main/instalar/windows.ps1 | iex
   ```
   O script instala Git, Node.js, Python, FFmpeg e o Claude Code. Também baixa este projeto em `C:\Users\<usuário>\wco-agente-ia`,
   cria o atalho **"Agente W&Co"** (Área de Trabalho e Inicializar) e pergunta se pode desligar a suspensão na tomada (responder S).
2. **Fechar e abrir o PowerShell** de novo e rodar:
   ```powershell
   cd $env:USERPROFILE\wco-agente-ia
   claude
   ```
   - Fazer login com a conta do Claude do Lima (abre o navegador).
   - Confirmar que confia na pasta.
   - O agente vai **entrevistar o Lima** para preencher o perfil da empresa: o que fazem, cidades, obras, o que não prometer,
     número dele para avisos e horários de visita. Deixar o Lima responder.
   - Sair com `/exit`.
3. Clicar duas vezes no atalho **"Agente W&Co"** da Área de Trabalho. Abrem duas janelas: a ponte, minimizada, e o agente.
   Na primeira vez aparece um **QR code** (imagem). No celular da empresa, ir em WhatsApp → ⋮ → **Aparelhos conectados**
   → **Conectar aparelho** e escanear.
4. Testar: de outro celular, mandar "Oi, quero um orçamento" para o número da empresa. O agente deve responder em 1 a 2 min.
5. Pronto. **Toda vez que o notebook ligar, o agente sobe sozinho.** Não fechar as duas janelas. A da ponte pode ficar minimizada.

### Opção B: nuvem (servidor Linux, fica 24 h)
1. Contratar uma VPS **Ubuntu 24.04** com pelo menos 2 GB de RAM (ex.: Hostinger, Contabo, Magalu Cloud, Oracle Cloud).
   Fica em torno de R$ 30 a 60/mês; conferir o preço na hora.
2. Entrar por SSH (`ssh root@IP`, criar um usuário comum se quiser) e colar:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/lucaswjunges/wco-agente-ia/main/instalar/linux.sh | bash
   ```
3. Seguir os 3 passos que o script mostra no final:
   - `python3 wa/wa.py qr`: o QR aparece no terminal; escanear com o WhatsApp da empresa.
   - `claude`: login (ele mostra um link; abrir no celular ou no notebook e colar o código), entrevista do perfil, `/exit`.
   - `systemctl --user enable --now wco-agente`: a partir daí sobe sozinho, até depois de reiniciar o servidor.
4. Ver o agente trabalhando: `tmux attach -t agente`. Para sair **sem parar**: `Ctrl+B` e depois `D`.

> Linux ou Mac em notebook: `instalar/linux.sh` (Ubuntu) ou `./iniciar.sh`, que precisa de node 20+, python3, tmux e claude.

### Acompanhar pelo celular
Na janela do agente, digitar `/remote-control`. O Lima passa a ver e conversar com o agente pelo app **Claude** no celular.

### Uso no dia a dia (para o Lima)
- O agente manda avisos começando com **[IA]** no WhatsApp pessoal do Lima: cliente quente, dúvida, reclamação e resumo às 17:30.
- Para pedir algo, escrever na janela do agente (ou pelo app Claude), por exemplo:
  - "monte uma lista de 15 imobiliárias de Blumenau para prospectar"
  - "pode disparar o lote"
  - "como estão as respostas do lote de ontem?"
  - "acrescente no perfil que agora fazemos galpão pré-moldado"
- **Prospecção só sai depois do "pode" do Lima** para cada lista nova.

### Problemas comuns
| Sintoma | O que fazer |
|---|---|
| Agente não responde | Ver se as duas janelas estão abertas. Senão, clicar no atalho "Agente W&Co". |
| "ponte fora do ar" | Fechar tudo e abrir o atalho de novo (nuvem: `systemctl --user restart wco-ponte`). |
| Pede QR de novo | O WhatsApp desconectou o aparelho: escanear de novo (`python wa/wa.py qr` ou a imagem que abre). |
| Aviso de limite do Claude | Esperar o horário indicado ou passar a assinatura para o Max. |
| Notebook dormiu | Configurar para não suspender na tomada (o instalador oferece isso). |

### Cuidados importantes
- **A ponte do WhatsApp não é oficial da Meta.** Funciona bem com uso humano, mas disparo em massa faz o número ser
  **bloqueado**. Por isso: número próprio da empresa, duas etapas, no máximo 25 contatos novos por dia, só em dia útil.
- **LGPD:** prospectar só contatos comerciais públicos ou passados pelo Lima. Quem pedir para sair é retirado na hora.
- O agente **não fecha preço, prazo nem contrato**. Isso é sempre do Lima.
- Nada de senha, Pix ou arquivo de desconhecido passa pelo agente.

---

## Estrutura
| Caminho | O que é |
|---|---|
| `CLAUDE.md` | Regras do agente: atendimento, avisos, prospecção, segurança. |
| `empresa/` | Perfil e respostas da W&Co. Os `.exemplo.md` vão para o GitHub; os preenchidos ficam só no computador. |
| `config.exemplo.md` | Dados locais: número do dono, horários de visita. Vira `config.local.md`, que não sobe. |
| `wa/daemon.mjs`, `wa/wa.py` | Ponte do WhatsApp (Baileys) com API local em `127.0.0.1:8787` e linha de comando. |
| `prospeccao/` | `lote.py` (envio em duas etapas), guia e modelo de lista. |
| `iniciar.bat` / `iniciar.sh` / `instalar/` | Início automático e instaladores (Windows, Linux/nuvem com systemd). |

Dados de conversa, sessão do WhatsApp, listas e CRM ficam em `~/.wco_agente/`, fora do repositório.

---
Blumenau TI · www.blumenauti.com.br
