const utils = require('../utils');
const IPC = new utils.IPC('DB', process);

const { MongoClient } = require('mongodb');
const _ = require('lodash');
const fs = require('fs');

const creds = JSON.parse(fs.readFileSync('./creds.json'));

const cache = [],
    idTidakAda = [];

setInterval(() => {
    log(7);
    while (cache.pop()) {}
    while (idTidakAda.pop()) {}
}, 3600000);

log(0);
const klien = new MongoClient(creds.mongodburi);

klien.connect().then(() => log(1));

async function proses(pesan) {
    log(2, pesan);
    let hasil;
    try {
        const db = klien.db().collection(creds.dbtest ? 'test' : 'data');
        if (pesan._.hasOwnProperty('c')) {
            if (Array.isArray(pesan._.c)) {
                for (const c of pesan._.c) {
                    if (!c._id) throw 'Tidak ada _id.';
                }
                hasil = await db.insertMany(pesan._.c);
                for (const data of pesan._.c) {
                    cache.push(data);
                    _.pull(idTidakAda, data._id);
                }
            } else {
                if (!pesan._.c._id) throw 'Tidak ada _id.';
                hasil = await db.insertOne(pesan._.c);
                cache.push(pesan._.c);
                _.pull(idTidakAda, pesan._.c._id);
            }
        } else if (pesan._.hasOwnProperty('r')) {
            if (pesan._.m) {
                results = await db.find(pesan._.r).toArray();
                for (const data of results) {
                    cache.push(data);
                    _.pull(idTidakAda, data._id);
                }
                hasil = results;
            } else {
                let results;
                if (pesan._.r._id && idTidakAda.includes(pesan._.r._id)) {
                    results = [null];
                } else {
                    results = _.filter(cache, pesan._.r);
                    if (!results.length) {
                        results = [await db.findOne(pesan._.r)];
                        if (!results[0]) {
                            if (pesan._.r._id) idTidakAda.push(pesan._.r._id);
                        } else {
                            cache.push(results[0]);
                            _.pull(idTidakAda, results[0]._id);
                        }
                    }
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
    IPC.terimaDanBalasKueri(pesan, async (pesan) => {
        if (pesan.hasOwnProperty('i')) {
            if (pesan.hasOwnProperty('_')) {
                if (pesan._.hasOwnProperty('_eval')) {
                    return await utils.jalankanFn(() => eval(pesan._._eval));
                } else {
                    return await proses(pesan);
                }
            }
        }
    });
});

function log(kode, ...argumen2) {
    if (!creds.dev) return;
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

if (creds.watch) {
    require('fs').watch(__filename, () => {
        log(5);
        process.exit();
    });
}
