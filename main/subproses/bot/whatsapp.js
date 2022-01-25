const utils = require('../../utils');
const IPC = new utils.IPC('WA', process);
const fetch = require('node-fetch');
const fsp = require('fs/promises');
const fs = require('fs');

const argv = JSON.parse(process.argv[2]);

const cache = {
    msg: [],
};

if (!fs.existsSync('./data/wa-tmpdb.json')) fs.writeFileSync('./data/wa-tmpdb.json', '{}');
cache.anch = JSON.parse(fs.readFileSync('./data/wa-tmpdb.json'));
setInterval(() => fs.writeFileSync('./data/wa-tmpdb.json', JSON.stringify(cache.anch)), 60000);

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

                const teks = (typeof isi === 'string' ? isi : '') || isi.caption || isi.text || isi.singleSelectReply?.selectedRowId || isi.selectedButtonId || '';
                if (teks) _.teks = teks;

                if (tipe === 'imageMessage') {
                    _.gambar = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|image`,
                        ukuran: Number(isi.fileLength),
                        eks: 'jpg',
                    };
                } else if (tipe === 'stickerMessage') {
                    _.stiker = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|sticker`,
                        ukuran: Number(isi.fileLength),
                        eks: 'webp',
                        animasi: isi.isAnimated,
                    };
                } else if (tipe === 'videoMessage') {
                    _.video = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|video`,
                        ukuran: Number(isi.fileLength),
                        eks: 'mp4',
                        gif: isi.gifPlayback,
                    };
                } else if (tipe === 'locationMessage' || tipe === 'liveLocationMessage') {
                    _.lokasi = {
                        lat: isi.degreesLatitude,
                        lon: isi.degreesLongitude,
                    };
                } else if (tipe === 'audioMessage') {
                    _.audio = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|audio`,
                        ukuran: Number(isi.fileLength),
                        eks: 'mp3',
                    };
                } else if (tipe === 'documentMessage') {
                    _.dokumen = {
                        id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|document`,
                        ukuran: Number(isi.fileLength),
                        eks: isi.fileName.split('.').reverse()[0],
                        mimetype: isi.mimetype,
                        namaFile: isi.fileName,
                    };
                } else if (tipe === 'contactMessage') {
                    _.kontak = [
                        {
                            nama: isi.displayName,
                            nomor: isi.vcard.match(/TEL.*:([\+\(\)\-\. \d]+)/)?.[1],
                        },
                    ];
                } else if (tipe === 'contactsArrayMessage') {
                    _.kontak = [];
                    isi.contacts.forEach((kontak) => {
                        _.kontak.push({
                            nama: kontak.displayName,
                            nomor: kontak.vcard.match(/TEL.*:([\+\(\)\-\. \d]+)/)?.[1],
                        });
                    });
                } else if (tipe === 'productMessage') {
                    if (isi.product?.productImage) {
                        _.gambar = {
                            id: `${isi.product.productImage.mediaKey.toString()}|${isi.product.productImage.directPath}|${isi.product.productImage.url}|image`,
                            ukuran: Number(isi.product.productImage.fileLength),
                            eks: 'jpg',
                        };
                        _.teks = `${isi.product.title || ''}\n${isi.product.description || ''}\nhttps://wa.me/p/${isi.product.productId || ''}/${
                            isi.businessOwnerJid?.replace?.('@s.whatsapp.net', '') || ''
                        }`;
                        _.wa_product_message = true;
                    } else {
                        _.teks = `${isi.product?.title || ''}\n${isi.product?.description || ''}\nhttps://wa.me/p/${isi.product?.productId || ''}/${
                            isi.businessOwnerJid?.replace?.('@s.whatsapp.net', '') || ''
                        }`;
                        _.wa_product_message = true;
                    }
                } else if (tipe === 'viewOnceMessage') {
                    tipe = Object.keys(isi.message)[0];
                    isi = isi.message[tipe];
                    if (tipe === 'imageMessage') {
                        _.gambar = {
                            id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|image`,
                            ukuran: Number(isi.fileLength),
                            eks: 'jpg',
                            wa_view_once: true,
                        };
                    } else if (tipe === 'videoMessage') {
                        _.video = {
                            id: `${isi.mediaKey.toString()}|${isi.directPath}|${isi.url}|video`,
                            ukuran: Number(isi.fileLength),
                            eks: 'mp4',
                            wa_view_once: true,
                        };
                    }
                }

                return _;
            }

            for (const tipe in pesan.message) {
                if (tipe === 'senderKeyDistributionMessage') continue;
                if (tipe === 'messageContextInfo') continue;
                if (tipe === 'protocolMessage') continue;

                const isi = pesan.message[tipe];
                $pesan = {
                    ...$pesan,
                    ...muatPesan(tipe, isi),
                };
                if (isi.contextInfo?.expiration) $pesan.wa_disappearing_message = isi.contextInfo.expiration;

                if (isi.contextInfo?.quotedMessage) {
                    for (const tipe in isi.contextInfo.quotedMessage) {
                        const _isi = isi.contextInfo.quotedMessage[tipe];
                        $pesan.q = muatPesan(tipe, _isi);
                        $pesan.q.mid = isi.contextInfo.stanzaId;

                        break;
                    }
                }

                break;
            }

            log(2, $pesan);
            cache.msg.push(pesan);
            setTimeout(
                (id) => {
                    cache.msg.splice(
                        cache.msg.findIndex((_pesan) => _pesan.key.id === id),
                        1
                    );
                },
                10000,
                `${pesan.key.id}`
            );
            IPC.kirimSinyal('PR', $pesan);
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
    const $ = pesan._;
    const penerima = ID($.penerima);
    let opsi = {};
    if ($.hasOwnProperty('re')) {
        if (typeof $.re === 'string' && $.anch) {
            if (!cache.anch[$.anch.roomID]) cache.anch[$.anch.roomID] = {};
            opsi.quoted = cache.anch[$.anch.roomID][$.re];
        } else {
            opsi.quoted = cache.msg.filter((_pesan) => _pesan.key.id == $.mid)[0];
        }
    }
    if ($.wa_disappearing_message) opsi.ephemeralExpiration = $.wa_disappearing_message;

    try {
        const msg = {};
        let omsg;

        //////////////////////////////// GAMBAR
        if ($.gambar) {
            if ($.gambar.id) msg.image = { url: await unduhMedia($.gambar) };
            else if ($.gambar.file || $.gambar.url) msg.image = { url: $.gambar.file || $.gambar.url };
            msg.caption = $.teks;
            if ($.gambar.wa_view_once) msg.viewOnce = true;
        }

        //////////////////////////////// STIKER
        else if ($.stiker) {
            if ($.stiker.id) msg.sticker = { url: await unduhMedia($.stiker) };
            else if ($.stiker.file || $.stiker.url) msg.sticker = { url: $.stiker.file || $.stiker.url };
        }

        //////////////////////////////// VIDEO
        else if ($.video) {
            if ($.video.id) msg.video = { url: await unduhMedia($.video) };
            else if ($.video.file || $.video.url) msg.video = { url: $.video.file || $.video.url };
            msg.caption = $.teks;
            if ($.video.wa_view_once) msg.viewOnce = true;
            if ($.video.gif) msg.gifPlayback = true;
        }

        //////////////////////////////// LOKASI
        else if ($.lokasi) {
            msg.location = { degreesLatitude: $.lokasi.lat, degreesLongitude: $.lokasi.lon };
        }

        //////////////////////////////// AUDIO
        else if ($.audio) {
            if ($.teks) {
                if ($.audio.id) omsg = await bot.sendMessage(penerima, { audio: { url: await unduhMedia($.audio) } }, opsi);
                else if ($.audio.file || $.audio.url) omsg = await bot.sendMessage(penerima, { audio: { url: $.audio.file || $.audio.url } }, opsi);
                msg.text = $.teks;
            } else {
                if ($.audio.id) msg.audio = { url: await unduhMedia($.audio) };
                else if ($.audio.file || $.audio.url) msg.audio = { url: $.audio.file || $.audio.url };
            }
        }

        //////////////////////////////// DOKUMEN
        else if ($.dokumen) {
            if ($.teks) {
                if ($.dokumen.id)
                    omsg = await bot.sendMessage(
                        penerima,
                        { document: { url: await unduhMedia($.dokumen) }, mimetype: $.dokumen.mimetype, fileName: $.dokumen.namaFile },
                        opsi
                    );
                else if ($.dokumen.file || $.dokumen.url)
                    omsg = await bot.sendMessage(
                        penerima,
                        { document: { url: $.dokumen.file || $.dokumen.url }, mimetype: $.dokumen.mimetype, fileName: $.dokumen.namaFile },
                        opsi
                    );
                msg.text = $.teks;
            } else {
                if ($.dokumen.id) {
                    msg.document = { url: await unduhMedia($.dokumen) };
                    msg.mimetype = $.dokumen.mimetype;
                    msg.fileName = $.dokumen.namaFile;
                } else if ($.dokumen.file || $.dokumen.url) {
                    msg.document = { url: $.dokumen.file || $.dokumen.url };
                    msg.mimetype = $.dokumen.mimetype;
                    msg.fileName = $.dokumen.namaFile;
                }
            }
        }

        //////////////////////////////// KONTAK
        else if ($.kontak) {
            const kontak = [];
            for await (const kntk of $.kontak) {
                const diWA = (await bot.onWhatsApp(kntk.nomor?.replace?.(/\D+/g, '')))?.[0]?.exists;
                kontak.push({
                    displayName: kntk.nama,
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${kntk.nama}\nTEL${diWA ? `;waid=${kntk.nomor?.replace?.(/\D+/g, '')}` : ''}:${
                        kntk.nomor || '000000000000'
                    }\nEND:VCARD`,
                });
            }
            msg.contacts = { contacts: kontak };
        }

        //////////////////////////////// ANONYMOUS CHAT FORWARD MESSAGE
        else if ($.copy) {
            const _msg = cache.anch[$.copy.roomID][$.copy.msgID];
            const fmsg = generateForwardMessageContent(_msg);
            for (const tipe in fmsg) {
                if (tipe === 'senderKeyDistributionMessage') continue;
                if (tipe === 'messageContextInfo') continue;
                if (tipe === 'protocolMessage') continue;
                fmsg[tipe].contextInfo = {};
                break;
            }
            const cmsg = generateWAMessageFromContent(penerima, fmsg, opsi);
            await bot.relayMessage(penerima, cmsg.message, { messageId: cmsg.key.id });
            if ($.anch) {
                if (!cache.anch[$.anch.roomID]) cache.anch[$.anch.roomID] = {};
                cache.anch[$.anch.roomID][cmsg.key.id] = cmsg;
            }
            log(5);
            return { s: true, mid: cmsg.key.id };
        }

        //////////////////////////////// TEKS
        else {
            msg.text = $.teks;
        }
        const terkirim = await bot.sendMessage(penerima, msg, opsi);
        if ($.anch) {
            if (!cache.anch[$.anch.roomID]) cache.anch[$.anch.roomID] = {};
            cache.anch[$.anch.roomID][terkirim.key.id] = terkirim;
            if (omsg?.key?.id) cache.anch[$.anch.roomID][omsg.key.id] = omsg;
        }
        log(5);
        return { s: true, mid: [omsg?.key?.id, terkirim.key.id].filter(Boolean) };
    } catch (e) {
        log(6);
        console.error(e);
        return { s: false };
    }
}

async function unduhMedia(media) {
    let [mediaKey, directPath, url, type] = media.id.split('|');
    let ext = media.eks;
    mediaKey = Uint8Array.from(mediaKey.split(','));
    const stream = await downloadContentFromMessage({ mediaKey, directPath, url }, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }
    const keluaran = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.${ext}`;
    await fsp.writeFile(keluaran, buffer);
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
            } else if (pesan._.hasOwnProperty('isAdmin')) {
                IPC.terimaDanBalasKueri(pesan, async (pesan) => ({
                    admin: Boolean((await bot.groupMetadata(ID(pesan._.isAdmin.c))).participants.filter((v) => v.id === ID(pesan._.isAdmin.u))[0]?.admin),
                }));
            }
        } else if (pesan._.hasOwnProperty('penerima')) {
            IPC.terimaSinyal(pesan, (pesan) => kirimPesan(pesan));
        }

        //////////////////// ANONYMOUS CHAT CACHE PESAN
        else if (pesan._.hasOwnProperty('anch')) {
            if (pesan._.anch.hasOwnProperty('roomID')) {
                const roomID = pesan._.anch.roomID,
                    msgID = pesan._.anch.msgID;
                if (!cache.anch) cache.anch = {};
                const msg = cache.msg.filter((_pesan) => _pesan.key.id == msgID)[0];
                if (!cache.anch[roomID]) cache.anch[roomID] = {};
                cache.anch[roomID][msgID] = msg;
            } else if (pesan._.anch.hasOwnProperty('delRoomID')) {
                const roomID = pesan._.anch.delRoomID;
                if (cache.anch) delete cache.anch[roomID];
            }
        }
    }
});

process.on('exit', () => fs.writeFileSync('./data/wa-tmpdb.json', JSON.stringify(cache.anch)));

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
    fs.watch(__filename, () => {
        log(10);
        process.exit();
    });
}

// "fix" this.isZero error
require('long').prototype.toString = () => String(Date.now());
