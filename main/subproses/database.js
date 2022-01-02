const { MongoClient } = require('mongodb');

const argv = JSON.parse(process.argv[2]);

log(0);
const klien = new MongoClient(argv.mongodburi);

// const cache = {};

klien.connect().then(async (hasilkoneksi) => {
    log(1);
    // cache.users = await klien.db().collection('users').find({}).toArray();
    // cache.chats = await klien.db().collection('chats').find({}).toArray();
    // cache.system = await klien.db().collection('system').find({}).toArray();
});

process.on('message', async (pesan) => {
    if (pesan.k && pesan._) {
        let hasil,
            eror,
            awal = true;
        try {
            log(2, pesan);
            const db = klien.db().collection(pesan.k);
            for (const aksi of pesan._) {
                const [metode, ...argumen] = Array.isArray(aksi) ? aksi : [aksi, []];
                try {
                    if (awal) {
                        log(3, `db.${metode}(${argumen.join(', ')})`);
                        hasil = await db[metode](...argumen);
                        awal = false;
                    } else {
                        log(3, `hasil.${metode}(${argumen.join(', ')})`);
                        hasil = await hasil[metode](...argumen);
                    }
                } catch (e) {
                    log(4);
                    console.error(e);
                    eror = e.stack ?? e;
                    break;
                }
            }
        } catch (e) {
            log(4);
            console.error(e);
            eror = e.stack ?? e;
        }
        const akhir = {
            i: 'F' + pesan.i.slice(1),
            h: hasil,
            e: eror,
        };
        log(5, akhir);
        process.send(akhir);
    }
});

process.on('exit', klien.close);

function kueriSubproses(subproses, argumen) {
    return new Promise((resolve, reject) => {
        const id = subproses + '#' + Math.floor(Math.random() * 100) + Date.now().toString() + '#DB';
        function responKueri(hasil) {
            if (hasil.i) {
                if (hasil.i.slice(1) === id) {
                    log(7, subproses, hasil);
                    hasil.e ? reject(hasil) : resolve(hasil);
                    process.removeListener('message', responKueri);
                }
            }
        }
        process.on('message', responKueri);
        const pesan = {
            i: 'T' + id,
            ...argumen,
        };
        log(6, subproses, pesan);
        process.send(pesan);
    });
}

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

process.on('message', async (pesan) => {
    if (pesan.hasOwnProperty('eval')) {
        process.send({
            i: 'F' + pesan.i.slice(1),
            result: require('util').format(await eval(pesan.eval)),
        });
    }
});
