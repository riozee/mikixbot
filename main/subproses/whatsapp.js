const utils = require('../utils');
const IPC = new utils.IPC('WA', process);

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
        log(1);
        try {
            const pesan = _pesan.messages[0];
            if (!pesan.message) return;
            pesan.message = pesan.message.ephemeralMessage ? pesan.message.ephemeralMessage.message : pesan.message;
            console.log(pesan.message);
            //if (_pesan.type === 'notify') return;
            if (pesan.key?.fromMe) return;
            if (pesan.key?.remoteJid === 'status@broadcast') return;

            const uid = pesan.key?.participant || pesan.key?.remoteJid;
            const cid = pesan.key?.remoteJid;

            if (!(uid && cid)) return;

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
        log(3, pembaruan);
    });

    bot.ev.on('creds.update', saveState);
}

mulai();

async function proses(pesan) {
    log(4, pesan);
    const penerima = ID(pesan._.penerima);
    if (pesan._.hasOwnProperty('teks')) {
        await bot.sendMessage(penerima, { text: String(pesan._.teks) });
        return { s: true };
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

function kueriSubproses(subproses, argumen) {
    return new Promise((resolve, reject) => {
        const id = subproses + '#' + Math.floor(Math.random() * 100) + Date.now().toString() + '#WA';
        function responKueri(hasil) {
            if (hasil.i) {
                if (hasil.i.slice(1) === id) {
                    log(11, subproses, hasil);
                    hasil.e ? reject(hasil) : resolve(hasil);
                    process.removeListener('message', responKueri);
                }
            }
        }
        process.on('message', responKueri);
        const pesan = {
            i: 'T' + id,
            ...argumen,
        };
        log(10, subproses, pesan);
        process.send(pesan);
    });
}

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[WHATSAPP] menginisialisasi bot whatsapp`, // 0
            `[WHATSAPP] menerima pesan`, // 1
            `[WHATSAPP] mengirim pesan ke proses utama`, // 2
            `[WHATSAPP] terhubung ke bot whatsapp`, // 3
            `[WHATSAPP] menerima pesan dari proses utama`, // 4
            `[WHATSAPP] pesan terkirim ke whatsapp`, // 5
            `[WHATSAPP] terjadi kesalahan saat mengirim pesan`, // 6
            `[WHATSAPP] terjadi kesalahan saat menerima pesan`, // 7
            `[WHATSAPP] menghubungkan ke bot whatsapp`, // 8
            `[WHATSAPP] koneksi terputus dari bot whatsapp`, // 9
            `[WHATSAPP] mengirim kueri ke`, // 10
            `[WHATSAPP] mendapat respon dari`, // 11
        ][kode],
        ...argumen2
    );
}
