const utils = require('../../utils');
const IPC = new utils.IPC('TG', process);

const fs = require('fs/promises');
const fetch = require('node-fetch');
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
            _.gambar = `${message.photo.reverse()[0].file_id}|jpg`;
        } else if (message?.sticker) {
            if (message.sticker.is_animated) {
                _.stiker = `${message.sticker.thumb.file_id}|webp`;
            } else {
                _.stiker = `${message.sticker.file_id}|webp`;
            }
        } else if (message?.video) {
            _.video = `${message.video.file_id}|mp4|${message.video.file_size}`;
        } else if (message?.location) {
            _.lokasi = `${message.location.latitude}|${message.location.longitude}`;
        }

        return _;
    }

    pesan = {
        ...pesan,
        ...muatPesan(konteks.message),
    };

    if (konteks.message.reply_to_message) {
        pesan.q = muatPesan(konteks.message.reply_to_message);
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
        opsi.reply_to_message_id = pesan._.mid;
    }

    try {
        const $pesan = pesan._;
        if ($pesan.gambar) {
            if ($pesan.teks) {
                const teksAwal = $pesan.teks.length > 1096 ? $pesan.teks.slice(0, 1096) : $pesan.teks,
                    teksSisa = $pesan.teks.length > 1096 ? $pesan.teks.slice(1096) : '';
                await bot.telegram.sendPhoto(penerima, { source: $pesan.gambar }, { ...opsi, caption: teksAwal });
                if (teksSisa) await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                await bot.telegram.sendPhoto(penerima, { source: $pesan.gambar }, opsi);
            }
        } else if ($pesan.video) {
            if ($pesan.teks) {
                const teksAwal = $pesan.teks.length > 1096 ? $pesan.teks.slice(0, 1096) : $pesan.teks,
                    teksSisa = $pesan.teks.length > 1096 ? $pesan.teks.slice(1096) : '';
                await bot.telegram.sendVideo(penerima, { source: $pesan.video }, { ...opsi, caption: teksAwal });
                if (teksSisa) await kirimPesanTeks(penerima, teksSisa, opsi);
            } else {
                await bot.telegram.sendVideo(penerima, { source: $pesan.video }, opsi);
            }
        } else if ($pesan.stiker) {
            await bot.telegram.sendSticker(penerima, { source: $pesan.stiker }, opsi);
        } else if ($pesan.lokasi) {
            const [latitude, longitude] = $pesan.lokasi.split('|');
            await bot.telegram.sendLocation(penerima, latitude, longitude, opsi);
        } else {
            await kirimPesanTeks(penerima, $pesan.teks, opsi);
        }
        log(5);
        return { s: true };
    } catch (e) {
        log(6);
        console.error(e);
        return { s: false };
    }
}

async function unduhMedia(mediaStr) {
    const [file_id, eks] = mediaStr.split('|');
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
    for (const _teks of bagiString(teks, 4096)) {
        await bot.telegram.sendMessage(penerima, _teks, opsi);
    }
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
