const fs = require('fs');
const util = require('util');
const _ = require('lodash');

const argv = JSON.parse(process.argv[2]);
const teks = {};

for (const file of fs.readdirSync('./res/teks')) {
    teks[file.replace('.json', '')] = JSON.parse(
        fs.readFileSync('./res/teks/' + file)
    );
    log(5, file);
}

process.on('message', async (pesan) => {
    log(0, pesan);
    const pengirim = pesan.pengirim;
    if (/^[\/°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©]/.test(pesan.teks)) {
        const _perintah = pesan.teks.split(/\s+/)[0];
        const argumen = pesan.teks.replace(
            new RegExp(`^${_.escapeRegExp(_perintah)}\\s*`),
            ''
        );
        const perintah = _perintah.slice(1).toLowerCase();

        log(1, argumen, perintah);

        function balas(isi) {
            return process.send({
                penerima: pengirim,
                ...isi,
            });
        }

        if (perintah === 'eval') {
            if (!cekDev(pengirim)) {
                return balas({ teks: teks.id['permission/onlydev'] });
            }
            if (!argumen) {
                return balas({ teks: teks.id['command/eval/noargs'] });
            }
            let hasil;
            try {
                hasil = await eval(argumen);
            } catch (eror) {
                hasil = eror.stack ?? eror;
            } finally {
                return balas({ teks: util.format(hasil) });
            }
        }
    } else {
        log(2);
    }
});

function cekDev(id) {
    id = id.replace(/^[A-Z]{2}-/, '');
    for (const devId of argv.devids.split(',')) {
        if (id === devId) return true;
    }
    return false;
}

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[PERINTAH] memproses teks`, // 0
            `[PERINTAH] terdapat perintah`, // 1
            `[PERINTAH] tidak ditemukan perintah`, // 2
            `[PERINTAH] mengeksekusi perintah "${argumen2[0]}"`, // 3
            `[PERINTAH] mengembalikan hasil dari perintah "${argumen2[0]}"`, // 4
            `[PERINTAH] memuat file translasi ${argumen2[0]}`, // 5
        ][kode],
        ...argumen2.slice(1)
    );
}
