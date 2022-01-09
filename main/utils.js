exports.IPC = class IPC {
    constructor(subprosesIni, objekProcessGlobal) {
        this.subproses = subprosesIni;
        this.process = objekProcessGlobal;
    }

    kirimSinyal(keSubproses, pesan) {
        return this.process.send({
            _: pesan,
            d: this.subproses,
            k: keSubproses,
        });
    }

    terimaSinyal(pesan, fnKendali) {
        return fnKendali(pesan);
    }

    kirimKueri(keSubproses, pesan) {
        return new Promise((resolve, reject) => {
            const id = Math.random().toString(36).slice(2);
            const responKueri = (hasil) => {
                if (hasil.hasOwnProperty('ir') && hasil.ir === id) {
                    resolve(hasil._);
                    this.process.removeListener('message', responKueri);
                }
            };
            this.process.on('message', responKueri);
            this.process.send(
                {
                    i: id,
                    _: pesan,
                    d: this.subproses,
                    k: keSubproses,
                },
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
        let hasil, eror;
        try {
            hasil = await fnKendali(pesan);
        } catch ($eror) {
            console.error($eror);
            eror = $eror.stack ?? $eror;
        } finally {
            this.process.send({
                ir: pesan.i,
                _: hasil ? { ...hasil } : eror ? { _e: eror } : {},
                k: pesan.d,
            });
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
