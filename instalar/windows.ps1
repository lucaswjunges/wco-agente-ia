# Instala o agente de IA da W&Co num notebook Windows 10/11.
# Abrir o PowerShell (Iniciar > digitar PowerShell > Enter) e colar:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
#   irm https://raw.githubusercontent.com/lucaswjunges/wco-agente-ia/main/instalar/windows.ps1 | iex
$ErrorActionPreference = 'Stop'
function Passo($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function AtualizaPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

Passo '1/6 programas (Git, Node.js, Python, FFmpeg) — pode pedir confirmação do Windows'
$pacotes = 'Git.Git', 'OpenJS.NodeJS.LTS', 'Python.Python.3.12', 'Gyan.FFmpeg'
foreach ($p in $pacotes) {
  winget install -e --id $p --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0 -and $p -ne 'Gyan.FFmpeg') { Write-Host "   (winget devolveu $LASTEXITCODE para $p; se já estava instalado, tudo bem)" }
}
AtualizaPath

Passo '2/6 código do agente'
$dest = Join-Path $env:USERPROFILE 'wco-agente-ia'
if (Test-Path (Join-Path $dest '.git')) { git -C $dest pull --ff-only }
else { git clone https://github.com/lucaswjunges/wco-agente-ia.git $dest }
Push-Location (Join-Path $dest 'wa'); npm ci --no-audit --no-fund; Pop-Location
foreach ($par in @(@('config.exemplo.md', 'config.local.md'), @('empresa\perfil.exemplo.md', 'empresa\perfil.md'), @('empresa\respostas.exemplo.md', 'empresa\respostas.md'))) {
  $de = Join-Path $dest $par[0]; $para = Join-Path $dest $par[1]
  if (-not (Test-Path $para)) { Copy-Item $de $para }
}
New-Item -ItemType Directory -Force (Join-Path $env:USERPROFILE '.wco_agente\alvos') | Out-Null

Passo '3/6 Claude Code'
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { irm https://claude.ai/install.ps1 | iex }
$bin = Join-Path $env:USERPROFILE '.local\bin'
$up = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($up -notlike "*$bin*") { [Environment]::SetEnvironmentVariable('Path', "$up;$bin", 'User') }
AtualizaPath

Passo '4/6 iniciar sozinho ao ligar o notebook'
$sh = New-Object -ComObject WScript.Shell
foreach ($pasta in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('Desktop'))) {
  $lnk = $sh.CreateShortcut((Join-Path $pasta 'Agente W&Co.lnk'))
  $lnk.TargetPath = Join-Path $dest 'iniciar.bat'; $lnk.WorkingDirectory = $dest; $lnk.Save()
}
Write-Host '   atalho criado no Inicializar e na Área de Trabalho'

Passo '5/6 não dormir na tomada (o agente para se o notebook dormir)'
$r = Read-Host '   Desligar a suspensão quando ligado na tomada? (S/n)'
if ($r -ne 'n') { powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0; Write-Host '   ok' }

Passo '6/6 pronto. Agora, nesta ordem:'
Write-Host '  a) Feche e abra o PowerShell, depois:  cd $env:USERPROFILE\wco-agente-ia ; claude'
Write-Host '     faça login com a assinatura do Lima, confirme a pasta e responda a entrevista do perfil da empresa; saia com /exit'
Write-Host '  b) Clique duas vezes no atalho "Agente W&Co" da Área de Trabalho'
Write-Host '     abre o QR: no celular da EMPRESA, WhatsApp > Aparelhos conectados > Conectar aparelho'
Write-Host '  c) Pronto: a partir de agora ele sobe sozinho quando o notebook liga.'
