process.on('message', async (pesan) => {
    log(0, pesan);
    const pengirim = pesan.pengirim;
    const perintah = /^[\/°•π÷×¶∆£¢€¥®™+✓_=|~!?@#$%^&.©]/.test(pesan.teks)
        ? pesan.teks.split(/\s+/)
        : [];
    if (perintah.length) {
        const teks = pesan.teks.replace(new RegExp(`^${perintah[0]}\\s*`), '');
        const prnth = perintah[0].slice(1).toLowerCase();
        log(1, perintah, teks, prnth);

        if (prnth === 'eval') {
            log(3, 'eval');
            let hasil;
            try {
                hasil = await eval(teks);
            } catch (eror) {
                hasil = eror.stack ?? eror;
            } finally {
                const _hasil = {
                    penerima: pengirim,
                    teks: String(hasil),
                };
                log(4, 'eval', _hasil);
                return process.send(_hasil);
            }
        }
    } else {
        log(2);
    }
});

function log(kode, ...argumen2) {
    return console.log(
        [
            `[PERINTAH] memproses teks`, // 0
            `[PERINTAH] terdapat perintah`, // 1
            `[PERINTAH] tidak ditemukan perintah`, // 2
            `[PERINTAH] mengeksekusi perintah "${argumen2[0]}"`, // 3
            `[PERINTAH] mengembalikan hasil dari perintah "${argumen2[0]}"`, // 4
        ][kode],
        ...argumen2.slice(1)
    );
}
