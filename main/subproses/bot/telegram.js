const utils = require('../../utils');
const IPC = new utils.IPC('TG', process);

const fs = require('fs/promises');
const fetch = require('node-fetch');
const mime = require('mime-types');
const { Telegraf } = require('telegraf');

const argv = JSON.parse(process.argv[2]);

const TOKEN = argv.tgtoken;

log(0);
const bot = new Telegraf(TOKEN);

bot.on('new_chat_members', (konteks) => {});

bot.on('left_chat_member', (konteks) => {});

bot.on('callback_query', (konteks) => {});

bot.on('message', (konteks) => {
    log(1, konteks.message, konteks.from, konteks.chat);
    const uid = konteks.from.id;
    const cid = konteks.chat.id;

    let pesan = {
        pengirim: uid == cid ? IDPengguna(uid) : IDChat(cid),
        uid: IDPengguna(uid),
        mid: konteks.message.message_id,
    };

    function muatPesan(message) {
        const _ = {};

        const teks = message?.text || message?.caption;
        if (teks) _.teks = teks;

        if (message?.photo?.length) {
            const gambar = message.photo.reverse()[0];
            _.gambar = {
                id: gambar.file_id,
                eks: 'jpg',
                ukuran: gambar.file_size,
            };
        } else if (message?.sticker) {
            _.stiker = {
                id: message.sticker.is_animated ? message.sticker.thumb.file_id : message.sticker.file_id,
                eks: 'webp',
                ukuran: message.sticker.file_size,
                animasi: message.sticker.is_animated,
            };
        } else if (message?.video) {
            _.video = {
                id: message.video.file_id,
                eks: 'mp4',
                ukuran: message.video.file_size,
            };
        } else if (message?.video_note) {
            _.video = {
                id: message.video_note.file_id,
                eks: 'mp4',
                ukuran: message.video_note.file_size,
                tg_video_note: true,
            };
        } else if (message?.location) {
            _.lokasi = {
                lat: message.location.latitude,
                lon: message.location.longitude,
            };
        } else if (message?.audio) {
            _.audio = {
                id: message.audio.file_id,
                eks: 'mp3',
                ukuran: message.audio.file_size,
            };
        } else if (message?.document && !message?.animation) {
            const eks = message.document.file_name.split('.').reverse()[0] || '';
            _.dokumen = {
                id: message.document.file_id,
                eks: eks,
                ukuran: message.document.file_size,
                mimetype: mime.lookup(eks) || undefined,
                namaFile: message.document.file_name,
            };
        } else if (message?.contact) {
            _.kontak = [
                {
                    nama: message.contact.first_name + (message.contact.last_name ? ` ${message.contact.last_name}` : ''),
                    nomor: message.contact.phone_number,
                },
            ];
        } else if (message?.animation) {
            _.video = {
                id: message.animation.file_id,
                eks: 'mp4',
                ukuran: message.animation.file_size,
                gif: true,
            };
        }

        return _;
    }

    pesan = {
        ...pesan,
        ...muatPesan(konteks.message),
    };

    if (konteks.message.reply_to_message) {
        pesan.q = muatPesan(konteks.message.reply_to_message);
        pesan.q.mid = konteks.message.reply_to_message.message_id;
    }

    log(2, pesan);
    return IPC.kirimSinyal('PR', pesan);
});

bot.launch().then(() => log(3));

async function kirimPesan(pesan) {
    log(4, pesan);
    const penerima = ID(pesan._.penerima);
    let opsi = {};
    if (pesan._.hasOwnProperty('re')) {
        if (typeof pesan._.re === 'number') {
            opsi.reply_to_message_id = pesan._.re;
        } else {
            opsi.reply_to_message_id = pesan._.mid;
        }
    }

    try {
        const $ = pesan._;
        let m, ids;
        //////////////////////////////// GAMBAR
        if ($.gambar) {
            if ($.teks) {
                const teksAwal = $.teks.length > 1096 ? $.teks.slice(0, 1096) : $.teks,
                    teksSisa = $.teks.length > 1096 ? $.teks.slice(1096) : '';
                if ($.gambar.id) m = await bot.telegram.sendPhoto(penerima, $.gambar.id, { ...opsi, caption: teksAwal });
                else if ($.gambar.file) m = await bot.telegram.sendPhoto(penerima, { source: $.gambar.file }, { ...opsi, caption: teksAwal });
                else if ($.gambar.url) m = await bot.telegram.sendPhoto(penerima, { url: $.gambar.url }, { ...opsi, caption: teksAwal });
                if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                if ($.gambar.id) m = await bot.telegram.sendPhoto(penerima, $.gambar.id, opsi);
                else if ($.gambar.file) m = await bot.telegram.sendPhoto(penerima, { source: $.gambar.file }, opsi);
                else if ($.gambar.url) m = await bot.telegram.sendPhoto(penerima, { url: $.gambar.url }, opsi);
            }
        }

        //////////////////////////////// VIDEO
        else if ($.video) {
            if ($.video.gif) {
                if ($.teks) {
                    const teksAwal = $.teks.length > 1096 ? $.teks.slice(0, 1096) : $.teks,
                        teksSisa = $.teks.length > 1096 ? $.teks.slice(1096) : '';
                    if ($.video.id) m = await bot.telegram.sendAnimation(penerima, $.video.id, { ...opsi, caption: teksAwal });
                    else if ($.video.file) m = await bot.telegram.sendAnimation(penerima, { source: $.video.file }, { ...opsi, caption: teksAwal });
                    else if ($.video.url) m = await bot.telegram.sendAnimation(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                    if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
                } else {
                    if ($.video.id) m = await bot.telegram.sendAnimation(penerima, $.video.id, opsi);
                    else if ($.video.file) m = await bot.telegram.sendAnimation(penerima, { source: $.video.file }, opsi);
                    else if ($.video.url) m = await bot.telegram.sendAnimation(penerima, { url: $.video.url }, opsi);
                }
            } else if ($.video.tg_video_note) {
                if ($.teks) {
                    const teksAwal = $.teks.length > 1096 ? $.teks.slice(0, 1096) : $.teks,
                        teksSisa = $.teks.length > 1096 ? $.teks.slice(1096) : '';
                    if ($.video.id) m = await bot.telegram.sendVideoNote(penerima, $.video.id, { ...opsi, caption: teksAwal });
                    else if ($.video.file) m = await bot.telegram.sendVideoNote(penerima, { source: $.video.file }, { ...opsi, caption: teksAwal });
                    else if ($.video.url) m = await bot.telegram.sendVideoNote(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                    if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
                } else {
                    if ($.video.id) m = await bot.telegram.sendVideoNote(penerima, $.video.id, opsi);
                    else if ($.video.file) m = await bot.telegram.sendVideoNote(penerima, { source: $.video.file }, opsi);
                    else if ($.video.url) m = await bot.telegram.sendVideoNote(penerima, { url: $.video.url }, opsi);
                }
            } else {
                if ($.teks) {
                    const teksAwal = $.teks.length > 1096 ? $.teks.slice(0, 1096) : $.teks,
                        teksSisa = $.teks.length > 1096 ? $.teks.slice(1096) : '';
                    if ($.video.id) m = await bot.telegram.sendVideo(penerima, $.video.id, { ...opsi, caption: teksAwal });
                    else if ($.video.file) m = await bot.telegram.sendVideo(penerima, { source: $.video.file }, { ...opsi, caption: teksAwal });
                    else if ($.video.url) m = await bot.telegram.sendVideo(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                    if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
                } else {
                    if ($.video.id) m = await bot.telegram.sendVideo(penerima, $.video.id, opsi);
                    else if ($.video.file) m = await bot.telegram.sendVideo(penerima, { source: $.video.file }, opsi);
                    else if ($.video.url) m = await bot.telegram.sendVideo(penerima, { url: $.video.url }, opsi);
                }
            }
        }

        //////////////////////////////// STIKER
        else if ($.stiker) {
            if ($.stiker.id) m = await bot.telegram.sendSticker(penerima, $.stiker.id, { ...opsi });
            else if ($.stiker.file) m = await bot.telegram.sendSticker(penerima, { source: $.stiker.file }, { ...opsi });
            else if ($.stiker.url) m = await bot.telegram.sendSticker(penerima, { url: $.stiker.url }, { ...opsi });
        }

        //////////////////////////////// LOKASI
        else if ($.lokasi) {
            m = await bot.telegram.sendLocation(penerima, $.lokasi.lat, $.lokasi.lon, opsi);
        }

        //////////////////////////////// AUDIO
        else if ($.audio) {
            if ($.teks) {
                const teksAwal = $.teks.length > 1096 ? $.teks.slice(0, 1096) : $.teks,
                    teksSisa = $.teks.length > 1096 ? $.teks.slice(1096) : '';
                if ($.audio.id) m = await bot.telegram.sendAudio(penerima, $.audio.id, { ...opsi, caption: teksAwal });
                else if ($.audio.file) m = await bot.telegram.sendAudio(penerima, { source: $.audio.file }, { ...opsi, caption: teksAwal });
                else if ($.audio.url) m = await bot.telegram.sendAudio(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                if ($.audio.id) m = await bot.telegram.sendAudio(penerima, $.audio.id, opsi);
                else if ($.audio.file) m = await bot.telegram.sendAudio(penerima, { source: $.audio.file }, opsi);
                else if ($.audio.url) m = await bot.telegram.sendAudio(penerima, { url: $.audio.url }, opsi);
            }
        }

        //////////////////////////////// DOKUMEN
        else if ($.dokumen) {
            opsi.file_name = $.namaFile || undefined;
            if ($.teks) {
                const teksAwal = $.teks.length > 1096 ? $.teks.slice(0, 1096) : $.teks,
                    teksSisa = $.teks.length > 1096 ? $.teks.slice(1096) : '';
                if ($.dokumen.id) m = await bot.telegram.sendDocument(penerima, $.dokumen.id, { ...opsi, caption: teksAwal });
                else if ($.dokumen.file) m = await bot.telegram.sendDocument(penerima, { source: $.dokumen.file }, { ...opsi, caption: teksAwal });
                else if ($.dokumen.url) m = await bot.telegram.sendDocument(penerima, { url: $.video.url }, { ...opsi, caption: teksAwal });
                if (teksSisa) ids = await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                if ($.dokumen.id) m = await bot.telegram.sendDocument(penerima, $.dokumen.id, opsi);
                else if ($.dokumen.file) m = await bot.telegram.sendDocument(penerima, { source: $.dokumen.file }, opsi);
                else if ($.dokumen.url) m = await bot.telegram.sendDocument(penerima, { url: $.dokumen.url }, opsi);
            }
        }

        //////////////////////////////// KONTAK
        else if ($.kontak) {
            ids = [];
            for await (const kntk of $.kontak) {
                const nomor = kntk.nomor || kntk.nama.replace(/\D+/g, '') || '000000000000';
                ids.push(
                    (
                        await bot.telegram.sendContact(penerima, nomor, kntk.nama, {
                            ...opsi,
                            vcard: `BEGIN:VCARD\nVERSION:2.1\nFN:${kntk.nama}\nTEL;CELL:${nomor}\nEND:VCARD`,
                        })
                    ).message_id
                );
            }
        }

        //////////////////////////////// ANONYMOUS CHAT FORWARD MESSAGE
        else if ($.copy) {
            m = await bot.telegram.copyMessage(penerima, ID($.copy.from), $.copy.mid, opsi);
        }

        //////////////////////////////// TEKS
        else {
            ids = await kirimPesanTeks(penerima, $.teks, opsi);
        }
        log(5);
        return { s: true, mid: m ? [m.message_id, ...(ids || [])] : ids };
    } catch (e) {
        log(6);
        console.error(e);
        return { s: false };
    }
}

async function unduhMedia(media) {
    const [file_id, eks] = [media.id, media.eks];
    const tautan = (await bot.telegram.getFileLink(file_id)).href;
    const f = await fetch(tautan);
    const buffer = await f.buffer();
    const keluaran = `./tmp/${Date.now()}#${Math.random().toString(36).slice(2)}.${eks}`;
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
    return 'TG#' + ID + '#C';
}

function IDPengguna(ID) {
    return 'TG#' + ID;
}

function ID(_ID) {
    return _ID.replace(/^TG#|#C$/, '');
}

async function kirimPesanTeks(penerima, teks, opsi) {
    const ids = [];
    if (teks.length === 0) ids.push((await bot.telegram.sendMessage(penerima, '-', opsi)).message_id);
    else
        for (const _teks of bagiString(teks, 4096)) {
            const terkirim = await bot.telegram.sendMessage(penerima, _teks, opsi);
            ids.push(terkirim.message_id);
        }
    return ids;
}

function bagiString(teks, besar) {
    const jumlahBagian = Math.ceil(teks.length / besar);
    const bagian = new Array(jumlahBagian);
    for (let i = 0, o = 0; i < jumlahBagian; ++i, o += besar) {
        bagian[i] = teks.substr(o, besar);
    }
    return bagian;
}

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[TELEGRAM] [LOG] menginisialisasi bot`, // 0
            `[TELEGRAM] [LOG] menerima pesan`, // 1
            `[TELEGRAM] [LOG] mengirim pesan ke proses utama`, // 2
            `[TELEGRAM] [LOG] terhubung ke bot`, // 3
            `[TELEGRAM] [LOG] menerima pesan dari proses utama`, // 4
            `[TELEGRAM] [LOG] pesan terkirim`, // 5
            `[TELEGRAM] [ERROR] terjadi kesalahan saat mengirim pesan`, // 6
            `[TELEGRAM] [LOG] memulai ulang proses`, // 7
        ][kode],
        ...argumen2
    );
}

if (argv.watch) {
    require('fs').watch(__filename, () => {
        log(7);
        process.exit();
    });
}
