const fs = require('fs');
const util = require('util');
const _ = require('lodash');

//////////////////// VARS

const argv = JSON.parse(process.argv[2]);
const $teks = {};
const antrianDB = {};
let _idDB = 0;

for (const file of fs.readdirSync('./res/teks')) {
    $teks[file.replace('.json', '')] = JSON.parse(
        fs.readFileSync('./res/teks/' + file)
    );
    log(5, file);
}

//////////////////// EVENT

process.on('message', (pesan) => {
    log(0, pesan);
    if (pesan.dari) {
        return pesanMasuk(pesan);
    } else if (pesan.i) {
        return responDatabase(pesan);
    }
});

async function pesanMasuk(pesan) {
    pesan.bahasa = 'id';

    if (/^[\/°•π÷×¶∆£¢€¥®><™+✓_=|~!?@#$%^&.©]/.test(pesan.teks)) {
        const _perintah = pesan.teks.split(/\s+/)[0];

        pesan.argumen = pesan.teks.replace(
            new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`),
            ''
        );
        pesan.perintah = _perintah.slice(1).toLowerCase();

        log(1, pesan.argumen, pesan.perintah);

        if (pesan.perintah in Perintah) {
            const hasil = await Perintah[pesan.perintah](pesan);
            return process.send({
                ke: pesan.dari,
                ...hasil,
            });
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
};

//////////////////// FUNGSI PEMBANTU

function responDatabase(pesan) {
    log(8, pesan);
    const idDB = pesan.i.slice(1);
    for (const id in antrianDB) {
        if (idDB === id) {
            log(9);
            antrianDB[id](pesan);
            delete antrianDB[id];
            return;
        }
    }
}

function cekDev(id) {
    id = id.replace(/^[A-Z]{2,3}#/, '');
    for (const devId of argv.devids.split(',')) {
        if (id === devId) return true;
    }
    return false;
}

function db(koleksi, ...argumen) {
    return new Promise((resolve, reject) => {
        const idDB = 'DB#' + _.random(0, 9).toString() + _idDB++ + '#PR';
        antrianDB[idDB] = (hasil) => {
            log(10, hasil);
            hasil.e ? reject(hasil) : resolve(hasil);
        };
        const akhir = {
            i: 'Q' + idDB,
            k: koleksi,
            _: argumen,
        };
        log(7, akhir);
        process.send(akhir);
    });
}

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            () => `[PERINTAH] memproses teks`, // 0
            () => `[PERINTAH] terdapat perintah`, // 1
            () => `[PERINTAH] tidak ditemukan perintah`, // 2
            () => `[PERINTAH] mengeksekusi perintah "${argumen2.shift()}"`, // 3
            () =>
                `[PERINTAH] mengembalikan hasil dari perintah "${argumen2.shift()}"`, // 4
            () => `[PERINTAH] memuat file translasi ${argumen2.shift()}`, // 5
            () => `[PERINTAH] perintah "${argumen2.shift()}" tidak ditemukan`, // 6
            () => `[PERINTAH] mengirim kueri ke database`, // 7
            () => `[PERINTAH] mendapat respon dari database`, // 8
            () => `[PERINTAH] ditemukan id kueri database yang sama`, // 9
            () => `[PERINTAH] me-resolve promise dari kueri`, // 10
        ][kode](),
        ...argumen2
    );
}
