const utils = require('../utils');
const IPC = new utils.IPC('PR', process);

const fs = require('fs');
const util = require('util');
const _ = require('lodash');

//////////////////// VARS

const argv = JSON.parse(process.argv[2]);
const $teks = {};

for (const file of fs.readdirSync('./res/teks')) {
    $teks[file.replace('.json', '')] = JSON.parse(fs.readFileSync('./res/teks/' + file));
    log(5, file);
}

const DBCache = { users: [], chats: [] };

//////////////////// UTAMA

async function pesanMasuk($pesan) {
    const pesan = $pesan._;
    pesan.bahasa = 'id';

    if (/^[\/\-\\><+_=|~!?@#$%^&.]/.test(pesan.teks)) {
        const _perintah = pesan.teks.split(/\s+/)[0];

        pesan.argumen = pesan.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
        pesan.perintah = _perintah.slice(1).toLowerCase();

        log(1, pesan.argumen, pesan.perintah);

        if (Perintah.hasOwnProperty(pesan.perintah)) {
            try {
                const hasil = await Perintah[pesan.perintah](pesan);
                return IPC.kirimSinyal($pesan.d, {
                    penerima: pesan.pengirim,
                    ...hasil,
                });
            } catch (e) {
                log(9);
                console.error(e);
                return IPC.kirimSinyal($pesan.d, {
                    penerima: pesan.pengirim,
                    teks: $teks[pesan.bahasa]['system/error'],
                });
            }
        } else {
            log(6, pesan.perintah);
        }
    } else {
        log(2);
    }
}

//////////////////// PERINTAH-PERINTAH

const Perintah = {
    eval: async (pesan) => {
        if (!cekDev(pesan.uid)) {
            return { teks: $teks[pesan.bahasa]['permission/onlydev'] };
        }
        if (!pesan.argumen) {
            return { teks: $teks[pesan.bahasa]['command/eval/noargs'] };
        }
        let hasil;
        try {
            hasil = await eval(pesan.argumen);
        } catch (eror) {
            hasil = eror.stack ?? eror;
        } finally {
            return { teks: util.format(hasil) };
        }
    },
    menu: (pesan) => {
        return {
            teks: Object.keys(Perintah)
                .map((v) => '/' + v)
                .join('\n'),
        };
    },
    help: (pesan) => Perintah.menu(pesan),
};

//////////////////// FUNGSI PEMBANTU

function cekDev(id) {
    id = id.replace(/^[A-Z]{2,3}#/, '');
    for (const devId of argv.devids.split(',')) {
        if (id === devId) return true;
    }
    return false;
}

function kueriDB(koleksi, ...aksi) {
    return IPC.kirimKueri('DB', {
        koleksi: koleksi,
        aksi: aksi,
    });
}

/* const DB = {
    cariItemMenurutID: async (koleksi, ID) => {
        let h;
        if (DBCache[koleksi].length && (h = DBCache[koleksi].filter(v => v._id === ID)).length) {
            return h[0];
        } else {
            const hasil = await IPC.kirimKueri('DB', {
                koleksi: koleksi,
                aksi: [['find', { _id: ID }], 'toArray'],
            });
            if (hasil.hasOwnProperty('_e')) {
                return {_e: hasil._e }
            } else {
                if (hasil.h?.length) {
                    DBCache[koleksi].push(hasil.h[0]);
                    return hasil.h;
                } else {
                    return null;
                }
            }
        }
    },
    updateItemMenurutID: async (koleksi, ID) => {

    }
}; */

////////////////////

process.on('message', async (pesan) => {
    log(0, pesan);
    if (pesan.hasOwnProperty('_')) {
        if (pesan._.hasOwnProperty('pengirim')) {
            return await IPC.terimaSinyal(pesan, pesanMasuk);
        }
    }
});

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            () => `[PERINTAH] memproses teks`, // 0
            () => `[PERINTAH] terdapat perintah`, // 1
            () => `[PERINTAH] tidak ditemukan perintah`, // 2
            () => `[PERINTAH] mengeksekusi perintah "${argumen2.shift()}"`, // 3
            () => `[PERINTAH] mengembalikan hasil dari perintah "${argumen2.shift()}"`, // 4
            () => `[PERINTAH] memuat file translasi ${argumen2.shift()}`, // 5
            () => `[PERINTAH] perintah "${argumen2.shift()}" tidak ditemukan`, // 6
            () => `[PERINTAH] mengirim kueri ke "${argumen2.shift()}"`, // 7
            () => `[PERINTAH] mendapat respon dari "${argumen2.shift()}"`, // 8
            () => `[PERINTAH] terjadi kesalahan saat menjalankan perintah`, // 9
        ][kode](),
        ...argumen2
    );
}
