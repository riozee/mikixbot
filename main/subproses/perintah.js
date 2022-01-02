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

//////////////////// EVENT

process.on('message', (pesan) => {
    log(0, pesan);
    if (pesan.dari) {
        return pesanMasuk(pesan);
    }
});

async function pesanMasuk(pesan) {
    pesan.bahasa = 'id';

    if (/^[\/°•π÷×¶∆£¢€¥®><™+✓_=|~!?@#$%^&.©]/.test(pesan.teks)) {
        const _perintah = pesan.teks.split(/\s+/)[0];

        pesan.argumen = pesan.teks.replace(new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`), '');
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

function kueriSubproses(subproses, argumen) {
    return new Promise((resolve, reject) => {
        const id = subproses + '#' + Math.floor(Math.random() * 100) + Date.now().toString() + '#PR';
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
            () => `[PERINTAH] memproses teks`, // 0
            () => `[PERINTAH] terdapat perintah`, // 1
            () => `[PERINTAH] tidak ditemukan perintah`, // 2
            () => `[PERINTAH] mengeksekusi perintah "${argumen2.shift()}"`, // 3
            () => `[PERINTAH] mengembalikan hasil dari perintah "${argumen2.shift()}"`, // 4
            () => `[PERINTAH] memuat file translasi ${argumen2.shift()}`, // 5
            () => `[PERINTAH] perintah "${argumen2.shift()}" tidak ditemukan`, // 6
            () => `[PERINTAH] mengirim kueri ke "${argumen2.shift()}"`, // 7
            () => `[PERINTAH] mendapat respon dari "${argumen2.shift()}"`, // 8
        ][kode](),
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
