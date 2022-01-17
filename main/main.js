const { jalankanFn } = require('./utils');
const fork = require('child_process').fork;
const minimist = require('minimist');
const fs = require('fs');

if (!fs.existsSync('./tmp/')) fs.mkdirSync('./tmp/');

const argv = minimist(process.argv.slice(2));

const proses2 = {};

const subproses = ['./main/subproses/database.js', './main/subproses/perintah.js', './main/subproses/timer.js'];
if (argv.s) {
    for (const s of argv.s.split(',')) {
        subproses.push(`./main/subproses/bot/${s}.js`);
    }
}
for (const proses of subproses) {
    mulaiProses(proses);
}

function mulaiProses(file) {
    log(0, file);
    logNoDev(0, file);
    proses2[file] = fork(file, [JSON.stringify(argv)]);
    proses2[file].on('message', (pesan) => {
        log(1, file, pesan);
        main(pesan);
    });
    proses2[file].on('error', (eror) => {
        log(2, file);
        logNoDev(1, file);
        console.error(eror);
    });
    proses2[file].on('exit', (kode) => {
        log(3, file, kode);
        logNoDev(2, file, kode);
        delete proses2[file];
        return mulaiProses(file);
    });
}

async function main(pesan) {
    if (pesan.hasOwnProperty('k')) {
        if (pesan.k === 'PR') {
            teruskanKe('./main/subproses/perintah.js', pesan);
        } else if (pesan.k === 'DB') {
            teruskanKe('./main/subproses/database.js', pesan);
        } else if (pesan.k === 'TG') {
            teruskanKe('./main/subproses/bot/telegram.js', pesan);
        } else if (pesan.k === 'WA') {
            teruskanKe('./main/subproses/bot/whatsapp.js', pesan);
        }

        //////////////////////////////
        else if (pesan.k === 'MAIN') {
            if (pesan.hasOwnProperty('d') && pesan.d === 'PR') {
                if (pesan.hasOwnProperty('_') && pesan._.hasOwnProperty('_eval')) {
                    teruskanKe('./main/subproses/perintah.js', {
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
    if (argv.dev) return;
    return console.log(
        [
            `[MAIN] [LOG] memulai subproses ${nama}`, // 0
            `[MAIN] [ERROR] terjadi eror di subproses ${nama}`, // 1
            `[MAIN] [ERROR] subproses ${nama} telah berhenti dengan kode:`, // 2
        ][kode],
        ...argumen2
    );
}
