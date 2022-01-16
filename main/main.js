const { jalankanFn } = require('./utils');
const fork = require('child_process').fork;
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2));

const proses2 = {};

const subproses = ['database', 'perintah'];
if (argv.s) {
    for (const s of argv.s.split(',')) {
        subproses.push(s);
    }
}
for (const proses of subproses) {
    mulaiProses(proses);
}

function mulaiProses(nama) {
    log(0, nama);
    logNoDev(0, nama);
    proses2[nama] = fork(`./main/subproses/${nama}.js`, [JSON.stringify(argv)]);
    proses2[nama].on('message', (pesan) => {
        log(1, nama, pesan);
        main(pesan);
    });
    proses2[nama].on('error', (eror) => {
        log(2, nama);
        logNoDev(1, nama);
        console.error(eror);
    });
    proses2[nama].on('exit', (kode) => {
        log(3, nama, kode);
        logNoDev(2, nama, kode);
        delete proses2[nama];
        return mulaiProses(nama);
    });
}

async function main(pesan) {
    if (pesan.hasOwnProperty('k')) {
        if (pesan.k === 'PR') {
            teruskanKe('perintah', pesan);
        } else if (pesan.k === 'DB') {
            teruskanKe('database', pesan);
        } else if (pesan.k === 'TG') {
            teruskanKe('telegram', pesan);
        } else if (pesan.k === 'WA') {
            teruskanKe('whatsapp', pesan);
        }

        //////////////////////////////
        else if (pesan.k === 'MAIN') {
            if (pesan.hasOwnProperty('d') && pesan.d === 'PR') {
                if (pesan.hasOwnProperty('_') && pesan._.hasOwnProperty('_eval')) {
                    teruskanKe('perintah', {
                        ir: pesan.i,
                        _: await jalankanFn(() => eval(pesan._._eval)),
                    });
                }
            }
        }
    }
}

function teruskanKe(subproses, pesan) {
    log(4, subproses);
    proses2[subproses].send(pesan);
}

function log(kode, nama, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[MAIN] [LOG] memulai subproses ${nama}`, // 0
            `[MAIN] [LOG] menerima pesan dari subproses ${nama}`, // 1
            `[MAIN] [ERROR] terjadi eror di subproses ${nama}`, // 2
            `[MAIN] [ERROR] subproses ${nama} telah berhenti dengan kode:`, // 3
            `[MAIN] [LOG] mengirim pesan ke subproses ${nama}`, // 4
        ][kode],
        ...argumen2
    );
}

function logNoDev(kode, nama, ...argumen2) {
    return console.log(
        [
            `[MAIN] [LOG] memulai subproses ${nama}`, // 0
            `[MAIN] [ERROR] terjadi eror di subproses ${nama}`, // 1
            `[MAIN] [ERROR] subproses ${nama} telah berhenti dengan kode:`, // 2
        ][kode],
        ...argumen2
    );
}
