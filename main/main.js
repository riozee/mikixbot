const fork = require('child_process').fork;
const fs = require('fs');

console.log(process.argv);

const proses2 = {};

for (const proses of [
    // 'database',
    'perintah',
    'telegram',
    // 'whatsapp',
]) {
    mulaiProses(proses);
}

function mulaiProses(nama) {
    log(0, nama);
    proses2[nama] = fork(`./main/${nama}.js`);
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
    if (pesan.pengirim) {
        log(4, 'perintah', pesan);
        proses2['perintah'].send(pesan);
    }
    if (pesan.penerima) {
        if (pesan.penerima.startsWith('TG-')) {
            log(4, 'telegram', pesan);
            proses2['telegram'].send(pesan);
        }
    }
}

function log(kode, nama, ...argumen2) {
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
