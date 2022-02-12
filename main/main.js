const { jalankanFn, encodePesan, decodePesan } = require('./utils');
const fork = require('child_process').fork;
const fs = require('fs');
const fsp = require('fs/promises');

if (!fs.existsSync('./tmp/')) fs.mkdirSync('./tmp/');

const creds = JSON.parse(fs.readFileSync('./creds.json'));

setInterval(async () => {
    const files = await fsp.readdir('./tmp/');
    for (const file of files) {
        const date = Number(file.split('#')[0]);
        if (Date.now() - date > 60000 * 60) {
            await fsp.unlink('./tmp/' + file);
        }
    }
}, 60000);

const proses2 = {};

const subproses = [
    './main/subproses/database.js',
    './main/subproses/perintah.js',
    './main/subproses/rss.js',
    './main/subproses/statistic.js',
    './main/subproses/bot/whatsapp.js',
    './main/subproses/bot/telegram.js',
];
for (const proses of subproses) {
    mulaiProses(proses);
}

function mulaiProses(file) {
    log(0, file);
    logNoDev(0, file);
    proses2[file] = fork(file, [JSON.stringify(creds)]);
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
    if (pesan.endsWith('PR')) {
        teruskanKe('./main/subproses/perintah.js', pesan);
    } else if (pesan.endsWith('DB')) {
        teruskanKe('./main/subproses/database.js', pesan);
    } else if (pesan.endsWith('TG')) {
        teruskanKe('./main/subproses/bot/telegram.js', pesan);
    } else if (pesan.endsWith('WA')) {
        teruskanKe('./main/subproses/bot/whatsapp.js', pesan);
    } else if (pesan.endsWith('RS')) {
        teruskanKe('./main/subproses/rss.js', pesan);
    } else if (pesan.endsWith('ST')) {
        teruskanKe('./main/subproses/statistic.js', pesan);
    }

    //////////////////////////////
    else if (pesan.endsWith('ZZ')) {
        pesan = decodePesan(pesan);
        if (pesan.hasOwnProperty('d') && pesan.d === 'PR') {
            if (pesan.hasOwnProperty('_') && pesan._.hasOwnProperty('_eval')) {
                teruskanKe(
                    './main/subproses/perintah.js',
                    encodePesan({
                        ir: pesan.i,
                        _: await jalankanFn(() => eval(pesan._._eval)),
                    })
                );
            }
        }
    }
}

function teruskanKe(subproses, pesan) {
    log(4, subproses);
    proses2[subproses].send(pesan);
}

function log(kode, nama, ...argumen2) {
    if (!creds.dev) return;
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
    if (creds.dev) return;
    return console.log(
        [
            `[MAIN] [LOG] memulai subproses ${nama}`, // 0
            `[MAIN] [ERROR] terjadi eror di subproses ${nama}`, // 1
            `[MAIN] [ERROR] subproses ${nama} telah berhenti dengan kode:`, // 2
        ][kode],
        ...argumen2
    );
}
