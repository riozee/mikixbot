const utils = require('../utils');
const IPC = new utils.IPC('DB', process);

const { MongoClient } = require('mongodb');
const _ = require('lodash');

const argv = JSON.parse(process.argv[2]);

const cache = [];

setInterval(() => {
    log(7);
    while (cache.pop()) {}
}, 3600000);

log(0);
const klien = new MongoClient(argv.mongodburi);

klien.connect().then(() => log(1));

async function proses(pesan) {
    log(2, pesan);
    let hasil;
    try {
        const db = klien.db().collection(argv.dbtest ? 'test' : 'data');
        if (pesan._.hasOwnProperty('c')) {
            if (Array.isArray(pesan._.c)) {
                hasil = await db.insertMany(pesan._.c);
                pesan._.c.forEach((data) => cache.push(data));
            } else {
                hasil = await db.insertOne(pesan._.c);
                cache.push(pesan._.c);
            }
        } else if (pesan._.hasOwnProperty('r')) {
            let results = _.filter(cache, pesan._.r);
            if (pesan._.m) {
                if (!results.length) {
                    results = await db.find(pesan._.r).toArray();
                    results.forEach((data) => cache.push(data));
                }
                hasil = results;
            } else {
                if (!results.length) {
                    results = [await db.findOne(pesan._.r)];
                    cache.push(results[0]);
                }
                hasil = results[0];
            }
        } else if (pesan._.hasOwnProperty('u')) {
            if (pesan._.m) {
                hasil = await db.updateMany(pesan._.u[0], pesan._.u[1]);
            } else {
                hasil = await db.updateOne(pesan._.u[0], pesan._.u[1]);
            }
            _.remove(cache, pesan._.u[0]);
        } else if (pesan._.hasOwnProperty('d')) {
            if (pesan._.m) {
                hasil = await db.deleteMany(pesan._.d);
            } else {
                hasil = await db.deleteOne(pesan._.d);
            }
            _.remove(cache, pesan._.d);
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
            `[DATABASE] [LOG] memulai ulang proses`, // 6
            `[DATABASE] [LOG] membersihkan cache`, // 7
        ][kode],
        ...argumen2
    );
}

if (argv.watch) {
    require('fs').watch(__filename, () => {
        log(5);
        process.exit();
    });
}
