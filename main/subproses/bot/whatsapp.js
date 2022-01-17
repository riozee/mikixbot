const utils = require('../../utils');
const IPC = new utils.IPC('WA', process);
const fetch = require('node-fetch');
const fs = require('fs/promises');

const argv = JSON.parse(process.argv[2]);

const cache = [];

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

            let $pesan = {
                pengirim: uid === cid ? IDPengguna(uid) : IDChat(cid),
                uid: IDPengguna(uid),
                mid: pesan.key.id,
            };

            function muatPesan(tipe, isi) {
                const _ = {};

                const teks =
                    (typeof isi === 'string' ? isi : '') || isi.caption || isi.text || isi.singleSelectReply?.selectedRowId || isi.selectedButtonId || '';
                if (teks) _.teks = teks;

                if (tipe === 'imageMessage') {
                    _.gambar = `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|image|jpg`;
                } else if (tipe === 'stickerMessage') {
                    _.stiker = `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|sticker|webp`;
                } else if (tipe === 'videoMessage') {
                    _.video = `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|video|mp4|${Number(isi.fileLength)}`;
                } else if (tipe === 'locationMessage' || tipe === 'liveLocationMessage') {
                    _.lokasi = `${isi.degreesLatitude}|${isi.degreesLongitude}`;
                } else if (tipe === 'audioMessage') {
                    _.audio = `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|audio|mp3|${Number(isi.fileLength)}`;
                }

                return _;
            }

            for (const tipe in pesan.message) {
                const isi = pesan.message[tipe];
                $pesan = {
                    ...$pesan,
                    ...muatPesan(tipe, isi),
                };

                if (isi.contextInfo?.quotedMessage) {
                    for (const tipe in isi.contextInfo.quotedMessage) {
                        const _isi = isi.contextInfo.quotedMessage[tipe];
                        $pesan.q = muatPesan(tipe, _isi);

                        break;
                    }
                }

                break;
            }

            log(2, $pesan);
            cache.push(pesan);
            setTimeout(
                (id) => {
                    cache.splice(
                        cache.findIndex((_pesan) => _pesan.key.id === id),
                        1
                    );
                },
                10000,
                `${pesan.key.id}`
            );
            return IPC.kirimSinyal('PR', $pesan);
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

async function kirimPesan(pesan) {
    log(4, pesan);
    const penerima = ID(pesan._.penerima);
    let opsi = {};
    if (pesan._.hasOwnProperty('re')) {
        opsi.quoted = cache.filter((_pesan) => _pesan.key.id == pesan._.mid)[0];
    }
    try {
        const msg = {};
        if (pesan._.gambar) {
            msg.image = { url: pesan._.gambar };
            msg.caption = pesan._.teks;
        } else if (pesan._.stiker) {
            msg.sticker = { url: pesan._.stiker };
        } else if (pesan._.video) {
            msg.video = { url: pesan._.video };
            msg.caption = pesan._.teks;
        } else if (pesan._.lokasi) {
            const [latitude, longitude] = pesan._.lokasi.split('|');
            msg.location = { degreesLatitude: latitude, degreesLongitude: longitude };
        } else if (pesan._.audio) {
            if (pesan._.teks) {
                await bot.sendMessage(penerima, { audio: { url: pesan._.audio } }, opsi);
                msg.text = pesan._.teks;
            } else {
                msg.audio = { url: pesan._.audio };
            }
        } else {
            msg.text = pesan._.teks;
        }
        await bot.sendMessage(penerima, msg, opsi);
        log(5);
        return { s: true };
    } catch (e) {
        log(6);
        console.error(e);
        return { s: false };
    }
}

async function unduhMedia(mediaStr) {
    let [mediaKey, directPath, url, type, ext] = mediaStr.split('|');
    mediaKey = Uint8Array.from(mediaKey.split(','));
    const stream = await downloadContentFromMessage({ mediaKey, directPath, url }, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    const keluaran = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.${ext}`;
    await fs.writeFile(keluaran, buffer);
    return keluaran;
}

process.on('message', (pesan) => {
    if (pesan.hasOwnProperty('_')) {
        if (pesan.hasOwnProperty('i')) {
            if (pesan._.hasOwnProperty('penerima')) {
                IPC.terimaDanBalasKueri(pesan, (pesan) => kirimPesan(pesan));
            } else if (pesan._.hasOwnProperty('_eval')) {
                IPC.terimaDanBalasKueri(pesan, (pesan) => utils.jalankanFn(() => eval(pesan._._eval)));
            } else if (pesan._.hasOwnProperty('unduh')) {
                IPC.terimaDanBalasKueri(pesan, async (pesan) => ({ file: await unduhMedia(pesan._.unduh) }));
            }
        } else if (pesan._.hasOwnProperty('penerima')) {
            IPC.terimaSinyal(pesan, (pesan) => kirimPesan(pesan));
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
            `[WHATSAPP] [LOG] memulai ulang proses`, // 10
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

if (argv.watch) {
    require('fs').watch(__filename, () => {
        log(10);
        process.exit();
    });
}
