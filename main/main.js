const fork = require('child_process').fork;
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2));

const proses2 = {};

for (const proses of ['database', 'perintah', 'telegram', 'whatsapp']) {
    mulaiProses(proses);
}

function mulaiProses(nama) {
    log(0, nama);
    proses2[nama] = fork(`./main/subproses/${nama}.js`, [JSON.stringify(argv)]);
    proses2[nama].on('message', (pesan) => {
        log(1, nama, pesan);
        main(pesan);
    });
    proses2[nama].on('error', (eror) => {
        log(2, nama);
        console.error(eror);
    });
    proses2[nama].on('exit', (kode) => {
        log(3, nama, kode);
        delete proses2[nama];
        return mulaiProses(nama);
    });
}

async function main(pesan) {
    if (pesan.dari) {
        teruskanKe('perintah', pesan);
    }
    if (pesan.ke) {
        if (pesan.ke.startsWith('TG#')) {
            teruskanKe('telegram', pesan);
        } else if (pesan.ke.startsWith('WA#')) {
            teruskanKe('whatsapp', pesan);
        }
    }
    if (pesan.i) {
        if (pesan.i.startsWith('QDB#')) {
            teruskanKe('database', pesan);
        } else {
            if (pesan.i.endsWith('#PR')) {
                teruskanKe('perintah', pesan);
            }
        }
    }
}

function teruskanKe(subproses, pesan) {
    log(4, subproses, pesan);
    proses2[subproses].send(pesan);
}

function log(kode, nama, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[PROSES UTAMA] memulai subproses ${nama}`, // 0
            `[PROSES UTAMA] menerima pesan dari subproses ${nama}`, // 1
            `[PROSES UTAMA] terjadi eror di subproses ${nama}`, // 2
            `[PROSES UTAMA] subproses ${nama} telah berhenti dengan kode:`, // 3
            `[PROSES UTAMA] mengirim pesan ke subproses ${nama}`, // 4
        ][kode],
        ...argumen2
    );
}
