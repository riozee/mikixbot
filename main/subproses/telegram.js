const utils = require('../utils');
const IPC = new utils.IPC('TG', process);

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
    const pesan = {
        pengirim: uid == cid ? IDPengguna(uid) : IDChat(cid),
        uid: IDPengguna(uid),
    };

    let iniPesan = false;

    const teks = konteks.message.text ?? konteks.message.caption ?? '';
    if (teks) {
        iniPesan = true;
        pesan.teks = teks;
    }

    if (iniPesan) {
        log(2, pesan);
        return IPC.kirimSinyal('PR', pesan);
    }
});

bot.launch().then(() => log(3));

async function proses(pesan) {
    log(4, pesan);
    const penerima = ID(pesan._.penerima);
    if (pesan._.hasOwnProperty('teks')) {
        if (pesan._.teks.length > 4096) {
            for (const teks of bagiString(pesan._.teks, 4096)) {
                await bot.telegram.sendMessage(penerima, teks);
            }
        } else {
            await bot.telegram.sendMessage(penerima, pesan._.teks);
        }
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
    return 'TG#' + ID + '#C';
}

function IDPengguna(ID) {
    return 'TG#' + ID;
}

function ID(_ID) {
    return _ID.replace(/^TG#|#C$/, '');
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
            `[TELEGRAM] menginisialisasi bot telegram`, // 0
            `[TELEGRAM] menerima pesan`, // 1
            `[TELEGRAM] mengirim pesan ke proses utama`, // 2
            `[TELEGRAM] terhubung ke bot telegram`, // 3
            `[TELEGRAM] menerima pesan dari proses utama`, // 4
            `[TELEGRAM] pesan terkirim ke telegram`, // 5
            `[TELEGRAM] terjadi kesalahan saat mengirim pesan`, // 6
            `[TELEGRAM] mengirim kueri ke`, // 7
            `[TELEGRAM] mendapat respon dari`, // 8
        ][kode],
        ...argumen2
    );
}
