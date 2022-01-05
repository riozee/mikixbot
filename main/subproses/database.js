const utils = require('../utils');
const IPC = new utils.IPC('DB', process);

const { MongoClient } = require('mongodb');

const argv = JSON.parse(process.argv[2]);

log(0);
const klien = new MongoClient(argv.mongodburi);

klien.connect().then(async (hasilkoneksi) => {
    log(1);
});

async function proses(pesan) {
    let awal = true;
    log(2, pesan);
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
            `[DATABASE] menginisialisasi database`, // 0
            `[DATABASE] terhubung ke database`, // 1
            `[DATABASE] menerima pesan dari proses utama`, // 2
            `[DATABASE] menjalankan aksi`, // 3
            `[DATABASE] terjadi error di database`, // 4
            `[DATABASE] mengirim pesan ke proses utama`, // 5
            `[DATABASE] mengirim kueri ke`, // 6
            `[DATABASE] mendapat respon dari`, // 7
        ][kode],
        ...argumen2
    );
}
