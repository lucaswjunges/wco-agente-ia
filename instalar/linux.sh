#!/usr/bin/env bash
# Instala o agente W&Co num Ubuntu/Debian (servidor na nuvem ou notebook Linux).
#   curl -fsSL https://raw.githubusercontent.com/lucaswjunges/wco-agente-ia/main/instalar/linux.sh | bash
set -euo pipefail
echo "== 1/5 pacotes"
sudo apt-get update -qq
sudo apt-get install -y -qq git python3 tmux ffmpeg curl ca-certificates
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "== 2/5 código"
DEST="$HOME/wco-agente-ia"
if [ -d "$DEST/.git" ]; then git -C "$DEST" pull --ff-only; else git clone https://github.com/lucaswjunges/wco-agente-ia.git "$DEST"; fi
(cd "$DEST/wa" && npm ci --no-audit --no-fund)
cd "$DEST"
[ -f config.local.md ] || cp config.exemplo.md config.local.md
[ -f empresa/perfil.md ] || cp empresa/perfil.exemplo.md empresa/perfil.md
[ -f empresa/respostas.md ] || cp empresa/respostas.exemplo.md empresa/respostas.md
mkdir -p "$HOME/.wco_agente/alvos"
echo "== 3/5 Claude Code"
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
echo "== 4/5 serviços (sobem sozinhos ao ligar)"
mkdir -p "$HOME/.config/systemd/user"
cp instalar/systemd/*.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now wco-ponte
sudo loginctl enable-linger "$USER"
echo "== 5/5 pronto. Agora, nesta ordem:"
echo "  a) python3 wa/wa.py qr      -> escanear com o WhatsApp da EMPRESA (Aparelhos conectados)"
echo "  b) cd ~/wco-agente-ia && claude   -> fazer login na assinatura do Lima, aceitar a pasta, responder a entrevista do perfil; sair com /exit"
echo "  c) systemctl --user enable --now wco-agente   -> o agente passa a rodar sozinho (ver: tmux attach -t agente)"
