const utils = require('../utils');
const IPC = new utils.IPC('DB', process);

const { MongoClient } = require('mongodb');

const argv = JSON.parse(process.argv[2]);

log(0);
const klien = new MongoClient(argv.mongodburi);

klien.connect().then(() => log(1));

async function proses(pesan) {
    let awal = true;
    log(2, pesan);
    try {
        const db = klien.db().collection(pesan._.koleksi);
        for (const aksi of pesan._.aksi) {
            const [metode, ...argumen] = Array.isArray(aksi) ? aksi : [aksi, []];
            if (awal) {
                hasil = await db[metode](...argumen);
                awal = false;
            } else {
                hasil = await hasil[metode](...argumen);
            }
        }
    } catch (e) {
        log(4);
        console.error(e);
        return { _e: String(e) };
    }
    const akhir = {
        hasil: hasil,
    };
    log(5, akhir);
    return akhir;
}

process.on('exit', klien.close);

process.on('message', (pesan) => {
    if (pesan.hasOwnProperty('i')) {
        if (pesan.hasOwnProperty('_')) {
            if (pesan._.hasOwnProperty('_eval')) {
                IPC.terimaDanBalasKueri(pesan, (pesan) => utils.jalankanFn(() => eval(pesan._._eval)));
            } else {
                IPC.terimaDanBalasKueri(pesan, (pesan) => proses(pesan));
            }
        }
    }
});

function log(kode, ...argumen2) {
    if (!argv.dev) return;
    return console.log(
        [
            `[DATABASE] [LOG] menginisialisasi`, // 0
            `[DATABASE] [LOG] terhubung ke MongoDB Atlas`, // 1
            `[DATABASE] [LOG] menerima pesan dari proses utama`, // 2
            `[DATABASE] [LOG] menjalankan aksi`, // 3
            `[DATABASE] [ERROR] terjadi error di database`, // 4
            `[DATABASE] [LOG] mengirim pesan ke proses utama`, // 5
        ][kode],
        ...argumen2
    );
}
