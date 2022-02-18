const fs = require('fs/promises');
const path = require('path');

function encodePesan(pesan) {
    return `${pesan.d || '00'}${JSON.stringify(pesan)}${pesan.i ? 'i' : '0'}${pesan.k || '00'}`;
}
exports.encodePesan = encodePesan;

function decodePesan(pesan) {
    return JSON.parse(pesan.slice(2, -3));
}
exports.decodePesan = decodePesan;

exports.IPC = class IPC {
    constructor(subprosesIni, objekProcessGlobal) {
        this.subproses = subprosesIni;
        this.process = objekProcessGlobal;
    }

    kirimSinyal(keSubproses, pesan) {
        return this.process.send(
            encodePesan({
                _: pesan,
                d: this.subproses,
                k: keSubproses,
            })
        );
    }

    terimaSinyal(pesan, fnKendali) {
        return fnKendali(decodePesan(pesan));
    }

    kirimKueri(keSubproses, pesan) {
        return new Promise((resolve) => {
            const id = Math.random().toString(36).slice(2);
            const responKueri = (hasil) => {
                hasil = decodePesan(hasil);
                if (hasil.hasOwnProperty('ir') && hasil.ir === id) {
                    resolve(hasil._);
                    this.process.removeListener('message', responKueri);
                }
            };
            this.process.on('message', responKueri);
            this.process.send(
                encodePesan({
                    i: id,
                    _: pesan,
                    d: this.subproses,
                    k: keSubproses,
                }),
                (eror) => {
                    if (eror) {
                        resolve({ _e: eror.stack ?? eror });
                        this.process.removeListener('message', responKueri);
                    }
                }
            );
        });
    }

    async terimaDanBalasKueri(pesan, fnKendali) {
        pesan = decodePesan(pesan);
        let hasil, eror;
        try {
            hasil = await fnKendali(pesan);
        } catch ($eror) {
            console.error($eror);
            eror = $eror.stack ?? $eror;
        } finally {
            this.process.send(
                encodePesan({
                    ir: pesan.i,
                    _: hasil ? { ...hasil } : eror ? { _e: eror } : {},
                    k: pesan.d,
                })
            );
        }
    }
};

exports.jalankanFn = async function (fn) {
    let hasil;
    try {
        hasil = await fn();
    } catch (e) {
        hasil = e.stack ?? e;
    } finally {
        return { h: require('util').format(hasil) };
    }
};

exports.jeda = (milidetik) => {
    return new Promise((res) => setTimeout(res, milidetik));
};

exports.namaFileAcak = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
