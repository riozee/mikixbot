const utils = require('../utils');
const IPC = new utils.IPC('WA', process);
const fetch = require('node-fetch');

const argv = JSON.parse(process.argv[2]);

log(0);
const {
    default: makeWASocket,
    useSingleFileAuthState,
    DisconnectReason,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
} = require('@adiwajshing/baileys-md');
const pino = require('pino');
const fs = require('fs');

const { state, saveState } = useSingleFileAuthState('./data/wa-session.json');

function koneksikanKeWA() {
    return makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: ['Miki', 'Safari', '1.0.0'],
        auth: state,
    });
}

log(8);
let bot = koneksikanKeWA();

function mulai() {
    if (!bot) {
        log(8);
        bot = koneksikanKeWA();
    }

    bot.ev.on('messages.upsert', async (_pesan) => {
        try {
            const pesan = _pesan.messages[0];
            if (!pesan.message) return;
            pesan.message = pesan.message.ephemeralMessage ? pesan.message.ephemeralMessage.message : pesan.message;
            //if (_pesan.type === 'notify') return;
            if (pesan.key?.fromMe) return;
            if (pesan.key?.remoteJid === 'status@broadcast') return;

            const uid = pesan.key?.participant || pesan.key?.remoteJid;
            const cid = pesan.key?.remoteJid;

            if (!(uid && cid)) return;

            log(1, pesan.message);

            let iniPesan = false;
            const $pesan = {
                pengirim: uid === cid ? IDPengguna(uid) : IDChat(cid),
                uid: IDPengguna(uid),
            };

            for (const tipe in pesan.message) {
                const isi = pesan.message[tipe];
                const teks =
                    (typeof isi === 'string' ? isi : '') ||
                    isi.caption ||
                    isi.text ||
                    isi.singleSelectReply?.selectedRowId ||
                    isi.selectedButtonId ||
                    '';

                if (teks) {
                    iniPesan = true;
                    $pesan.teks = teks;
                }

                break;
            }

            if (iniPesan) {
                log(2, $pesan);
                return IPC.kirimSinyal('PR', $pesan);
            }
        } catch (eror) {
            log(7);
            console.error(eror);
        }
    });

    bot.ev.on('connection.update', async (pembaruan) => {
        const { connection, lastDisconnect } = pembaruan;
        if (connection === 'close') {
            log(9, lastDisconnect);
            bot = null;
            if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                return mulai();
            } else {
                return;
            }
        }
        if (connection && connection !== 'connecting') {
            log(3, pembaruan);
        }
    });

    bot.ev.on('creds.update', saveState);
}

mulai();

async function proses(pesan) {
    log(4, pesan);
    const penerima = ID(pesan._.penerima);
    try {
        if (pesan._.hasOwnProperty('teks')) {
            await bot.sendMessage(penerima, { text: String(pesan._.teks) });
            log(5);
            return { s: true };
        }
    } catch (e) {
        log(6);
        console.error(e);
        return { s: false };
    }
}

process.on('message', (pesan) => {
    if (pesan.hasOwnProperty('_')) {
        if (pesan.hasOwnProperty('i')) {
            if (pesan._.hasOwnProperty('penerima')) {
                IPC.terimaDanBalasKueri(pesan, (pesan) => proses(pesan));
            } else if (pesan._.hasOwnProperty('_eval')) {
                IPC.terimaDanBalasKueri(pesan, (pesan) => utils.jalankanFn(() => eval(pesan._._eval)));
            }
        } else if (pesan._.hasOwnProperty('penerima')) {
            IPC.terimaSinyal(pesan, (pesan) => proses(pesan));
        }
    }
});

function IDChat(ID) {
    return 'WA#' + ID.replace('@g.us', '') + '#C';
}

function IDPengguna(ID) {
    return 'WA#' + ID.replace('@s.whatsapp.net', '');
}

function ID(_ID) {
    if (_ID.endsWith('#C')) {
        return _ID.replace('WA#', '').replace('#C', '') + '@g.us';
    } else {
        return _ID.replace('WA#', '') + '@s.whatsapp.net';
    }
}

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[WHATSAPP] [LOG] menginisialisasi bot`, // 0
            `[WHATSAPP] [LOG] menerima pesan`, // 1
            `[WHATSAPP] [LOG] mengirim pesan ke proses utama`, // 2
            `[WHATSAPP] [LOG] terhubung ke bot`, // 3
            `[WHATSAPP] [LOG] menerima pesan dari proses utama`, // 4
            `[WHATSAPP] [LOG] pesan terkirim`, // 5
            `[WHATSAPP] [ERROR] terjadi kesalahan saat mengirim pesan`, // 6
            `[WHATSAPP] [ERROR] terjadi kesalahan saat menerima pesan`, // 7
            `[WHATSAPP] [LOG] menghubungkan ke bot`, // 8
            `[WHATSAPP] [ERROR] koneksi terputus dari bot`, // 9
        ][kode],
        ...argumen2
    );
}

async function cekKoneksiInternet() {
    try {
        await fetch('https://www.google.com/');
        return true;
    } catch {
        return false;
    }
}
