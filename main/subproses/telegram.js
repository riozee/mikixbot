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
        dari: uid == cid ? IDPengguna(uid) : IDChat(cid),
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
        process.send(pesan);
    }
});

bot.launch().then(() => log(3));

process.on('message', (pesan) => {
    log(4, pesan);
    const penerima = pesan.ke.replace(/^TG#|#C$/, '');
    if (pesan.teks ?? undefined) {
        bot.telegram
            .sendMessage(penerima, pesan.teks)
            .then((pesan) => log(5, pesan))
            .catch((eror) => log(6, eror));
    }
});

function IDChat(ID) {
    return 'TG#' + ID + '#C';
}

function IDPengguna(ID) {
    return 'TG#' + ID;
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
        ][kode],
        ...argumen2
    );
}
