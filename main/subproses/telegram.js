const argv = JSON.parse(process.argv[2]);

const { Telegraf } = require('telegraf');

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
    if (pesan.ke) {
        const penerima = ID(pesan.ke);
        if (typeof pesan.teks === 'string') {
            bot.telegram
                .sendMessage(penerima, pesan.teks)
                .then((pesan) => log(5, pesan))
                .catch((eror) => log(6, eror));
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

function kueriSubproses(subproses, argumen) {
    return new Promise((resolve, reject) => {
        const id = subproses + '#' + Math.floor(Math.random() * 100) + Date.now().toString() + '#TG';
        function responKueri(hasil) {
            if (hasil.i) {
                if (hasil.i.slice(1) === id) {
                    log(8, subproses, hasil);
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
        log(7, subproses, pesan);
        process.send(pesan);
    });
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

process.on('message', async (pesan) => {
    if (pesan.hasOwnProperty('eval')) {
        process.send({
            i: 'F' + pesan.i.slice(1),
            result: require('util').format(await eval(pesan.eval)),
        });
    }
});
