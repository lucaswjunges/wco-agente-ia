#!/usr/bin/env bash
# Linux/Mac sem systemd: sobe a ponte e o agente numa sessão tmux "agente" (ver com: tmux attach -t agente)
cd "$(dirname "$0")"
mkdir -p ~/.wco_agente
pgrep -f "node daemon.mjs" >/dev/null || (cd wa && nohup node daemon.mjs >> ~/.wco_agente/ponte.log 2>&1 &)
sleep 8
tmux has-session -t agente 2>/dev/null || tmux new-session -d -s agente -c "$PWD" "claude 'Comece o turno: siga o CLAUDE.md (primeira vez, se faltar algo; depois o ciclo de atendimento) e mantenha o vigia sempre rodando.'"
echo "agente rodando. Para ver: tmux attach -t agente   (sair sem parar: Ctrl+B e depois D)"
