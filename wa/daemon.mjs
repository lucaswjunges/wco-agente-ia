// Ponte WhatsApp -> API local em texto (Baileys, sem navegador). W&Co — agente de IA (Blumenau TI).
// Sessão e mensagens ficam em ~/.wco_agente/wa (fora do repositório). HTTP só em 127.0.0.1.
// Cliente de linha de comando: wa/wa.py
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion,
  downloadMediaMessage, jidNormalizedUser, BufferJSON,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile, execFileSync } from 'node:child_process'

// Vídeo: o Baileys só gera miniatura de 32x32 (um borrão) e não informa largura, altura nem duração; sem isso a
// prévia no WhatsApp do destinatário sai quadrada e ilegível até ele baixar. Aqui a miniatura vem do 1º quadro
// (ou de um .jpg indicado em `miniatura`) com 320 px no lado maior, e as dimensões vêm do ffprobe.
function extrasVideo(arquivo, miniatura) {
  const extra = {}
  try {
    const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=width,height:format=duration', '-of', 'json', arquivo], { encoding: 'utf8', timeout: 15000 }))
    const s = p.streams?.[0] || {}
    if (s.width && s.height) { extra.width = s.width; extra.height = s.height }
    const d = Math.round(Number(p.format?.duration))
    if (d > 0) extra.seconds = d
    const escala = (s.height || 0) >= (s.width || 0) ? 'scale=-2:320' : 'scale=320:-2'
    const origem = miniatura && fs.existsSync(miniatura) ? ['-i', miniatura] : ['-ss', '0', '-i', arquivo]
    const thumb = execFileSync('ffmpeg', ['-v', 'error', ...origem, '-frames:v', '1', '-vf', escala, '-q:v', '7',
      '-f', 'mjpeg', 'pipe:1'], { timeout: 15000, maxBuffer: 4 << 20 })
    if (thumb.length > 500 && thumb.length < 48000) extra.jpegThumbnail = thumb
  } catch (e) { /* sem ffmpeg/ffprobe: segue com a miniatura padrão do Baileys */ }
  return extra
}

const DIR = process.env.WA_DIR || path.join(os.homedir(), '.wco_agente', 'wa')
const PORT = Number(process.env.WA_PORT || 8787)
fs.mkdirSync(path.join(DIR, 'midia'), { recursive: true })
const F = n => path.join(DIR, n)
const log = pino({ level: 'warn' }, pino.destination(F('daemon.log')))
// Download de mídia cortado pela rede (ECONNRESET) solta um 'error' num stream interno do Baileys sem
// ouvinte e derrubava a ponte inteira. Só esse caso é engolido; o resto continua fatal.
process.on('uncaughtException', e => {
  if (e?.message === 'terminated' || e?.cause?.code === 'ECONNRESET') return log.warn({ err: String(e) }, 'rede cortou um download')
  console.error(e); process.exit(1)
})

// ---------- estado persistido ----------
const load = (n, d) => { try { return JSON.parse(fs.readFileSync(F(n), 'utf8'), BufferJSON.reviver) } catch { return d } }
const st = load('estado.json', { seq: 0, nomes: {}, pn: {}, lido: 0 })   // nomes: jid->nome; pn: lid->telefone
let msgs = load('msgs.json', [])          // [{s, id, chat, de, eu, t, txt, tipo}]
let brutas = load('brutas.json', {})      // id -> WAMessage (só mídia, p/ baixar depois)
let recibos = load('recibos.json', {})   // id -> status do envio (2 servidor, 3 entregue, 4 lida, 5 ouvida)
let salvarTimer = null
const salvar = () => {
  clearTimeout(salvarTimer)
  salvarTimer = setTimeout(() => {
    if (msgs.length > 20000) msgs = msgs.slice(-15000)
    const ids = Object.keys(brutas); if (ids.length > 800) for (const k of ids.slice(0, ids.length - 600)) delete brutas[k]
    fs.writeFileSync(F('estado.json'), JSON.stringify(st))
    fs.writeFileSync(F('msgs.json'), JSON.stringify(msgs))
    fs.writeFileSync(F('brutas.json'), JSON.stringify(brutas, BufferJSON.replacer))
    fs.writeFileSync(F('recibos.json'), JSON.stringify(recibos))
  }, 500)
}

let sock = null, conectado = false, qrAtual = null, eu = null
const espera = new Set()   // long-poll pendentes

const fone = jid => (jid || '').split('@')[0].split(':')[0]
// LID -> telefone: o Baileys grava o mapa em auth/lid-mapping-<lid>_reverse.json
function pnDe(jid) {
  if (!jid?.endsWith('@lid')) return null
  const p = st.pn[jid]; if (p && p.endsWith('@s.whatsapp.net')) return p
  try {
    const n = JSON.parse(fs.readFileSync(F(`auth/lid-mapping-${fone(jid)}_reverse.json`), 'utf8'))
    if (n) { st.pn[jid] = n + '@s.whatsapp.net'; return st.pn[jid] }
  } catch {}
  return null
}
function nome(jid) {
  if (!jid) return ''
  const n = st.nomes[jid]; if (n) return n
  const p = pnDe(jid); if (p && st.nomes[p]) return st.nomes[p]
  return jid.endsWith('@g.us') ? jid : '+' + fone(p || jid)
}
function setNome(jid, n, forte = false) {
  if (!jid || !n) return
  if (forte || !st.nomes[jid]) st.nomes[jid] = n
}

function texto(m) {
  const c = m.message || {}
  const inner = c.ephemeralMessage?.message || c.viewOnceMessage?.message || c.viewOnceMessageV2?.message
    || c.documentWithCaptionMessage?.message || c.editedMessage?.message?.protocolMessage?.editedMessage || c
  const x = inner
  if (x.conversation) return ['txt', x.conversation]
  if (x.extendedTextMessage) return ['txt', x.extendedTextMessage.text]
  if (x.imageMessage) return ['imagem', `[imagem] ${x.imageMessage.caption || ''}`]
  if (x.videoMessage) return ['video', `[vídeo] ${x.videoMessage.caption || ''}`]
  if (x.audioMessage) return ['audio', `[áudio ${x.audioMessage.seconds || '?'}s]`]
  if (x.documentMessage) return ['doc', `[documento ${x.documentMessage.fileName || ''}] ${x.documentMessage.caption || ''}`]
  if (x.stickerMessage) return ['sticker', '[figurinha]']
  if (x.contactMessage) return ['contato', `[contato ${x.contactMessage.displayName}] ${(x.contactMessage.vcard || '').match(/waid=(\d+)/)?.[1] || ''}`]
  if (x.contactsArrayMessage) return ['contato', (x.contactsArrayMessage.contacts || []).map(c => `[contato ${c.displayName}] ${(c.vcard || '').match(/waid=(\d+)/)?.[1] || (c.vcard || '').match(/TEL[^:]*:([+\d ()-]+)/)?.[1] || ''}`).join(' | ')]
  if (x.locationMessage) return ['local', `[local ${x.locationMessage.degreesLatitude},${x.locationMessage.degreesLongitude}]`]
  if (x.reactionMessage) return ['reacao', `[reagiu ${x.reactionMessage.text}]`]
  if (x.buttonsResponseMessage) return ['txt', x.buttonsResponseMessage.selectedDisplayText]
  if (x.listResponseMessage) return ['txt', x.listResponseMessage.title]
  // Menus de robô: mostrar as opções, para a IA escolher a comercial em vez de ver só "[listMessage]".
  if (x.listMessage) {
    const l = x.listMessage
    const op = (l.sections || []).flatMap(s => s.rows || []).map((r, i) => `${i + 1}) ${r.title}`)
    return ['txt', `[menu] ${[l.title, l.description].filter(Boolean).join(' — ')}\n${op.join(' | ')}`]
  }
  if (x.buttonsMessage) {
    const b = x.buttonsMessage
    return ['txt', `[botões] ${b.contentText || ''}\n${(b.buttons || []).map(z => z.buttonText?.displayText).filter(Boolean).join(' | ')}`]
  }
  if (x.templateMessage) {
    const h = x.templateMessage.hydratedTemplate || x.templateMessage.hydratedFourRowTemplate || {}
    const bt = (h.hydratedButtons || []).map(z => (z.quickReplyButton || z.urlButton || z.callButton)?.displayText)
    return ['txt', `[botões] ${h.hydratedContentText || ''}\n${bt.filter(Boolean).join(' | ')}`]
  }
  if (x.interactiveMessage) {
    const im = x.interactiveMessage
    const op = (im.nativeFlowMessage?.buttons || []).flatMap(z => {
      try {
        const p = JSON.parse(z.buttonParamsJson || '{}')
        return p.sections ? p.sections.flatMap(s => (s.rows || []).map(r => r.title)) : [p.display_text || p.title || z.name]
      } catch { return [z.name] }
    })
    return ['txt', `[menu] ${im.body?.text || ''}\n${op.map((t, i) => `${i + 1}) ${t}`).join(' | ')}`]
  }
  if (x.protocolMessage || x.senderKeyDistributionMessage && Object.keys(x).length === 1) return [null, null]
  const k = Object.keys(x).filter(k => k !== 'messageContextInfo')[0]
  return k ? ['outro', `[${k}]`] : [null, null]
}

function registrar(m, historico) {
  const k = m.key || {}
  let chat = k.remoteJid
  if (!chat || chat === 'status@broadcast') return null
  if (k.remoteJidAlt?.endsWith('@s.whatsapp.net')) st.pn[chat] = k.remoteJidAlt
  const [tipo, txt] = texto(m)
  if (!tipo) return null
  if (msgs.length && msgs.some(x => x.id === k.id && x.chat === chat)) return null
  const de = k.fromMe ? 'eu' : (k.participant || m.participant || k.participantAlt || chat)
  if (k.participantAlt?.endsWith('@s.whatsapp.net') && k.participant) st.pn[k.participant] = k.participantAlt
  if (!k.fromMe && m.pushName) setNome(chat.endsWith('@g.us') ? de : chat, m.pushName)
  const q = (m.message?.extendedTextMessage?.contextInfo?.quotedMessage)
  const r = {
    s: ++st.seq, id: k.id, chat, de, eu: !!k.fromMe, h: historico ? 1 : 0,
    t: Number(m.messageTimestamp || Date.now() / 1000), tipo, txt,
  }
  if (q) { const [, qt] = texto({ message: q }); if (qt) r.cit = qt.slice(0, 80) }
  msgs.push(r)
  if (['imagem', 'video', 'audio', 'doc', 'sticker'].includes(tipo)) brutas[k.id] = m
  if (!k.fromMe) { const op = opcoesMenu(m); if (op.length) menus[chat] = { m, op } }
  return r
}

// Último menu (lista ou botões) recebido de cada conversa, com o id de cada opção: robô de menu ignora texto digitado
// e só aceita a seleção (enviar com opcao=N).
const menus = {}
function opcoesMenu(m) {
  const c = m.message || {}
  const x = c.ephemeralMessage?.message || c.viewOnceMessage?.message || c.viewOnceMessageV2?.message || c
  if (x.listMessage) return (x.listMessage.sections || []).flatMap(s => s.rows || []).map(r => ({ title: r.title, id: r.rowId }))
  if (x.buttonsMessage) return (x.buttonsMessage.buttons || []).map(z => ({ title: z.buttonText?.displayText, id: z.buttonId, botao: true }))
  return []
}

function acordar() {
  for (const w of espera) { if (w.pode()) { espera.delete(w); setTimeout(w.fim, 45000) } }  // junta rajadas
}

// Disco cheio pode gravar creds.json vazio e a sessão se perdeu; guarda a última cópia boa e restaura dela
const CREDS = F('auth/creds.json'), CREDS_BAK = F('auth/creds.json.bak')
const credsOk = p => { try { return !!JSON.parse(fs.readFileSync(p, 'utf8')).me } catch { return false } }
function guardarCreds() {
  if (!credsOk(CREDS)) return
  try { fs.copyFileSync(CREDS, CREDS_BAK + '.tmp'); fs.renameSync(CREDS_BAK + '.tmp', CREDS_BAK) } catch (e) { console.log('backup do creds falhou', e.code) }
}

async function iniciar() {
  if (!credsOk(CREDS) && credsOk(CREDS_BAK)) { fs.copyFileSync(CREDS_BAK, CREDS); console.log('creds.json restaurado do backup') }
  const { state, saveCreds } = await useMultiFileAuthState(F('auth'))
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}))
  sock = makeWASocket({
    version, auth: state, logger: log, browser: Browsers.ubuntu('WeCo IA'),
    markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false,
  })
  sock.ev.on('creds.update', async () => { await saveCreds(); guardarCreds() })
  sock.ev.on('connection.update', async u => {
    if (u.qr) {
      qrAtual = u.qr
      await QRCode.toFile(F('qr.png'), u.qr, { width: 420, margin: 2 })
      // QR também em texto (qr.txt e no terminal), para ler pelo SSH quando roda na nuvem
      const qrTxt = await QRCode.toString(u.qr, { type: 'terminal', small: true })
      fs.writeFileSync(F('qr.txt'), qrTxt); console.log(qrTxt)
      if (!process.env.WA_NO_OPEN && !globalThis.__qrAberto) {
        globalThis.__qrAberto = 1
        const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', F('qr.png')]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [F('qr.png')]]
        execFile(cmd, args, () => {})
      }
      console.log('QR novo em', F('qr.png'), '— WhatsApp > Aparelhos conectados > Conectar aparelho')
    }
    if (u.connection === 'open') {
      conectado = true; qrAtual = null; eu = sock.user
      for (const n of ['qr.png', 'qr.txt']) { try { fs.unlinkSync(F(n)) } catch {} }
      console.log('conectado como', eu?.id, eu?.name)
      guardarCreds()
      try {
        const gs = await sock.groupFetchAllParticipating()
        for (const g of Object.values(gs)) setNome(g.id, g.subject, true)
        salvar()
      } catch {}
    }
    if (u.connection === 'close') {
      conectado = false
      const code = u.lastDisconnect?.error?.output?.statusCode
      console.log('desconectado', code)
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(F('auth'), { recursive: true, force: true })
        console.log('sessão encerrada no celular; reiniciando para novo QR')
      }
      setTimeout(iniciar, code === DisconnectReason.loggedOut ? 1000 : 3000)
    }
  })
  sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
    for (const c of contacts || []) { setNome(c.id, c.name, true); setNome(c.id, c.notify || c.verifiedName); if (c.lid && c.id) st.pn[c.lid] = c.id }
    for (const c of chats || []) setNome(c.id, c.name, true)
    for (const m of messages || []) registrar(m, true)
    salvar()
  })
  sock.ev.on('contacts.upsert', cs => { for (const c of cs) { setNome(c.id, c.name, true); setNome(c.id, c.notify) } salvar() })
  sock.ev.on('contacts.update', cs => { for (const c of cs) { if (c.name) setNome(c.id, c.name, true); else setNome(c.id, c.notify) } salvar() })
  sock.ev.on('chats.upsert', cs => { for (const c of cs) setNome(c.id, c.name, true); salvar() })
  sock.ev.on('groups.update', gs => { for (const g of gs) setNome(g.id, g.subject, true); salvar() })
  sock.ev.on('messages.update', ups => {
    let mudou = false
    for (const u of ups) { const v = u.update?.status; if (u.key?.fromMe && typeof v === 'number' && v > (recibos[u.key.id] || 0)) { recibos[u.key.id] = v; mudou = true } }
    if (mudou) salvar()
  })
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    let novo = false
    for (const m of messages) { const velha = type !== 'notify' && (Date.now() / 1000 - Number(m.messageTimestamp || 0) > 6 * 3600); const r = registrar(m, velha); if (r && (!r.eu || doCelular(r)) && !r.h) novo = true }
    salvar(); if (novo) acordar()
  })
}

// ---------- resolução de destino ----------
function resolver(to) {
  to = String(to || '').trim()
  if (!to) throw new Error('destino vazio')
  if (to.includes('@')) return to
  const dig = to.replace(/\D/g, '')
  if (dig.length >= 10 && /^[+\d\s()-]+$/.test(to)) return (dig.length <= 11 ? '55' + dig : dig) + '@s.whatsapp.net'
  const low = to.toLowerCase()
  const cands = Object.entries(st.nomes).filter(([, n]) => n && n.toLowerCase() === low)
  const parc = cands.length ? cands : Object.entries(st.nomes).filter(([, n]) => n && n.toLowerCase().includes(low))
  const uniq = [...new Set(parc.map(([j]) => j))]
  if (uniq.length === 1) return uniq[0]
  if (!uniq.length) throw new Error(`nenhum contato "${to}"`)
  throw new Error(`ambíguo "${to}": ` + uniq.slice(0, 8).map(j => `${nome(j)} <${j}>`).join(' | '))
}
// conversa pode existir como @lid e como @s.whatsapp.net: junta as duas
function mesmos(jid) {
  const s = new Set([jid]); const p0 = pnDe(jid); if (p0) s.add(p0)
  for (const [lid, pn] of Object.entries(st.pn)) { if (pn === jid) s.add(lid); if (lid === jid) s.add(pn) }
  return s
}

// ---------- formatação compacta ----------
const hh = t => new Date(t * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const linha = (r, comChat) => {
  const quem = r.eu ? (doCelular(r) ? 'EU (celular)' : 'EU') : (r.chat.endsWith('@g.us') ? nome(r.de) : '')
  const cab = comChat ? `${nome(r.chat)} <${r.chat}>` : ''
  const cit = r.cit ? ` (resp. a: "${r.cit.replace(/\s+/g, ' ')}")` : ''
  const mid = brutas[r.id] ? ` {midia:${r.id}}` : ''
  const rec = r.eu && recibos[r.id] ? ` [${({ 2: '✓', 3: '✓✓', 4: '✓✓ lida', 5: '✓✓ ouvida' })[recibos[r.id]] || recibos[r.id]}]` : ''
  return `#${r.s} ${hh(r.t)} ${cab}${cab && quem ? ' / ' : ''}${quem}: ${String(r.txt).replace(/\s*\n\s*/g, ' ⏎ ')}${cit}${mid}${rec}`
}

// ---------- HTTP ----------
const resp = (res, code, body) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(body.endsWith('\n') ? body : body + '\n') }
function lerCorpo(req) { return new Promise(ok => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { ok(JSON.parse(b || '{}')) } catch { ok({}) } }) }) }

// Grupo interno da empresa (opcional, WA_GRUPO no ambiente) acorda o /esperar; os demais grupos não
const GRUPO_SOCIOS = process.env.WA_GRUPO || ''
// Mensagem "nossa" digitada no celular (mesmo número): o Baileys gera id 3EB0..., o app do celular gera outro
// formato. Conta como nova, para o agente ver o que o dono escreveu pelo celular.
const doCelular = r => r.eu && !String(r.id).startsWith('3EB0')
function novas(desde, incluirEu, semGrupo) {
  return msgs.filter(r => r.s > desde && !r.h && (incluirEu || !r.eu || doCelular(r)) && !(semGrupo && ((r.chat.endsWith('@g.us') && r.chat !== GRUPO_SOCIOS) || r.tipo === 'reacao')))
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const q = Object.fromEntries(u.searchParams)
  try {
    if (u.pathname === '/qr') {
      try { return resp(res, 200, fs.readFileSync(F('qr.txt'), 'utf8')) } catch { return resp(res, 200, conectado ? 'já conectado' : 'sem QR ainda; aguarde alguns segundos') }
    }
    if (u.pathname === '/status') {
      const pend = novas(st.lido, false).length
      return resp(res, 200, `${conectado ? 'conectado' : (qrAtual ? 'AGUARDANDO QR em ' + F('qr.png') : 'desconectado')} | ${eu?.name || ''} ${fone(eu?.id)} | seq ${st.seq} | lido ${st.lido} | novas ${pend}`)
    }
    if (u.pathname === '/novas' || u.pathname === '/esperar') {
      const sg = u.pathname === '/esperar' && q.grupos !== '1'
      const desde = q.desde !== undefined ? Number(q.desde) : (sg ? Math.max(st.lido, st.esp || 0) : st.lido)
      const pode = () => novas(desde, q.eu === '1', sg).length > 0
      const fim = () => {
        const rs = novas(desde, q.eu === '1', sg)
        // agrupa por conversa, mostra só as últimas N por conversa
        const por = new Map(); for (const r of rs) { if (!por.has(r.chat)) por.set(r.chat, []); por.get(r.chat).push(r) }
        const out = []
        for (const [c, l] of por) { out.push(`== ${nome(c)} <${c}> (${l.length})`); for (const r of l.slice(-Number(q.max || 6))) out.push(linha(r, false)) }
        const ate = rs.length ? rs[rs.length - 1].s : desde
        if (sg) { st.esp = st.seq; salvar() } else if (q.marcar !== '0') { st.lido = Math.max(st.lido, st.seq); salvar() }
        out.push(`ate ${Math.max(ate, st.seq)}`)
        resp(res, 200, out.join('\n'))
      }
      if (u.pathname === '/novas' || pode()) return fim()
      const w = { pode, fim }; espera.add(w)
      const t = setTimeout(() => { if (espera.delete(w)) resp(res, 200, `timeout\nate ${st.seq}`) }, Number(q.timeout || 3000) * 1000)
      req.on('close', () => { clearTimeout(t); espera.delete(w) })
      return
    }
    if (u.pathname === '/chat') {
      const jid = resolver(q.c); const set = mesmos(jid)
      const l = msgs.filter(r => set.has(r.chat)).sort((a, b) => a.t - b.t).slice(-Number(q.n || 15))
      return resp(res, 200, [`== ${nome(jid)} <${jid}>`, ...l.map(r => linha(r, false))].join('\n'))
    }
    if (u.pathname === '/conversas') {
      const ult = new Map(); for (const r of msgs) if (!ult.has(r.chat) || ult.get(r.chat).t <= r.t) ult.set(r.chat, r)
      let l = [...ult.values()].sort((a, b) => b.t - a.t)
      if (q.q) { const k = q.q.toLowerCase(); l = l.filter(r => nome(r.chat).toLowerCase().includes(k) || r.chat.includes(k)) }
      return resp(res, 200, l.slice(0, Number(q.n || 20)).map(r => `${hh(r.t)} ${nome(r.chat)} <${r.chat}> ${r.eu ? 'EU' : '<-'}: ${String(r.txt).slice(0, 70).replace(/\s+/g, ' ')}`).join('\n') || '(vazio)')
    }
    if (u.pathname === '/contatos') {
      const k = (q.q || '').toLowerCase()
      const l = Object.entries(st.nomes).filter(([j, n]) => (n || '').toLowerCase().includes(k) || j.includes(k)).slice(0, 25)
      return resp(res, 200, l.map(([j, n]) => `${n} <${j}>${st.pn[j] ? ' = ' + st.pn[j] : ''}`).join('\n') || '(nada)')
    }
    if (u.pathname === '/midia') {
      const m = brutas[q.id]; if (!m) return resp(res, 404, 'mídia não encontrada')
      // Com a rede cortando o download a promessa nunca resolve; 90 s e devolve erro em vez de pendurar
      const buf = await Promise.race([
        downloadMediaMessage(m, 'buffer', {}, { logger: log, reuploadRequest: sock.updateMediaMessage }),
        new Promise(ok => setTimeout(ok, 90000, null))])
      if (!buf) return resp(res, 504, 'download da mídia não terminou em 90 s (rede); tentar de novo')
      const c = m.message || {}; const x = c.documentWithCaptionMessage?.message || c.ephemeralMessage?.message || c
      const ext = x.documentMessage?.fileName?.split('.').pop() || (x.audioMessage ? 'ogg' : x.imageMessage ? 'jpg' : x.videoMessage ? 'mp4' : x.stickerMessage ? 'webp' : 'bin')
      const p = path.join(DIR, 'midia', `${q.id}.${ext}`); fs.writeFileSync(p, buf)
      return resp(res, 200, p)
    }
    if (u.pathname === '/enviar' && req.method === 'POST') {
      if (!conectado) return resp(res, 503, 'desconectado')
      const b = await lerCorpo(req); let jid = resolver(b.to)
      if (!b.arquivo && !b.opcao && (!b.text || !String(b.text).trim())) return resp(res, 400, 'texto vazio')
      // Celular antigo do Brasil fica no WhatsApp SEM o 9 extra (12 dígitos). Mandar para a forma de 13 dígitos é aceito pelo
      // servidor mas não chega a ninguém.  Por isso o destino é sempre
      // o JID que o próprio WhatsApp devolve, testando as duas formas.
      if (jid.endsWith('@s.whatsapp.net')) {
        const u = fone(jid), alt = /^55\d{2}9\d{8}$/.test(u) ? u.slice(0, 4) + u.slice(5) : /^55\d{2}[6-9]\d{7}$/.test(u) ? u.slice(0, 4) + '9' + u.slice(4) : null
        let achou = null
        for (const cand of [u, alt].filter(Boolean)) {
          const [r] = await sock.onWhatsApp(cand + '@s.whatsapp.net').catch(() => [])
          if (r?.exists) { achou = jidNormalizedUser(r.jid); break }
        }
        if (!achou) return resp(res, 400, `${jid} não tem WhatsApp (testei também ${alt || 'sem variante'})`)
        if (achou !== jid) { log.warn({ pedido: jid, canonico: achou }, 'destino trocado pelo JID canônico'); jid = achou }
      }
      const opts = {}
      if (b.cita) { const m = brutas[b.cita]; if (m) opts.quoted = m }
      let conteudo = { text: String(b.text) }
      if (b.arquivo) {
        const ext = path.extname(b.arquivo).toLowerCase()
        const mime = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.xml': 'application/xml', '.zip': 'application/zip', '.mp4': 'video/mp4' }[ext] || 'application/octet-stream'
        const buf = fs.readFileSync(b.arquivo)
        // .ogg/.opus (Opus mono) vai como mensagem de voz (PTT), não como arquivo; o texto, se houver, segue em mensagem própria.
        conteudo = ['.ogg', '.opus'].includes(ext) ? { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true }
          : mime.startsWith('image/') ? { image: buf, caption: b.text || undefined }
          : mime === 'video/mp4' ? { video: buf, mimetype: 'video/mp4', caption: b.text || undefined, ...extrasVideo(b.arquivo, b.miniatura) }
          : { document: buf, mimetype: mime, fileName: b.nome || path.basename(b.arquivo), caption: b.text || undefined }
      }
      if (b.opcao) {
        const set = mesmos(jid), mn = menus[Object.keys(menus).find(c => set.has(c))]
        if (!mn) return resp(res, 400, 'esse contato não mandou menu desde que a ponte subiu: peça o menu de novo')
        const i = Number(b.opcao) - 1, o = mn.op[i]
        if (!o) return resp(res, 400, `opção ${b.opcao} não existe (1 a ${mn.op.length})`)
        conteudo = o.botao ? { buttonReply: { displayText: o.title, id: o.id, index: i }, type: 'plain' }
          : { listReply: { title: o.title, listType: 1, singleSelectReply: { selectedRowId: o.id } } }
        opts.quoted = mn.m
      }
      const m = await sock.sendMessage(jid, conteudo, opts)
      if (typeof m.status === 'number') recibos[m.key.id] = Math.max(recibos[m.key.id] || 0, m.status)
      registrar(m, false); salvar()
      return resp(res, 200, `enviado para ${nome(jid)} <${jid}> id ${m.key.id}`)
    }
    if (u.pathname === '/apagar' && req.method === 'POST') {
      // Apaga para todos uma mensagem NOSSA (o WhatsApp só permite até ~2 dias depois do envio).
      if (!conectado) return resp(res, 503, 'desconectado')
      const b = await lerCorpo(req); const r = msgs.find(x => x.id === b.id)
      if (!r) return resp(res, 404, 'mensagem não encontrada')
      if (!r.eu) return resp(res, 400, 'só dá para apagar mensagem enviada por nós')
      await sock.sendMessage(r.chat, { delete: { remoteJid: r.chat, fromMe: true, id: r.id } })
      return resp(res, 200, `apagada para todos: ${nome(r.chat)} id ${r.id}`)
    }
    if (u.pathname === '/lido' && req.method === 'POST') {
      const b = await lerCorpo(req); const jid = resolver(b.to); const set = mesmos(jid)
      const keys = msgs.filter(r => set.has(r.chat) && !r.eu).slice(-5).map(r => ({ remoteJid: r.chat, id: r.id, participant: r.chat.endsWith('@g.us') ? r.de : undefined }))
      if (keys.length) await sock.readMessages(keys)
      return resp(res, 200, `marcado lido: ${nome(jid)}`)
    }
    if (u.pathname === '/perfil') {
      // Perfil comercial da conta (descrição, e-mail, sites, endereço), recado e nome. GET mostra; POST altera só os
      // campos enviados — os demais são relidos e reenviados, porque o WhatsApp trata o conjunto como um bloco só.
      if (!conectado) return resp(res, 503, 'desconectado')
      const meu = jidNormalizedUser(eu.id)
      if (req.method === 'POST') {
        const b = await lerCorpo(req)
        if (['description', 'email', 'address', 'websites'].some(k => b[k] !== undefined)) {
          const atual = (await sock.getBusinessProfile(meu).catch(() => null)) || {}
          const neg = { description: atual.description, email: atual.email, address: atual.address, websites: atual.website }
          for (const k of ['description', 'email', 'address', 'websites']) if (b[k] !== undefined) neg[k] = b[k]
          // o horário de atendimento vai junto no mesmo bloco, para não ser apagado pela atualização
          const cfg = atual.business_hours?.business_config
          if (cfg?.length) neg.hours = { timezone: atual.business_hours.timezone || 'America/Sao_Paulo', days: cfg.map(c => c.mode === 'specific_hours'
            ? { day: c.day_of_week, mode: c.mode, openTimeInMinutes: c.open_time, closeTimeInMinutes: c.close_time } : { day: c.day_of_week, mode: c.mode }) }
          await sock.updateBussinesProfile(neg)
        }
        if (b.status !== undefined) await sock.updateProfileStatus(String(b.status))
        if (b.nome !== undefined) await sock.updateProfileName(String(b.nome))
      }
      const p = (await sock.getBusinessProfile(meu).catch(e => ({ erro: e.message }))) || {}
      const s = await sock.fetchStatus(meu).catch(() => null)
      return resp(res, 200, JSON.stringify({ nome: eu?.name, recado: s?.[0]?.status?.status ?? null, ...p }, null, 1))
    }
    if (u.pathname === '/catalogo') {
      // Catálogo de serviços da conta. GET lista; POST {nome, descricao, preco_milesimos, imagem, url} cria um item
      // (o WhatsApp exige imagem e guarda o preço em milésimos da moeda); POST {apagar: [ids]} remove.
      if (!conectado) return resp(res, 503, 'desconectado')
      const meu = jidNormalizedUser(eu.id)
      if (req.method === 'POST') {
        const b = await lerCorpo(req)
        if (b.apagar) { const r = await sock.productDelete([].concat(b.apagar).map(String)); return resp(res, 200, `apagados: ${r.deleted}`) }
        if (!b.nome || !b.imagem) return resp(res, 400, 'catálogo: precisa de nome e imagem (caminho de arquivo)')
        // sem preço = sem a tag <price> (o Baileys só a inclui se price !== undefined); 0 apareceria como "R$ 0,00"
        const pr = await sock.productCreate({ name: String(b.nome), description: String(b.descricao || ''), price: b.preco_milesimos ? Number(b.preco_milesimos) : undefined,
          currency: 'BRL', url: b.url || undefined, isHidden: false, originCountryCode: undefined, images: [{ url: b.imagem }] })
        return resp(res, 200, `criado: ${pr.id} | ${pr.name} | ${pr.price}`)
      }
      const { products } = await sock.getCatalog({ jid: meu, limit: 50 })
      return resp(res, 200, products.map(p => `${p.id} | ${p.name} | ${p.price} ${p.currency} | ${String(p.description || '').replace(/\s+/g, ' ').slice(0, 90)}`).join('\n') || '(catálogo vazio)')
    }
    resp(res, 404, 'rotas: /qr /status /novas /esperar /chat /conversas /contatos /midia /perfil /catalogo  POST /enviar /lido /apagar /perfil /catalogo')
  } catch (e) { resp(res, 400, 'erro: ' + e.message) }
}).listen(PORT, '127.0.0.1', () => console.log('API em http://127.0.0.1:' + PORT))

iniciar()
