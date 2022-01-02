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

log(8);
let bot = makeWASocket({
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['Miki', 'Safari', '1.0.0'],
    auth: state,
});

function mulai() {
    if (!bot) {
        log(8);
        bot = makeWASocket({
            logger: pino(),
            printQRInTerminal: true,
            browser: ['Miki', 'Safari', '1.0.0'],
            auth: state,
        });
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
                dari: uid === cid ? IDPengguna(uid) : IDChat(cid),
                uid: IDPengguna(uid),
            };

            for (const tipe in pesan.message) {
                const isi = pesan.message[tipe];
                const teks =
                    (typeof isi === 'string' ? isi : '') ||
                    isi.caption ||
                    isi.text ||
                    isi.singleSelectReply.selectedRowId ||
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
                process.send($pesan);
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

process.on('message', (pesan) => {
    log(4, pesan);
    if (pesan.ke) {
        const penerima = ID(pesan.ke);
        if (typeof pesan.teks === 'string') {
            bot.sendMessage(penerima, { text: pesan.teks })
                .then((pesan) => log(5, pesan))
                .catch((eror) => log(6, eror));
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

process.on('message', async (pesan) => {
    if (pesan.hasOwnProperty('eval')) {
        process.send({
            i: 'F' + pesan.i.slice(1),
            result: require('util').format(await eval(pesan.eval)),
        });
    }
});
